/**
 * Cloudflare Durable Object: AiGatewayDurableObject
 * Master Controller with Native SQLite Persistence (ctx.storage.sql)
 */

import { MIGRATIONS, DEFAULT_PROVIDERS_DATA } from '../../src/storage/schema.js';
import {
  sha256Hex,
  encryptKey,
  decryptKey,
  extractKeyPrefix,
  generateClientToken,
  hashPassword,
  generateSalt,
  generateSessionToken,
  timingSafeEqual
} from '../../src/core/crypto.js';
import { AiGatewayCore, GatewayError } from '../../src/core/gateway.js';
import type { IGatewayStorage } from '../../src/storage/interface.js';
import type {
  ProviderRecord,
  ApiKeyRecord,
  ClientTokenRecord,
  ProxyLogRecord,
  GlobalGatewayConfig,
  SystemMetricsSummary
} from '../../src/core/types.js';

export const DO_CODE_VERSION = '2026-11-05-opt-fix';

export class AiGatewayDurableObject implements IGatewayStorage {
  private sql: any;
  private core: AiGatewayCore;
  private encryptionSecret: string;
  private initialized = false;
  // 2026-11-05: in-memory caches, invalidated on admin writes through
  // this same DO (a recycled instance simply rebuilds them). Cursor and
  // counts are periodic-persistence caches by design, not exact state.
  private providersCache: any[] | null = null;
  private configCache: GlobalGatewayConfig | null = null;
  private mappingsCache: Record<string, string> | null = null;
  private rrCursorCache = new Map<string, number>();
  private rrCursorPersistCount = new Map<string, number>();
  private logCountCache: number | null = null;
  private auditCountCache: number | null = null;
  private invalidateProviderCache(): void {
    this.providersCache = null;
    this.mappingsCache = null;
  }

  constructor(public ctx: any, public env: any) {
    this.sql = ctx.storage.sql;
    this.encryptionSecret = env.KEY_ENCRYPTION_SECRET || '';
    this.core = new AiGatewayCore(this, this.encryptionSecret);
  }

  /**
   * Run versioned migrations in SQLite
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.encryptionSecret) {
      throw new Error('KEY_ENCRYPTION_SECRET is not configured on this Durable Object Worker');
    }

    // Create migrations tracker if not exists
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    // Admin audit log (separate from proxy_logs; log-clear never touches it)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id TEXT,
        result TEXT NOT NULL
      );
    `);

    // Auth failure tracking for login rate limiting (SQL, not in-memory)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS auth_failures (
        key TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        first_at INTEGER NOT NULL,
        locked_until INTEGER NOT NULL
      );
    `);

    // Check applied migrations
    const appliedRows = [...this.sql.exec('SELECT version FROM schema_migrations')];
    const appliedVersions = new Set(appliedRows.map((r: any) => r.version));

    for (const mig of MIGRATIONS) {
      if (!appliedVersions.has(mig.version)) {
        this.sql.exec(mig.sql);
        this.sql.exec(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          mig.version,
          mig.name,
          new Date().toISOString()
        );
      }
    }

    // Seed default providers if table is empty
    const providerCountRow = [...this.sql.exec('SELECT COUNT(*) as count FROM providers')][0] as any;
    if (providerCountRow.count === 0) {
      const now = new Date().toISOString();
      for (const p of DEFAULT_PROVIDERS_DATA) {
        this.sql.exec(
          `INSERT INTO providers (id, name, type, base_url, auth_header_format, enabled, strategy, timeout_ms, max_retries, is_custom, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          p.id, p.name, p.type, p.baseUrl, p.authHeaderFormat, p.enabled, p.strategy, p.timeoutMs, p.maxRetries, p.isCustom, p.description, now, now
        );

        for (const m of p.models) {
          this.sql.exec(
            `INSERT OR IGNORE INTO provider_models (provider_id, model, enabled) VALUES (?, ?, 1)`,
            p.id, m
          );
        }

        for (const [from, to] of Object.entries(p.mappings)) {
          this.sql.exec(
            `INSERT OR REPLACE INTO model_mappings (from_model, to_model, provider_id) VALUES (?, ?, ?)`,
            from, to, p.id
          );
        }
      }
    }

    // Backfill preset providers added after the first seed: existing
    // databases are not empty, so the seed above never runs for them.
    // Runs once (guarded by schema_migrations version 2 -- that table's
    // version column is INTEGER, a text marker breaks with
    // SQLITE_MISMATCH), inserts only providers that are missing, and
    // never overwrites existing ones. A provider the user deletes
    // after this backfill will stay deleted.
    if (!appliedVersions.has(2)) {
      const now = new Date().toISOString();
      for (const p of DEFAULT_PROVIDERS_DATA) {
        const exists = [...this.sql.exec('SELECT id FROM providers WHERE id = ?', p.id)][0];
        if (exists) continue;
        this.sql.exec(
          `INSERT INTO providers (id, name, type, base_url, auth_header_format, enabled, strategy, timeout_ms, max_retries, is_custom, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          p.id, p.name, p.type, p.baseUrl, p.authHeaderFormat, p.enabled, p.strategy, p.timeoutMs, p.maxRetries, p.isCustom, p.description, now, now
        );
        for (const m of p.models) {
          this.sql.exec(
            `INSERT OR IGNORE INTO provider_models (provider_id, model, enabled) VALUES (?, ?, 1)`,
            p.id, m
          );
        }
        for (const [from, to] of Object.entries(p.mappings)) {
          this.sql.exec(
            `INSERT OR REPLACE INTO model_mappings (from_model, to_model, provider_id) VALUES (?, ?, ?)`,
            from, to, p.id
          );
        }
      }
      this.sql.exec(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        2, 'preset-backfill-2026-10-28', now
      );
    }

    // No seeded client token: the first client token must be created
    // by an admin after initialization. Never seed a usable token here.

    // Migration v3: delete the previously seeded master client token and
    // its permissions, if present. Runs once; never re-seeds it.
    if (!appliedVersions.has(3)) {
      this.sql.exec('DELETE FROM client_provider_permissions WHERE client_id = ?', 'client-default-master');
      this.sql.exec('DELETE FROM client_model_permissions WHERE client_id = ?', 'client-default-master');
      this.sql.exec('DELETE FROM client_tokens WHERE id = ?', 'client-default-master');
      this.sql.exec(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        3, 'delete-default-master-token', new Date().toISOString()
      );
    }

    // Migration v4: rate_limited keys whose cooldown was wiped to 0 must
    // not stay permanently excluded; NULL preserves/expires the cooldown.
    if (!appliedVersions.has(4)) {
      this.sql.exec(`UPDATE api_keys SET cooldown_until = NULL WHERE status = 'rate_limited' AND (cooldown_until = 0 OR cooldown_until IS NULL)`);
      this.sql.exec(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        4, 'rate-limited-cooldown-null', new Date().toISOString()
      );
    }

    this.initialized = true;
  }

  // --- IGatewayStorage Implementation on SQLite ---

  async getProviders(): Promise<any[]> {
    await this.initialize();
    if (this.providersCache) return this.providersCache;
    const rows = [...this.sql.exec('SELECT * FROM providers ORDER BY created_at ASC')];
    let modelsRows: any[] = [];
    let mappingsRows: any[] = [];
    try {
      modelsRows = [...this.sql.exec('SELECT provider_id, model FROM provider_models WHERE enabled = 1')];
    } catch {
      // fallback
    }
    try {
      mappingsRows = [...this.sql.exec('SELECT provider_id, from_model, to_model FROM model_mappings')];
    } catch {
      // fallback
    }

    const modelsByProvider: Record<string, string[]> = {};
    for (const mr of modelsRows) {
      if (!modelsByProvider[mr.provider_id]) modelsByProvider[mr.provider_id] = [];
      modelsByProvider[mr.provider_id].push(mr.model);
    }

    const mappingsByProvider: Record<string, Record<string, string>> = {};
    for (const mr of mappingsRows) {
      if (!mappingsByProvider[mr.provider_id]) mappingsByProvider[mr.provider_id] = {};
      mappingsByProvider[mr.provider_id][mr.from_model] = mr.to_model;
    }

    this.providersCache = rows.map((r: any) => {
      const pModels = modelsByProvider[r.id] || [];
      const defaultModels = r.type === 'gemini'
        ? ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash']
        : r.type === 'openai'
        ? ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
        : r.type === 'anthropic'
        ? ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku']
        : r.type === 'deepseek'
        ? ['deepseek-chat', 'deepseek-reasoner']
        : ['default-model'];

      return {
        id: r.id,
        name: r.name,
        type: r.type,
        baseUrl: r.base_url,
        authHeaderFormat: r.auth_header_format || 'bearer',
        authHeaderName: r.auth_header_name,
        enabled: Boolean(r.enabled),
        loadBalanceStrategy: r.strategy || 'round-robin',
        strategy: r.strategy || 'round-robin',
        timeoutSeconds: Math.round((r.timeout_ms || 60000) / 1000),
        timeoutMs: r.timeout_ms || 60000,
        maxRetries: r.max_retries || 3,
        isCustom: Boolean(r.is_custom),
        description: r.description || '',
        models: pModels.length > 0 ? pModels : defaultModels,
        modelMappings: mappingsByProvider[r.id] || {},
        createdAt: r.created_at || new Date().toISOString(),
        updatedAt: r.updated_at || new Date().toISOString()
      };
    });
    return this.providersCache;
  }

  async getProvider(id: string): Promise<any | null> {
    await this.initialize();
    const rows = [...this.sql.exec('SELECT * FROM providers WHERE id = ?', id)];
    if (rows.length === 0) return null;
    const r: any = rows[0];

    let pModels: string[] = [];
    try {
      const mRows = [...this.sql.exec('SELECT model FROM provider_models WHERE provider_id = ? AND enabled = 1', id)];
      pModels = mRows.map((m: any) => m.model);
    } catch {}

    let mappings: Record<string, string> = {};
    try {
      const mapRows = [...this.sql.exec('SELECT from_model, to_model FROM model_mappings WHERE provider_id = ?', id)];
      for (const mr of mapRows) {
        mappings[mr.from_model] = mr.to_model;
      }
    } catch {}

    const defaultModels = r.type === 'gemini'
      ? ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash']
      : r.type === 'openai'
      ? ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
      : r.type === 'anthropic'
      ? ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku']
      : r.type === 'deepseek'
      ? ['deepseek-chat', 'deepseek-reasoner']
      : ['default-model'];

    return {
      id: r.id,
      name: r.name,
      type: r.type,
      baseUrl: r.base_url,
      authHeaderFormat: r.auth_header_format || 'bearer',
      authHeaderName: r.auth_header_name,
      enabled: Boolean(r.enabled),
      loadBalanceStrategy: r.strategy || 'round-robin',
      strategy: r.strategy || 'round-robin',
      timeoutSeconds: Math.round((r.timeout_ms || 60000) / 1000),
      timeoutMs: r.timeout_ms || 60000,
      maxRetries: r.max_retries || 3,
      isCustom: Boolean(r.is_custom),
      description: r.description || '',
      models: pModels.length > 0 ? pModels : defaultModels,
      modelMappings: mappings,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  async saveProvider(provider: any, models?: string[], mappings?: Record<string, string>, actor = 'admin'): Promise<void> {
    await this.initialize();
    const now = new Date().toISOString();
    const id = (provider.id || '').trim() || ('custom-' + globalThis.crypto.randomUUID());
    const name = (provider.name || id).trim();
    const type = provider.type || 'custom';
    const baseUrl = (provider.baseUrl || provider.base_url || 'https://api.openai.com/v1').trim();
    const baseUrlCheck = AiGatewayCore.validateSafeUrl(baseUrl);
    if (!baseUrlCheck.safe) {
      throw new GatewayError(400, `Unsafe provider base URL: ${baseUrlCheck.error || 'blocked'}`);
    }
    const authHeaderFormat = provider.authHeaderFormat || provider.auth_header_format || 'bearer';
    const authHeaderName = provider.authHeaderName || provider.auth_header_name || null;
    const enabled = (provider.enabled !== false && provider.enabled !== 0) ? 1 : 0;
    const strategy = provider.strategy || provider.loadBalanceStrategy || 'round-robin';
    const timeoutMs = Number(provider.timeoutMs) || (Number(provider.timeoutSeconds) ? Number(provider.timeoutSeconds) * 1000 : 60000);
    const maxRetries = Number(provider.maxRetries ?? provider.max_retries ?? 3);
    const isCustom = (provider.isCustom !== false && provider.is_custom !== 0) ? 1 : 0;
    const description = provider.description || null;
    const createdAt = provider.createdAt || provider.created_at || now;

    this.sql.exec(
      `INSERT INTO providers (id, name, type, base_url, auth_header_format, auth_header_name, enabled, strategy, timeout_ms, max_retries, is_custom, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         base_url = excluded.base_url,
         auth_header_format = excluded.auth_header_format,
         auth_header_name = excluded.auth_header_name,
         enabled = excluded.enabled,
         strategy = excluded.strategy,
         timeout_ms = excluded.timeout_ms,
         max_retries = excluded.max_retries,
         description = excluded.description,
         updated_at = excluded.updated_at`,
      id, name, type, baseUrl, authHeaderFormat, authHeaderName,
      enabled, strategy, timeoutMs, maxRetries, isCustom,
      description, createdAt, now
    );

    const modelsList = models || (Array.isArray(provider.models) ? provider.models : (typeof provider.models === 'string' ? provider.models.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined));

    if (modelsList && Array.isArray(modelsList)) {
      this.sql.exec('DELETE FROM provider_models WHERE provider_id = ?', id);
      for (const m of modelsList) {
        if (m && typeof m === 'string') {
          this.sql.exec('INSERT INTO provider_models (provider_id, model, enabled) VALUES (?, ?, 1)', id, m.trim());
        }
      }
    }

    const mappingObj = mappings || provider.modelMappings || provider.model_mappings;
    if (mappingObj && typeof mappingObj === 'object') {
      for (const [from, to] of Object.entries(mappingObj)) {
        if (from && to) {
          this.sql.exec('INSERT OR REPLACE INTO model_mappings (from_model, to_model, provider_id) VALUES (?, ?, ?)', from, String(to), id);
        }
      }
    }
    this.invalidateProviderCache();
    await this.recordAdminAudit('provider.save', id, 'ok', actor);
  }

  async deleteProvider(id: string, actor = 'admin'): Promise<boolean> {
    await this.initialize();
    this.sql.exec('DELETE FROM providers WHERE id = ?', id);
    this.sql.exec('DELETE FROM provider_models WHERE provider_id = ?', id);
    this.sql.exec('DELETE FROM api_keys WHERE provider_id = ?', id);
    this.invalidateProviderCache();
    await this.recordAdminAudit('provider.delete', id, 'ok', actor);
    return true;
  }

  async getProviderModels(providerId: string): Promise<string[]> {
    await this.initialize();
    const rows = [...this.sql.exec('SELECT model FROM provider_models WHERE provider_id = ? AND enabled = 1', providerId)];
    return rows.map((r: any) => r.model);
  }

  async getAllModelMappings(): Promise<Record<string, string>> {
    await this.initialize();
    if (this.mappingsCache) return this.mappingsCache;
    const rows = [...this.sql.exec('SELECT from_model, to_model FROM model_mappings')];
    const mappings: Record<string, string> = {};
    for (const r of rows as any[]) {
      mappings[r.from_model] = r.to_model;
    }
    this.mappingsCache = mappings;
    return mappings;
  }

  // --- API Keys ---
  async getKeys(providerId?: string): Promise<Array<Omit<ApiKeyRecord, 'encryptedKey' | 'keyHash'>>> {
    await this.initialize();
    const query = providerId
      ? 'SELECT id, provider_id, key_prefix, label, status, weight, priority, request_count, token_count, error_count, cooldown_until, last_error, last_used_at, created_at, updated_at FROM api_keys WHERE provider_id = ? ORDER BY created_at ASC'
      : 'SELECT id, provider_id, key_prefix, label, status, weight, priority, request_count, token_count, error_count, cooldown_until, last_error, last_used_at, created_at, updated_at FROM api_keys ORDER BY created_at ASC';
    const rows = providerId ? [...this.sql.exec(query, providerId)] : [...this.sql.exec(query)];

    return rows.map((r: any) => ({
      id: r.id,
      providerId: r.provider_id,
      keyPrefix: r.key_prefix,
      maskedKey: `${r.key_prefix}••••`,
      label: r.label,
      status: r.status,
      weight: r.weight || 1,
      priority: r.priority || 1,
      requestCount: r.request_count || 0,
      totalRequests: r.request_count || 0,
      tokenCount: r.token_count || 0,
      totalTokens: r.token_count || 0,
      errorCount: r.error_count || 0,
      successCount: Math.max(0, (r.request_count || 0) - (r.error_count || 0)),
      cooldownUntil: r.cooldown_until,
      lastError: r.last_error,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  async getKey(id: string): Promise<ApiKeyRecord | null> {
    await this.initialize();
    const rows = [...this.sql.exec('SELECT * FROM api_keys WHERE id = ?', id)];
    if (rows.length === 0) return null;
    const r: any = rows[0];
    return {
      id: r.id,
      providerId: r.provider_id,
      encryptedKey: r.encrypted_key,
      keyHash: r.key_hash,
      keyPrefix: r.key_prefix,
      maskedKey: `${r.key_prefix}••••`,
      label: r.label,
      status: r.status,
      weight: r.weight || 1,
      priority: r.priority || 1,
      requestCount: r.request_count || 0,
      totalRequests: r.request_count || 0,
      tokenCount: r.token_count || 0,
      totalTokens: r.token_count || 0,
      errorCount: r.error_count || 0,
      successCount: Math.max(0, (r.request_count || 0) - (r.error_count || 0)),
      cooldownUntil: r.cooldown_until,
      lastError: r.last_error,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    } as any;
  }

  async getKeysFull(providerId?: string): Promise<ApiKeyRecord[]> {
    await this.initialize();
    const query = providerId
      ? 'SELECT * FROM api_keys WHERE provider_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM api_keys ORDER BY created_at ASC';
    const rows = providerId ? [...this.sql.exec(query, providerId)] : [...this.sql.exec(query)];
    return rows.map((r: any) => ({
      id: r.id, providerId: r.provider_id, encryptedKey: r.encrypted_key, keyHash: r.key_hash,
      keyPrefix: r.key_prefix, maskedKey: `${r.key_prefix}••••`, label: r.label, status: r.status,
      weight: r.weight || 1, priority: r.priority || 1, requestCount: r.request_count || 0,
      tokenCount: r.token_count || 0, errorCount: r.error_count || 0, cooldownUntil: r.cooldown_until,
      lastError: r.last_error, lastUsedAt: r.last_used_at, createdAt: r.created_at, updatedAt: r.updated_at
    } as any));
  }

  async addKey(data: {
    providerId: string;
    rawKey: string;
    label?: string;
    weight?: number;
    priority?: number;
    status?: ApiKeyRecord['status'];
  }, secret = this.encryptionSecret, actor = 'admin'): Promise<any> {
    await this.initialize();
    const id = 'key-' + globalThis.crypto.randomUUID();
    const keyHash = await sha256Hex(data.rawKey);
    const encryptedKey = await encryptKey(data.rawKey, secret);
    const keyPrefix = extractKeyPrefix(data.rawKey);
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO api_keys (id, provider_id, encrypted_key, key_hash, key_prefix, label, status, weight, priority, request_count, token_count, error_count, cooldown_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
      id, data.providerId, encryptedKey, keyHash, keyPrefix, data.label || keyPrefix,
      data.status || 'active', data.weight || 1, data.priority || 1, now, now
    );

    await this.recordAdminAudit('key.create', id, 'ok', actor);
    return {
      id,
      providerId: data.providerId,
      keyHash,
      keyPrefix,
      maskedKey: `${keyPrefix}••••`,
      label: data.label || keyPrefix,
      status: data.status || 'active',
      weight: data.weight || 1,
      priority: data.priority || 1,
      requestCount: 0,
      totalRequests: 0,
      tokenCount: 0,
      totalTokens: 0,
      errorCount: 0,
      successCount: 0,
      createdAt: now,
      updatedAt: now
    };
  }

  async batchAddKeys(providerId: string, rawKeys: string[], secret = this.encryptionSecret, actor = 'admin'): Promise<number> {
    let count = 0;
    for (const raw of rawKeys) {
      if (raw.trim()) {
        await this.addKey({ providerId, rawKey: raw.trim() }, secret, actor);
        count++;
      }
    }
    return count;
  }

  async updateKey(id: string, updates: {
    providerId?: string;
    rawKey?: string;
    key?: string;
    label?: string;
    weight?: number;
    priority?: number;
    status?: ApiKeyRecord['status'];
    cooldownUntil?: number;
    lastError?: string;
  }, secret = this.encryptionSecret, actor = 'admin'): Promise<any | null> {
    await this.initialize();
    const rows = [...this.sql.exec('SELECT * FROM api_keys WHERE id = ?', id)];
    if (rows.length === 0) return null;
    const now = new Date().toISOString();

    const keyText = updates.key || updates.rawKey;
    let encryptedKey: string | null = null;
    let keyHash: string | null = null;
    let keyPrefix: string | null = null;

    if (keyText && keyText.trim()) {
      const clean = keyText.trim();
      encryptedKey = await encryptKey(clean, secret);
      keyHash = await sha256Hex(clean);
      keyPrefix = extractKeyPrefix(clean);
    }

    const hasLastErrorUpdate = updates.lastError !== undefined;
    if (hasLastErrorUpdate) {
      this.sql.exec(
        `UPDATE api_keys SET
           provider_id = COALESCE(?, provider_id),
           encrypted_key = COALESCE(?, encrypted_key),
           key_hash = COALESCE(?, key_hash),
           key_prefix = COALESCE(?, key_prefix),
           label = COALESCE(?, label),
           status = COALESCE(?, status),
           weight = COALESCE(?, weight),
           priority = COALESCE(?, priority),
           cooldown_until = COALESCE(?, cooldown_until),
           last_error = ?,
           updated_at = ?
         WHERE id = ?`,
        updates.providerId || null,
        encryptedKey,
        keyHash,
        keyPrefix,
        updates.label !== undefined ? updates.label : null,
        updates.status || null,
        updates.weight !== undefined ? Math.max(1, updates.weight) : null,
        updates.priority !== undefined ? updates.priority : null,
        updates.cooldownUntil !== undefined ? updates.cooldownUntil : null,
        updates.lastError || null,
        now,
        id
      );
    } else {
      this.sql.exec(
        `UPDATE api_keys SET
           provider_id = COALESCE(?, provider_id),
           encrypted_key = COALESCE(?, encrypted_key),
           key_hash = COALESCE(?, key_hash),
           key_prefix = COALESCE(?, key_prefix),
           label = COALESCE(?, label),
           status = COALESCE(?, status),
           weight = COALESCE(?, weight),
           priority = COALESCE(?, priority),
           cooldown_until = COALESCE(?, cooldown_until),
           updated_at = ?
         WHERE id = ?`,
        updates.providerId || null,
        encryptedKey,
        keyHash,
        keyPrefix,
        updates.label !== undefined ? updates.label : null,
        updates.status || null,
        updates.weight !== undefined ? Math.max(1, updates.weight) : null,
        updates.priority !== undefined ? updates.priority : null,
        updates.cooldownUntil !== undefined ? updates.cooldownUntil : null,
        now,
        id
      );
    }

    await this.recordAdminAudit('key.update', id, 'ok', actor);
    const keys = await this.getKeys();
    return keys.find(k => k.id === id) || null;
  }

  async updateKeyStatus(id: string, status: ApiKeyRecord['status'], cooldownUntil?: number, lastError?: string): Promise<void> {
    await this.initialize();
    const now = new Date().toISOString();
    this.sql.exec(
      `UPDATE api_keys SET status = ?, cooldown_until = COALESCE(?, cooldown_until), last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?`,
      status, cooldownUntil === undefined ? null : cooldownUntil, lastError || null, now, id
    );
  }

  async updateKeyUsage(id: string, tokens: number, isError: boolean): Promise<void> {
    await this.initialize();
    const now = new Date().toISOString();
    this.sql.exec(
      `UPDATE api_keys SET
         request_count = request_count + 1,
         token_count = token_count + ?,
         error_count = error_count + ?,
         last_used_at = ?,
         updated_at = ?
       WHERE id = ?`,
      tokens, isError ? 1 : 0, now, now, id
    );
  }

  async deleteKey(id: string, actor = 'admin'): Promise<boolean> {
    await this.initialize();
    this.sql.exec('DELETE FROM api_keys WHERE id = ?', id);
    await this.recordAdminAudit('key.delete', id, 'ok', actor);
    return true;
  }

  // --- Load Balancing RR Cursor ---
  async getProviderRrCursor(providerId: string): Promise<number> {
    await this.initialize();
    if (this.rrCursorCache.has(providerId)) return this.rrCursorCache.get(providerId) as number;
    const rows = [...this.sql.exec('SELECT rr_cursor FROM provider_state WHERE provider_id = ?', providerId)];
    const cursor = rows.length > 0 ? (rows[0] as any).rr_cursor : 0;
    this.rrCursorCache.set(providerId, cursor);
    return cursor;
  }

  async incrementProviderRrCursor(providerId: string, nextCursor: number): Promise<void> {
    await this.initialize();
    this.rrCursorCache.set(providerId, nextCursor);
    // Persist only every 10th increment: the cursor is a fairness hint,
    // and resetting it on instance recycle is acceptable (2026-11-05).
    const n = (this.rrCursorPersistCount.get(providerId) || 0) + 1;
    this.rrCursorPersistCount.set(providerId, n);
    if (n % 10 !== 0) return;
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO provider_state (provider_id, rr_cursor, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET rr_cursor = excluded.rr_cursor, updated_at = excluded.updated_at`,
      providerId, nextCursor, now
    );
  }

  // --- Client Tokens ---
  async getClients(): Promise<ClientTokenRecord[]> {
    await this.initialize();
    const rows = [...this.sql.exec('SELECT * FROM client_tokens ORDER BY created_at DESC')];
    const clients: any[] = [];

    for (const r of rows as any[]) {
      const providers = [...this.sql.exec('SELECT provider_id FROM client_provider_permissions WHERE client_id = ?', r.id)].map((p: any) => p.provider_id);
      const models = [...this.sql.exec('SELECT model FROM client_model_permissions WHERE client_id = ?', r.id)].map((m: any) => m.model);

      clients.push({
        id: r.id,
        name: r.name,
        tokenPrefix: r.token_prefix,
        status: r.status,
        rpmLimit: r.rpm_limit,
        quotaLimitTokens: r.quota_limit_tokens,
        quotaUsedTokens: r.quota_used_tokens,
        quotaLimitRequests: r.quota_limit_requests,
        quotaUsedRequests: r.quota_used_requests,
        allowedProviders: providers.length > 0 ? providers : ['*'],
        allowedModels: models.length > 0 ? models : ['*'],
        createdAt: r.created_at,
        updatedAt: r.updated_at
      });
    }

    return clients;
  }

  async getClientByTokenHash(tokenHash: string): Promise<ClientTokenRecord | null> {
    await this.initialize();
    const rows = [...this.sql.exec('SELECT * FROM client_tokens WHERE token_hash = ? AND status = ?', tokenHash, 'active')];
    if (rows.length === 0) return null;
    const r: any = rows[0];

    const providers = [...this.sql.exec('SELECT provider_id FROM client_provider_permissions WHERE client_id = ?', r.id)].map((p: any) => p.provider_id);
    const models = [...this.sql.exec('SELECT model FROM client_model_permissions WHERE client_id = ?', r.id)].map((m: any) => m.model);

    return {
      id: r.id,
      name: r.name,
      tokenHash: r.token_hash,
      tokenPrefix: r.token_prefix,
      status: r.status,
      rpmLimit: r.rpm_limit,
      quotaLimitTokens: r.quota_limit_tokens,
      quotaUsedTokens: r.quota_used_tokens,
      quotaLimitRequests: r.quota_limit_requests,
      quotaUsedRequests: r.quota_used_requests,
      allowedProviders: providers.length > 0 ? providers : ['*'],
      allowedModels: models.length > 0 ? models : ['*'],
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  async createClient(data: {
    name: string;
    token?: string;
    rawToken?: string;
    rpmLimit?: number;
    quotaLimitTokens?: number;
    quotaLimitRequests?: number;
    allowedProviders?: string[];
    allowedModels?: string[];
  }, actor = 'admin'): Promise<{ client: ClientTokenRecord; rawToken: string; token: string }> {
    await this.initialize();
    const id = 'client-' + globalThis.crypto.randomUUID();
    const rawToken = (data.token || data.rawToken || '').trim() || generateClientToken();
    const tokenHash = await sha256Hex(rawToken);
    const tokenPrefix = rawToken.slice(0, 10) + '...';
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO client_tokens (id, name, token_hash, token_prefix, status, rpm_limit, quota_limit_tokens, quota_used_tokens, quota_limit_requests, quota_used_requests, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?, 0, ?, ?)`,
      id, data.name, tokenHash, tokenPrefix, data.rpmLimit || 0, data.quotaLimitTokens || 0, data.quotaLimitRequests || 0, now, now
    );

    const allowedProviders = data.allowedProviders || ['*'];
    for (const p of allowedProviders) {
      this.sql.exec('INSERT INTO client_provider_permissions (client_id, provider_id) VALUES (?, ?)', id, p);
    }

    const allowedModels = data.allowedModels || ['*'];
    for (const m of allowedModels) {
      this.sql.exec('INSERT INTO client_model_permissions (client_id, model) VALUES (?, ?)', id, m);
    }

    const client: any = {
      id,
      name: data.name,
      token: rawToken,
      rawToken,
      tokenHash,
      tokenPrefix,
      status: 'active',
      rpmLimit: data.rpmLimit || 0,
      quotaLimitTokens: data.quotaLimitTokens || 0,
      quotaUsedTokens: 0,
      quotaLimitRequests: data.quotaLimitRequests || 0,
      quotaUsedRequests: 0,
      allowedProviders,
      allowedModels,
      createdAt: now,
      updatedAt: now
    };

    await this.recordAdminAudit('client.create', id, 'ok', actor);
    return Object.assign(client, { client, rawToken, token: rawToken });
  }

  async updateClient(id: string, updates: Partial<ClientTokenRecord>, actor = 'admin'): Promise<ClientTokenRecord | null> {
    await this.initialize();
    const now = new Date().toISOString();
    this.sql.exec(
      `UPDATE client_tokens SET
         name = COALESCE(?, name),
         status = COALESCE(?, status),
         rpm_limit = COALESCE(?, rpm_limit),
         quota_limit_tokens = COALESCE(?, quota_limit_tokens),
         quota_limit_requests = COALESCE(?, quota_limit_requests),
         updated_at = ?
       WHERE id = ?`,
      updates.name || null, updates.status || null, updates.rpmLimit ?? null,
      updates.quotaLimitTokens ?? null, updates.quotaLimitRequests ?? null, now, id
    );

    if (updates.allowedProviders) {
      this.sql.exec('DELETE FROM client_provider_permissions WHERE client_id = ?', id);
      for (const p of updates.allowedProviders) {
        this.sql.exec('INSERT INTO client_provider_permissions (client_id, provider_id) VALUES (?, ?)', id, p);
      }
    }

    if (updates.allowedModels) {
      this.sql.exec('DELETE FROM client_model_permissions WHERE client_id = ?', id);
      for (const m of updates.allowedModels) {
        this.sql.exec('INSERT INTO client_model_permissions (client_id, model) VALUES (?, ?)', id, m);
      }
    }

    await this.recordAdminAudit('client.update', id, 'ok', actor);
    const clients = await this.getClients();
    return clients.find(c => c.id === id) || null;
  }

  async deleteClient(id: string, actor = 'admin'): Promise<boolean> {
    await this.initialize();
    this.sql.exec('DELETE FROM client_tokens WHERE id = ?', id);
    await this.recordAdminAudit('client.delete', id, 'ok', actor);
    this.sql.exec('DELETE FROM client_provider_permissions WHERE client_id = ?', id);
    this.sql.exec('DELETE FROM client_model_permissions WHERE client_id = ?', id);
    return true;
  }

  /**
   * Atomic Quota Update in SQLite:
   * Prevents race conditions by using conditional update:
   * UPDATE client_tokens SET quota_used_tokens = quota_used_tokens + ? WHERE quota_used_tokens + ? <= quota_limit_tokens
   */
  async atomicIncrementClientQuota(clientId: string, requests: number, tokens: number): Promise<boolean> {
    await this.initialize();
    const rows = [...this.sql.exec('SELECT quota_limit_requests, quota_used_requests, quota_limit_tokens, quota_used_tokens FROM client_tokens WHERE id = ?', clientId)];
    if (rows.length === 0) return false;

    const r: any = rows[0];
    if (r.quota_limit_requests > 0 && (r.quota_used_requests + requests > r.quota_limit_requests)) {
      return false;
    }
    if (r.quota_limit_tokens > 0 && (r.quota_used_tokens + tokens > r.quota_limit_tokens)) {
      return false;
    }

    this.sql.exec(
      `UPDATE client_tokens SET
         quota_used_requests = quota_used_requests + ?,
         quota_used_tokens = quota_used_tokens + ?,
         updated_at = ?
       WHERE id = ?`,
      requests, tokens, new Date().toISOString(), clientId
    );
    return true;
  }

  // --- Logs & Metrics ---
  async recordLog(log: ProxyLogRecord): Promise<void> {
    await this.initialize();
    this.sql.exec(
      `INSERT INTO proxy_logs (id, timestamp, client_name, provider_id, provider_name, key_masked, model, mapped_model, prompt_tokens, completion_tokens, total_tokens, duration_ms, status_code, is_stream, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      log.id, log.timestamp, log.clientName, log.providerId, log.providerName, log.keyMasked,
      log.model, log.mappedModel || null, log.promptTokens, log.completionTokens, log.totalTokens,
      log.durationMs, log.statusCode, log.isStream ? 1 : 0, log.errorMessage || null
    );

    // Prune only when the table grows past 1100 rows (retention
    // unchanged): delete the oldest 100, keeping the cap near 1000.
    // The count is an in-memory counter, calibrated by a real COUNT
    // only when unknown or after a prune, not on every request.
    try {
      let logCount: number;
      if (this.logCountCache === null) {
        const countRow = [...this.sql.exec('SELECT COUNT(*) as count FROM proxy_logs')][0] as any;
        logCount = countRow ? countRow.count : 1;
      } else {
        logCount = (this.logCountCache as number) + 1;
      }
      this.logCountCache = logCount;
      if (logCount > 1100) {
        this.sql.exec(`DELETE FROM proxy_logs WHERE id IN (SELECT id FROM proxy_logs ORDER BY timestamp ASC LIMIT 100)`);
        this.logCountCache = null; // recalibrate on the next request
      }
    } catch {}
  }

  async getLogs(limit = 100, providerId?: string, status?: string): Promise<ProxyLogRecord[]> {
    await this.initialize();
    let query = 'SELECT * FROM proxy_logs';
    const conditions: string[] = [];
    const params: any[] = [];

    if (providerId && providerId !== 'all') {
      conditions.push('provider_id = ?');
      params.push(providerId);
    }
    if (status === 'success') {
      conditions.push('status_code >= 200 AND status_code < 300');
    } else if (status === '429') {
      conditions.push('status_code = 429');
    } else if (status === 'error') {
      conditions.push('status_code >= 400 AND status_code != 429');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = [...this.sql.exec(query, ...params)];
    return rows.map((r: any) => ({
      id: r.id,
      timestamp: r.timestamp,
      clientName: r.client_name,
      providerId: r.provider_id,
      providerName: r.provider_name,
      keyMasked: r.key_masked,
      model: r.model,
      mappedModel: r.mapped_model || undefined,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      durationMs: r.duration_ms,
      statusCode: r.status_code,
      isStream: Boolean(r.is_stream),
      errorMessage: r.error_message || undefined
    }));
  }

  async clearLogs(actor = 'admin'): Promise<void> {
    await this.initialize();
    this.sql.exec('DELETE FROM proxy_logs');
    this.logCountCache = 0;
    // Audit table is deliberately NOT cleared here.
    await this.recordAdminAudit('logs.clear', null, 'ok', actor);
  }

  // Actor is always passed explicitly by the caller; there is no
  // instance-level actor field (a previous bug left the password-change
  // row stamped with the previous request's actor).
  async recordAdminAudit(action: string, targetId: string | null, result: string, actor = 'admin'): Promise<void> {
    try {
      await this.initialize();
      this.sql.exec(
        'INSERT INTO admin_audit (timestamp, actor, action, target_id, result) VALUES (?, ?, ?, ?, ?)',
        new Date().toISOString(), actor || 'admin', action, targetId, result
      );
      let auditCount: number;
      if (this.auditCountCache === null) {
        const countRow = [...this.sql.exec('SELECT COUNT(*) as count FROM admin_audit')][0] as any;
        auditCount = countRow ? countRow.count : 1;
      } else {
        auditCount = (this.auditCountCache as number) + 1;
      }
      this.auditCountCache = auditCount;
      if (auditCount > 1000) {
        this.sql.exec(`DELETE FROM admin_audit WHERE id IN (SELECT id FROM admin_audit ORDER BY id ASC LIMIT 100)`);
        this.auditCountCache = null;
      }
    } catch {}
  }

  async getAdminAudit(limit = 100): Promise<any[]> {
    await this.initialize();
    const rows = [...this.sql.exec('SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?', Math.min(500, Math.max(1, limit || 100)))];
    return rows.map((r: any) => ({ id: r.id, timestamp: r.timestamp, actor: r.actor, action: r.action, targetId: r.target_id, result: r.result }));
  }

  async getMetricsSummary(): Promise<SystemMetricsSummary> {
    await this.initialize();
    const providers = await this.getProviders();
    const keys = await this.getKeys();
    const recentLogs = await this.getLogs(50);

    let totalRequests = 0;
    let totalTokens = 0;
    let totalLatency = 0;
    let successCount = 0;

    const providerStats: SystemMetricsSummary['providerStats'] = {};
    for (const p of providers) {
      providerStats[p.id] = { requests: 0, tokens: 0, errors: 0, healthyKeys: 0, totalKeys: 0 };
    }

    for (const k of keys) {
      totalRequests += k.requestCount;
      totalTokens += k.tokenCount;
      if (providerStats[k.providerId]) {
        providerStats[k.providerId].totalKeys++;
        providerStats[k.providerId].requests += k.requestCount;
        providerStats[k.providerId].tokens += k.tokenCount;
        providerStats[k.providerId].errors += k.errorCount;
        if (k.status === 'active') {
          providerStats[k.providerId].healthyKeys++;
        }
      }
    }

    for (const l of recentLogs) {
      totalLatency += l.durationMs;
      if (l.statusCode >= 200 && l.statusCode < 300) {
        successCount++;
      }
    }

    return {
      totalRequests,
      totalTokens,
      activeProvidersCount: providers.filter(p => p.enabled).length,
      totalKeysCount: keys.length,
      activeKeysCount: keys.filter(k => k.status === 'active').length,
      rateLimitedKeysCount: keys.filter(k => k.status === 'rate_limited').length,
      averageLatencyMs: recentLogs.length > 0 ? Math.round(totalLatency / recentLogs.length) : 0,
      successRate: recentLogs.length > 0 ? Math.round((successCount / recentLogs.length) * 100) : 100,
      providerStats
    };
  }

  // --- Global Config & Auth in SQLite ---
  async getConfig(): Promise<GlobalGatewayConfig> {
    await this.initialize();
    if (this.configCache) return this.configCache;
    const rows = [...this.sql.exec('SELECT key, value FROM gateway_config')];
    const map: Record<string, string> = {};
    for (const r of rows as any[]) {
      map[r.key] = r.value;
    }

    this.configCache = {
      defaultProvider: map.defaultProvider || 'gemini',
      defaultStrategy: (map.defaultStrategy as any) || 'round-robin',
      autoCooldownMinutes: map.autoCooldownMinutes ? parseInt(map.autoCooldownMinutes, 10) : 5,
      maxRetries: map.maxRetries ? parseInt(map.maxRetries, 10) : 3,
      enablePublicEndpoints: map.enablePublicEndpoints === 'true',
      adminPasswordHash: map.adminPasswordHash,
      adminPasswordSalt: map.adminPasswordSalt,
      isInitialized: map.isInitialized === 'true',
      corsAllowedOrigins: map.corsAllowedOrigins || '*'
    };
    return this.configCache;
  }

  async updateConfig(updates: Partial<GlobalGatewayConfig>): Promise<GlobalGatewayConfig> {
    await this.initialize();
    this.configCache = null;
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) {
        this.sql.exec('INSERT OR REPLACE INTO gateway_config (key, value) VALUES (?, ?)', k, String(v));
      }
    }
    return this.getConfig();
  }

  async verifyAdminPassword(password: string): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.isInitialized || !config.adminPasswordHash || !config.adminPasswordSalt) {
      return false;
    }
    const computed = await hashPassword(password, config.adminPasswordSalt);
    return timingSafeEqual(computed, config.adminPasswordHash);
  }

  async initializeAdminPassword(password: string): Promise<boolean> {
    const config = await this.getConfig();
    if (config.isInitialized) return false;

    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    await this.updateConfig({
      adminPasswordSalt: salt,
      adminPasswordHash: hash,
      isInitialized: true
    });
    return true;
  }

  async changeAdminPassword(oldPassword: string, newPassword: string, actor = 'admin'): Promise<boolean> {
    const ok = await this.verifyAdminPassword(oldPassword);
    if (!ok) return false;

    const salt = generateSalt();
    const hash = await hashPassword(newPassword, salt);
    await this.updateConfig({
      adminPasswordSalt: salt,
      adminPasswordHash: hash
    });
    await this.recordAdminAudit('admin.password-change', null, 'ok', actor);
    return true;
  }

  async createAdminSession(): Promise<string> {
    await this.initialize();
    const token = generateSessionToken();
    const now = Date.now();
    // Store only a hash of the session token, never the token itself.
    const tokenHash = await sha256Hex(token);
    this.sql.exec('INSERT INTO gateway_config (key, value) VALUES (?, ?)', `sess_${tokenHash}`, now.toString());
    return token;
  }

  async deleteAdminSession(token: string): Promise<void> {
    if (!token) return;
    await this.initialize();
    const tokenHash = await sha256Hex(token);
    this.sql.exec('DELETE FROM gateway_config WHERE key = ?', `sess_${tokenHash}`);
    // Legacy rows stored under the raw token (pre-hash migration).
    this.sql.exec('DELETE FROM gateway_config WHERE key = ?', `sess_${token}`);
  }

  async deleteAllAdminSessions(): Promise<void> {
    await this.initialize();
    this.sql.exec("DELETE FROM gateway_config WHERE key LIKE 'sess_%'");
  }

  async verifyAdminSession(token: string): Promise<boolean> {
    if (!token) return false;
    await this.initialize();
    const tokenHash = await sha256Hex(token);
    let rows = [...this.sql.exec('SELECT value FROM gateway_config WHERE key = ?', `sess_${tokenHash}`)];
    let keyUsed = `sess_${tokenHash}`;
    if (rows.length === 0) {
      // Legacy session stored under the raw token: migrate it to hashed form.
      rows = [...this.sql.exec('SELECT value FROM gateway_config WHERE key = ?', `sess_${token}`)];
      keyUsed = `sess_${token}`;
    }
    if (rows.length === 0) return false;

    // Check session age (7 days expiration)
    const createdAt = parseInt((rows[0] as any).value, 10);
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (isNaN(createdAt) || Date.now() - createdAt > maxAgeMs) {
      // Expired: delete stale session
      this.sql.exec('DELETE FROM gateway_config WHERE key = ?', keyUsed);
      return false;
    }
    if (keyUsed === `sess_${token}`) {
      // Migrate legacy session to hashed storage.
      this.sql.exec('DELETE FROM gateway_config WHERE key = ?', keyUsed);
      this.sql.exec('INSERT INTO gateway_config (key, value) VALUES (?, ?)', `sess_${tokenHash}`, String(createdAt));
    }
    return true;
  }

  // --- Admin auth rate limiting (per IP, in SQL) ---
  private authRateLimitKey(ip: string, endpoint: string): string {
    return `${ip}:${endpoint}`;
  }

  async checkAuthRateLimit(ip: string, endpoint: string): Promise<boolean> {
    await this.initialize();
    const key = this.authRateLimitKey(ip, endpoint);
    const rows = [...this.sql.exec('SELECT attempts, first_at, locked_until FROM auth_failures WHERE key = ?', key)];
    if (rows.length === 0) return true;
    const r: any = rows[0];
    const now = Date.now();
    if (r.locked_until && now < r.locked_until) return false;
    if (now - r.first_at > 15 * 60 * 1000) {
      this.sql.exec('DELETE FROM auth_failures WHERE key = ?', key);
      return true;
    }
    return true;
  }

  async recordAuthFailure(ip: string, endpoint: string): Promise<void> {
    await this.initialize();
    const key = this.authRateLimitKey(ip, endpoint);
    const now = Date.now();
    const rows = [...this.sql.exec('SELECT attempts, first_at FROM auth_failures WHERE key = ?', key)];
    if (rows.length === 0 || now - (rows[0] as any).first_at > 15 * 60 * 1000) {
      this.sql.exec('INSERT OR REPLACE INTO auth_failures (key, attempts, first_at, locked_until) VALUES (?, 1, ?, 0)', key, now);
      return;
    }
    const attempts = (rows[0] as any).attempts + 1;
    const lockedUntil = attempts >= 10 ? now + 15 * 60 * 1000 : 0;
    this.sql.exec('UPDATE auth_failures SET attempts = ?, locked_until = ? WHERE key = ?', attempts, lockedUntil, key);
  }

  async clearAuthFailures(ip: string, endpoint: string): Promise<void> {
    await this.initialize();
    this.sql.exec('DELETE FROM auth_failures WHERE key = ?', this.authRateLimitKey(ip, endpoint));
  }

  async updatePublicSettings(updates: Record<string, unknown>, actor = 'admin'): Promise<GlobalGatewayConfig> {
    // corsAllowedOrigins is deliberately NOT here: the edge (wrangler
    // config) is the single source for CORS, and the DB value was a dead
    // setting that misled the UI in both directions.
    const allowed = ['defaultProvider', 'defaultStrategy', 'autoCooldownMinutes', 'maxRetries', 'enablePublicEndpoints'];
    const filtered: Record<string, unknown> = {};
    for (const k of allowed) {
      if (updates[k] !== undefined) filtered[k] = updates[k];
    }
    const result = await this.updateConfig(filtered as any);
    await this.recordAdminAudit('settings.update', null, 'ok', actor);
    return result;
  }

  private sanitizeConfig(cfg: GlobalGatewayConfig): Record<string, unknown> {
    const { adminPasswordHash: _h, adminPasswordSalt: _s, corsAllowedOrigins: _c, ...rest } = cfg as any;
    return rest;
  }

  private async parseJsonBody(request: Request): Promise<{ ok: true; body: any } | { ok: false }> {
    try {
      const body = await request.json();
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
      return { ok: true, body };
    } catch {
      return { ok: false };
    }
  }

  private clientIp(request: Request): string {
    // cf-connecting-ip is set by Cloudflare itself; x-client-ip is only
    // a fallback, because a client-supplied header must never choose
    // its own rate-limit bucket (the edge already overwrites it, but
    // the DO must not trust it first either).
    return request.headers.get('cf-connecting-ip') || request.headers.get('x-client-ip') || 'unknown';
  }

  // Fetch with redirect:'manual' that only follows a redirect after the
  // Location has passed the same SSRF validation as the initial URL
  // (max 3 hops). Used by all admin probes; chat adapters use manual
  // mode and treat a 3xx as an upstream error instead of following it.
  private async fetchValidated(url: string, init: RequestInit = {}): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= 3; hop++) {
      const resp = await fetch(current, { ...init, redirect: 'manual' });
      const location = resp.headers.get('Location');
      if (![301, 302, 303, 307, 308].includes(resp.status) || !location) return resp;
      const next = new URL(location, current).href;
      const check = AiGatewayCore.validateSafeUrl(next);
      if (!check.safe) throw new Error(`Redirect target blocked: ${check.error || 'unsafe'}`);
      current = next;
    }
    throw new Error('Too many redirects');
  }

  // --- HTTP Dispatcher inside Durable Object ---
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let pathname = url.pathname;

    // Path normalization: support both /api/* and /admin/* seamlessly
    if (pathname.startsWith('/api/')) {
      pathname = pathname.replace('/api/', '/admin/');
    }
    if (pathname === '/admin/config') {
      pathname = '/admin/settings';
    }

    try {
      // 0. Health Check
      if (pathname === '/health' || pathname === '/admin/health') {
        return new Response(JSON.stringify({ status: 'healthy', version: DO_CODE_VERSION, timestamp: Date.now() }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 1. Gateway Client Endpoints (/v1/*)
      if ((pathname === '/v1/chat/completions' || pathname === '/chat/completions') && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization');
        const sessionHeader = request.headers.get('X-Admin-Session');
        let client = await this.core.authenticateClientToken(authHeader);
        const config = await this.getConfig();

        // If client token is not matched, check if caller is authenticated via Admin Session (e.g. Playground / Web UI)
        if (!client && sessionHeader) {
          const isAdmin = await this.verifyAdminSession(sessionHeader);
          if (isAdmin) {
            const sessionActor = (await sha256Hex(sessionHeader)).slice(0, 8);
            client = {
              id: 'client-admin-session',
              name: `Admin Session ${sessionActor}`,
              tokenHash: 'admin',
              tokenPrefix: 'sk-gw-admin',
              status: 'active',
              // 2026-11-05 cap for Playground/admin-session chat: 60 RPM.
              // No daily token cap here, because this synthetic client has
              // no stored quota row and a token increment would falsely
              // refuse non-stream calls; RPM is the enforced cap.
              rpmLimit: 60,
              quotaLimitTokens: 0,
              quotaUsedTokens: 0,
              quotaLimitRequests: 0,
              quotaUsedRequests: 0,
              allowedProviders: ['*'],
              allowedModels: ['*'],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
          }
        }

        const rawBody: any = await request.json().catch(() => null);
        if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
          return new Response(JSON.stringify({ error: { message: 'Invalid chat request: body must be a JSON object' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        if (typeof rawBody.model !== 'string' || !rawBody.model.trim()) {
          return new Response(JSON.stringify({ error: { message: 'Invalid chat request: model must be a non-empty string' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        if (!Array.isArray(rawBody.messages) || rawBody.messages.length === 0) {
          return new Response(JSON.stringify({ error: { message: 'Invalid chat request: messages must be a non-empty array' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const result = await this.core.handleChatCompletion(rawBody, client, config.enablePublicEndpoints, request.signal);

        if (result.type === 'stream') {
          return new Response(result.stream, {
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            }
          });
        } else {
          return new Response(JSON.stringify(result.response), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      if (pathname === '/v1/models' && request.method === 'GET') {
        const authHeader = request.headers.get('Authorization');
        const client = await this.core.authenticateClientToken(authHeader);
        const models = await this.core.listModels(client);
        return new Response(JSON.stringify(models), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if ((pathname === '/v1/embeddings' || pathname === '/embeddings') && request.method === 'POST') {
        return new Response(JSON.stringify({
          error: { message: 'Embeddings are not implemented', type: 'not_implemented', code: 'not_implemented' }
        }), {
          status: 501,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 2. Admin Auth Endpoints (/admin/auth/* & /api/auth/*)
      if ((pathname === '/admin/auth/status' || pathname === '/api/auth/status') && request.method === 'GET') {
        const cfg = await this.getConfig();
        return new Response(JSON.stringify({ isInitialized: cfg.isInitialized }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if ((pathname === '/admin/auth/initialize' || pathname === '/api/auth/initialize') && request.method === 'POST') {
        const ip = this.clientIp(request);
        if (!(await this.checkAuthRateLimit(ip, 'initialize'))) {
          return new Response(JSON.stringify({ error: 'Too many attempts, try again later' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
        }
        const { password } = await request.json().catch(() => ({})) as any;
        if (!password || password.length < 12) {
          return new Response(JSON.stringify({ error: 'Password must be at least 12 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const ok = await this.initializeAdminPassword(password);
        if (ok) await this.clearAuthFailures(ip, 'initialize');
        if (!ok) {
          return new Response(JSON.stringify({ error: 'System already initialized' }), { status: 400 });
        }
        const sessionToken = await this.createAdminSession();
        return new Response(JSON.stringify({ success: true, token: sessionToken, sessionToken }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if ((pathname === '/admin/auth/login' || pathname === '/api/auth/login') && request.method === 'POST') {
        const ip = this.clientIp(request);
        if (!(await this.checkAuthRateLimit(ip, 'login'))) {
          return new Response(JSON.stringify({ success: false, error: 'Too many failed attempts, try again later' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
        }
        const { password } = await request.json().catch(() => ({})) as any;
        const cfg = await this.getConfig();
        if (!cfg.isInitialized) {
          return new Response(JSON.stringify({ success: false, needInitialize: true, error: '请先初始化管理员密码' }), { status: 400 });
        }
        const valid = await this.verifyAdminPassword(password);
        if (!valid) {
          await this.recordAuthFailure(ip, 'login');
          await this.recordAdminAudit('auth.login-failed', null, 'fail', 'anonymous');
          return new Response(JSON.stringify({ success: false, error: '密码错误，请重试' }), { status: 401 });
        }
        await this.clearAuthFailures(ip, 'login');
        const sessionToken = await this.createAdminSession();
        await this.recordAdminAudit('auth.login', null, 'ok', (await sha256Hex(sessionToken)).slice(0, 8));
        return new Response(JSON.stringify({ success: true, token: sessionToken, sessionToken }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if ((pathname === '/admin/auth/change-password' || pathname === '/api/auth/change-password') && request.method === 'POST') {
        const ip = this.clientIp(request);
        if (!(await this.checkAuthRateLimit(ip, 'change-password'))) {
          return new Response(JSON.stringify({ error: 'Too many failed attempts, try again later' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
        }
        const { oldPassword, newPassword } = await request.json().catch(() => ({})) as any;
        if (!newPassword || newPassword.length < 12) {
          return new Response(JSON.stringify({ error: '新密码长度不能少于 12 位' }), { status: 400 });
        }
        const ok = await this.changeAdminPassword(oldPassword || '', newPassword);
        if (!ok) {
          await this.recordAuthFailure(ip, 'change-password');
          return new Response(JSON.stringify({ error: '旧密码错误或修改失败' }), { status: 401 });
        }
        await this.clearAuthFailures(ip, 'change-password');
        return new Response(JSON.stringify({ success: true, message: '密码修改成功' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 2b. Admin Logout: deletes the current session (hashed or legacy).
      if ((pathname === '/admin/auth/logout' || pathname === '/api/auth/logout') && request.method === 'POST') {
        const token = request.headers.get('X-Admin-Session') || request.headers.get('Authorization')?.replace('Bearer ', '');
        if (token) {
          await this.deleteAdminSession(token);
          await this.recordAdminAudit('auth.logout', null, 'ok', (await sha256Hex(token)).slice(0, 8));
        }
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // 3. Admin Protected APIs (/admin/* & /api/*)
      const cfg = await this.getConfig();
      const sessionToken = request.headers.get('X-Admin-Session') || request.headers.get('Authorization')?.replace('Bearer ', '');
      const isAuthorized = sessionToken ? await this.verifyAdminSession(sessionToken) : false;
      // Explicit actor for every protected audit row (no instance field).
      const adminActor = isAuthorized && sessionToken ? (await sha256Hex(sessionToken)).slice(0, 8) : 'admin';

      // Before initialization, only /admin/auth/initialize may be served;
      // every other admin endpoint is unauthorized (no first-come takeover).
      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Admin session required' }), { status: 401 });
      }

      // --- Admin Providers ---
      if ((pathname === '/admin/providers' || pathname === '/api/providers') && request.method === 'GET') {
        const providers = await this.getProviders();
        return new Response(JSON.stringify(providers), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/providers' || pathname === '/api/providers') && request.method === 'POST') {
        const parsed = await this.parseJsonBody(request);
        if (!parsed.ok) return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const body = parsed.body;
        await this.saveProvider(body, body.models, body.modelMappings, adminActor);
        const created = await this.getProvider(body.id || '');
        return new Response(JSON.stringify(created || { success: true, ...body }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/providers/test' || pathname === '/api/providers/test') && request.method === 'POST') {
        const { baseUrl, apiKey, authHeaderFormat, authHeaderName } = await request.json() as any;
        const startTime = Date.now();
        try {
          const urlCheck = AiGatewayCore.validateSafeUrl(baseUrl || 'https://api.openai.com/v1');
          if (!urlCheck.safe) {
            return new Response(JSON.stringify({
              success: false,
              statusCode: 400,
              latencyMs: 0,
              message: `安全拦截: ${urlCheck.error || '非法或受保护的目标地址'}`
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const cleanBase = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
          let targetUrl = `${cleanBase}/models`;
          const headers: Record<string, string> = {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'AI-Multi-Gateway-Probe/1.0'
          };

          if (authHeaderFormat === 'bearer' && apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
          } else if (authHeaderFormat === 'x-api-key' && apiKey) {
            headers[authHeaderName || 'x-api-key'] = apiKey;
          } else if (authHeaderFormat === 'query-param' && apiKey) {
            targetUrl += `?key=${apiKey}`;
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 7000);
          let resp = await this.fetchValidated(targetUrl, {
            method: 'GET',
            headers,
            signal: controller.signal
          }).catch(async () => {
            // Secondary fallback: probe cleanBase root directly
            return await this.fetchValidated(cleanBase, {
              method: 'GET',
              headers,
              signal: controller.signal
            });
          });
          clearTimeout(timeout);

          const durationMs = Date.now() - startTime;
          const status = resp.status;
          const isReachable = status > 0 && status < 500;

          let msg = `连接成功 (HTTP ${status} · ${durationMs}ms)`;
          if (status === 200) {
            msg = `连接正常 (HTTP 200 OK · ${durationMs}ms)`;
          } else if (status === 401 || status === 403) {
            msg = `端点已连通 (HTTP ${status} 认证协议有效 · ${durationMs}ms)`;
          } else if (status === 404) {
            msg = `端点主机已连通 (HTTP 404 目标服务在线 · ${durationMs}ms)`;
          } else if (status === 405) {
            msg = `端点主机已连通 (HTTP 405 方法受限 · ${durationMs}ms)`;
          } else if (status === 429) {
            msg = `端点已连通 (HTTP 429 请求超频 · ${durationMs}ms)`;
          } else if (status >= 500) {
            msg = `目标服务异常 (HTTP ${status} 服务端错误 · ${durationMs}ms)`;
          }

          return new Response(JSON.stringify({
            success: isReachable,
            statusCode: status,
            latencyMs: durationMs,
            message: msg
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (err: any) {
          // Admin-path error scrub: upstream detail goes to the server
          // log only, the client gets a stable generic message.
          console.error('[DO] provider-test error:', err);
          return new Response(JSON.stringify({
            success: false,
            statusCode: 0,
            latencyMs: Date.now() - startTime,
            message: '网络超时或目标域名无法解析'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      if ((pathname === '/admin/providers/fetch-models' || pathname === '/api/providers/fetch-models') && request.method === 'POST') {
        const { providerId, type, baseUrl, apiKey, authHeaderFormat, authHeaderName } = await request.json() as any;
        const startTime = Date.now();

        try {
          if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
            return new Response(JSON.stringify({ success: false, error: '请先填入有效的 API Key' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          let resolvedType = type;
          let resolvedBase = baseUrl;

          if (providerId && (!resolvedType || !resolvedBase)) {
            const p = await this.getProvider(providerId);
            if (p) {
              resolvedType = resolvedType || p.type;
              resolvedBase = resolvedBase || p.baseUrl;
            }
          }

          if (resolvedBase) {
            const urlCheck = AiGatewayCore.validateSafeUrl(resolvedBase);
            if (!urlCheck.safe) {
              return new Response(JSON.stringify({
                success: false,
                statusCode: 400,
                error: `安全拦截: ${urlCheck.error || '非法或受保护的目标地址'}`
              }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }

          const trimmedKey = apiKey.trim();

          if (resolvedType === 'gemini') {
            const rawBase = (resolvedBase || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
            const url = `${rawBase}/v1beta/models`;
            const resp = await this.fetchValidated(url, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'x-goog-api-key': trimmedKey
              }
            });

            if (!resp.ok) {
              const errText = await resp.text().catch(() => '');
              console.error('[DO] fetch-models gemini upstream:', resp.status, errText.slice(0, 300));
              return new Response(JSON.stringify({
                success: false,
                statusCode: resp.status,
                error: `Google Gemini 接口返回异常 (HTTP ${resp.status})`
              }), { status: resp.status, headers: { 'Content-Type': 'application/json' } });
            }

            const data: any = await resp.json();
            const rawList: any[] = Array.isArray(data?.models) ? data.models : [];
            const models = rawList
              .filter((m: any) => {
                const methods = m.supportedGenerationMethods || [];
                return methods.length === 0 || methods.includes('generateContent');
              })
              .map((m: any) => m.name?.replace(/^models\//, '') || '')
              .filter(Boolean);

            const finalModels = models.length > 0 ? models : [
              'gemini-2.5-flash',
              'gemini-2.5-pro',
              'gemini-2.0-flash',
              'gemini-2.0-flash-lite',
              'gemini-1.5-flash',
              'gemini-1.5-pro'
            ];

            return new Response(JSON.stringify({
              success: true,
              latencyMs: Date.now() - startTime,
              count: finalModels.length,
              models: finalModels
            }), { headers: { 'Content-Type': 'application/json' } });
          }

          if (resolvedType === 'anthropic') {
            const rawBase = (resolvedBase || 'https://api.anthropic.com').replace(/\/+$/, '');
            const targetUrl = rawBase.endsWith('/v1') ? `${rawBase}/models` : `${rawBase}/v1/models`;
            try {
              const resp = await this.fetchValidated(targetUrl, {
                method: 'GET',
                headers: {
                  'Accept': 'application/json',
                  'x-api-key': trimmedKey,
                  'anthropic-version': '2023-06-01'
                }
              });
              if (resp.ok) {
                const data: any = await resp.json();
                const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
                const models = list.map((m: any) => m.id || m.name || m).filter(Boolean);
                if (models.length > 0) {
                  return new Response(JSON.stringify({
                    success: true,
                    latencyMs: Date.now() - startTime,
                    count: models.length,
                    models
                  }), { headers: { 'Content-Type': 'application/json' } });
                }
              }
            } catch {}

            const fallback = [
              'claude-3-7-sonnet-20250219',
              'claude-3-5-sonnet-20241022',
              'claude-3-5-haiku-20241022',
              'claude-3-opus-20240229'
            ];
            return new Response(JSON.stringify({
              success: true,
              latencyMs: Date.now() - startTime,
              count: fallback.length,
              models: fallback
            }), { headers: { 'Content-Type': 'application/json' } });
          }

          // OpenAI / DeepSeek / Groq / OpenAI Compatible / Custom
          let cleanBase = (resolvedBase || 'https://api.openai.com/v1').replace(/\/+$/, '');
          let targetUrl = `${cleanBase}/models`;
          const headers: Record<string, string> = {
            'Accept': 'application/json',
            'User-Agent': 'AI-Multi-Gateway-Probe/1.0'
          };

          if (authHeaderFormat === 'x-api-key') {
            headers[authHeaderName || 'x-api-key'] = trimmedKey;
          } else if (authHeaderFormat === 'query-param') {
            targetUrl += `?key=${encodeURIComponent(trimmedKey)}`;
          } else {
            headers['Authorization'] = `Bearer ${trimmedKey}`;
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const resp = await this.fetchValidated(targetUrl, {
            method: 'GET',
            headers,
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            console.error('[DO] fetch-models upstream:', resp.status, errText.slice(0, 300));
            return new Response(JSON.stringify({
              success: false,
              statusCode: resp.status,
              error: `上游返回 HTTP ${resp.status}`
            }), { status: resp.status, headers: { 'Content-Type': 'application/json' } });
          }

          const data: any = await resp.json();
          const rawList: any[] = Array.isArray(data?.data)
            ? data.data
            : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []));

          const models: string[] = rawList
            .map((item: any) => (typeof item === 'string' ? item : item.id || item.name))
            .filter(Boolean);

          return new Response(JSON.stringify({
            success: true,
            latencyMs: Date.now() - startTime,
            count: models.length,
            models
          }), { headers: { 'Content-Type': 'application/json' } });
        } catch (err: any) {
          console.error('[DO] fetch-models error:', err);
          return new Response(JSON.stringify({
            success: false,
            error: '获取模型失败，请检查 Base URL 与 API Key'
          }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      if ((pathname.startsWith('/admin/providers/') || pathname.startsWith('/api/providers/')) && request.method === 'PUT') {
        const id = pathname.replace('/admin/providers/', '').replace('/api/providers/', '');
        const parsed = await this.parseJsonBody(request);
        if (!parsed.ok) return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const body = parsed.body;
        const existing = await this.getProvider(id);
        if (!existing) return new Response(JSON.stringify({ error: 'Provider not found' }), { status: 404 });
        await this.saveProvider({ ...existing, ...body, id }, body.models, body.modelMappings, adminActor);
        const updated = await this.getProvider(id);
        return new Response(JSON.stringify(updated || { success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname.startsWith('/admin/providers/') || pathname.startsWith('/api/providers/')) && request.method === 'DELETE') {
        const id = pathname.replace('/admin/providers/', '').replace('/api/providers/', '');
        await this.deleteProvider(id, adminActor);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // --- Admin Keys (Never returns plaintext or encryptedKey!) ---
      if ((pathname === '/admin/keys' || pathname === '/api/keys') && request.method === 'GET') {
        const providerId = url.searchParams.get('providerId') || undefined;
        const keys = await this.getKeys(providerId);
        return new Response(JSON.stringify(keys), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/keys' || pathname === '/api/keys') && request.method === 'POST') {
        const parsed = await this.parseJsonBody(request);
        if (!parsed.ok) return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const body = parsed.body;
        const key = await this.addKey({
          providerId: body.providerId,
          rawKey: body.key,
          label: body.label,
          weight: body.weight,
          priority: body.priority
        }, undefined, adminActor);
        return new Response(JSON.stringify(key), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/keys/batch' || pathname === '/api/keys/batch') && request.method === 'POST') {
        const body = await request.json() as any;
        const count = await this.batchAddKeys(body.providerId, body.keys || [], undefined, adminActor);
        return new Response(JSON.stringify({ addedCount: count }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/keys/test-all' || pathname === '/api/keys/test-all') && request.method === 'POST') {
        const { providerId } = await request.json().catch(() => ({})) as any;
        await this.initialize();
        const keys = await this.getKeys(providerId);
        const provider = providerId ? await this.getProvider(providerId) : null;
        const results: Array<{ id: string; maskedKey: string; status: string; latencyMs: number; error?: string }> = [];

        for (const k of keys) {
          const start = Date.now();
          try {
            const row = [...this.sql.exec('SELECT encrypted_key FROM api_keys WHERE id = ?', k.id)][0];
            const rawKey = row ? await decryptKey(row.encrypted_key, this.encryptionSecret) : '';
            const keyProvider = provider || (await this.getProvider(k.providerId));
            const ssrfCheck = keyProvider ? AiGatewayCore.validateSafeUrl(keyProvider.baseUrl) : { safe: true };
            if (!ssrfCheck.safe) {
              results.push({
                id: k.id,
                maskedKey: `${k.keyPrefix}••••`,
                status: 'error',
                latencyMs: Date.now() - start,
                error: `Unsafe provider base URL: ${ssrfCheck.error || 'blocked'}`
              });
              continue;
            }

            let ok = false;
            let errStr = '';

            if (k.providerId === 'gemini' || keyProvider?.type === 'gemini') {
              const testUrl = `https://generativelanguage.googleapis.com/v1beta/models`;
              const r = await this.fetchValidated(testUrl, { headers: { 'x-goog-api-key': rawKey, 'Accept': 'application/json' } });
              ok = r.ok;
              if (!ok) errStr = `HTTP ${r.status}`;
            } else if (k.providerId === 'anthropic' || keyProvider?.type === 'anthropic') {
              const base = (keyProvider?.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
              const testUrl = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
              const r = await this.fetchValidated(testUrl, {
                headers: {
                  'x-api-key': rawKey,
                  'anthropic-version': '2023-06-01',
                  'Accept': 'application/json'
                }
              });
              ok = r.ok;
              if (!ok) errStr = `HTTP ${r.status}`;
            } else {
              const base = (keyProvider?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
              const headers: Record<string, string> = { 'Accept': 'application/json' };
              let testUrl = `${base}/models`;
              if (keyProvider?.authHeaderFormat === 'x-api-key') {
                headers[keyProvider.authHeaderName || 'x-api-key'] = rawKey;
              } else if (keyProvider?.authHeaderFormat === 'query-param') {
                testUrl += `?key=${encodeURIComponent(rawKey)}`;
              } else {
                headers['Authorization'] = `Bearer ${rawKey}`;
              }
              const r = await this.fetchValidated(testUrl, { headers });
              ok = r.ok;
              if (!ok) errStr = `HTTP ${r.status}`;
            }

            const lat = Date.now() - start;
            if (ok) {
              await this.updateKeyStatus(k.id, 'active', undefined, undefined);
            } else if (errStr.includes('401') || errStr.includes('403')) {
              await this.updateKeyStatus(k.id, 'invalid', undefined, errStr);
            } else if (errStr.includes('429')) {
              // Real cooldown timestamp, never 0 for a rate-limited key.
              await this.updateKeyStatus(k.id, 'rate_limited', Date.now() + 5 * 60 * 1000, errStr);
            }
            // Other errors leave the key status unchanged.
            const newStatus = ok ? 'active' : (errStr.includes('401') || errStr.includes('403') ? 'invalid' : (errStr.includes('429') ? 'rate_limited' : 'error'));

            results.push({
              id: k.id,
              maskedKey: `${k.keyPrefix}••••`,
              status: newStatus,
              latencyMs: lat,
              error: ok ? undefined : errStr
            });
          } catch (e: any) {
            // Transport/decrypt errors leave the key status unchanged.
            results.push({
              id: k.id,
              maskedKey: `${k.keyPrefix}••••`,
              status: 'error',
              latencyMs: Date.now() - start,
              error: e.message
            });
          }
        }

        await this.recordAdminAudit('keys.test-all', providerId || null, 'ok', adminActor);
        return new Response(JSON.stringify({ results }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if ((pathname.startsWith('/admin/keys/') || pathname.startsWith('/api/keys/')) && request.method === 'PUT') {
        const id = pathname.replace('/admin/keys/', '').replace('/api/keys/', '');
        const body = await request.json() as any;
        const updated = await this.updateKey(id, {
          providerId: body.providerId,
          key: body.key,
          label: body.label,
          weight: body.weight !== undefined ? Number(body.weight) : undefined,
          priority: body.priority !== undefined ? Number(body.priority) : undefined,
          status: body.status,
          cooldownUntil: body.cooldownUntil,
          lastError: body.lastError
        }, undefined, adminActor);
        if (!updated) {
          return new Response(JSON.stringify({ error: 'Key not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname.startsWith('/admin/keys/') || pathname.startsWith('/api/keys/')) && request.method === 'DELETE') {
        const id = pathname.replace('/admin/keys/', '').replace('/api/keys/', '');
        await this.deleteKey(id, adminActor);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // --- Admin Clients ---
      if ((pathname === '/admin/clients' || pathname === '/api/clients') && request.method === 'GET') {
        const clients = await this.getClients();
        return new Response(JSON.stringify(clients), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/clients' || pathname === '/api/clients') && request.method === 'POST') {
        const parsed = await this.parseJsonBody(request);
        if (!parsed.ok) return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const body = parsed.body;
        const created = await this.createClient(body, adminActor);
        return new Response(JSON.stringify(created), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname.startsWith('/admin/clients/') || pathname.startsWith('/api/clients/')) && request.method === 'PUT') {
        const id = pathname.replace('/admin/clients/', '').replace('/api/clients/', '');
        const body = await request.json() as any;
        const updated = await this.updateClient(id, body, adminActor);
        return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname.startsWith('/admin/clients/') || pathname.startsWith('/api/clients/')) && request.method === 'DELETE') {
        const id = pathname.replace('/admin/clients/', '').replace('/api/clients/', '');
        await this.deleteClient(id, adminActor);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/audit' || pathname === '/api/audit') && request.method === 'GET') {
        const audit = await this.getAdminAudit(parseInt(url.searchParams.get('limit') || '100', 10) || 100);
        return new Response(JSON.stringify(audit), { headers: { 'Content-Type': 'application/json' } });
      }

      // --- Admin Logs & Metrics ---
      if ((pathname === '/admin/logs' || pathname === '/api/logs') && request.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        const providerId = url.searchParams.get('providerId') || undefined;
        const status = url.searchParams.get('status') || undefined;
        const logs = await this.getLogs(limit, providerId, status);
        return new Response(JSON.stringify(logs), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/logs/clear' || pathname === '/api/logs/clear') && request.method === 'DELETE') {
        await this.clearLogs(adminActor);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/metrics' || pathname === '/api/metrics') && request.method === 'GET') {
        const metrics = await this.getMetricsSummary();
        return new Response(JSON.stringify(metrics), { headers: { 'Content-Type': 'application/json' } });
      }

      // --- Admin Settings / Config ---
      if ((pathname === '/admin/settings' || pathname === '/api/settings' || pathname === '/api/config') && request.method === 'GET') {
        const cfg = await this.getConfig();
        return new Response(JSON.stringify(this.sanitizeConfig(cfg)), { headers: { 'Content-Type': 'application/json' } });
      }

      if ((pathname === '/admin/settings' || pathname === '/api/settings' || pathname === '/api/config') && request.method === 'PUT') {
        const parsed = await this.parseJsonBody(request);
        if (!parsed.ok) return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const updated = await this.updatePublicSettings(parsed.body, adminActor);
        return new Response(JSON.stringify(this.sanitizeConfig(updated)), { headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), { status: 404 });
    } catch (err: any) {
      const isJsonError = err instanceof SyntaxError || (typeof err?.message === 'string' && err.message.includes('JSON'));
      const status = err instanceof GatewayError ? err.statusCode : (isJsonError ? 400 : 500);
      // 500s never leak internal/SQLite detail to the caller; full detail
      // stays in server-side logging only.
      const message = status === 500 ? 'Internal Server Error' : (err.message || 'Internal Server Error');
      if (status === 500) console.error('[DO] Internal error:', err);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (status === 429 && err instanceof GatewayError && err.retryAfterMs) {
        headers['Retry-After'] = String(Math.max(1, Math.ceil(err.retryAfterMs / 1000)));
      }
      return new Response(JSON.stringify({ error: { message } }), { status, headers });
    }
  }
}
