import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ProviderConfig,
  ApiKeyItem,
  ClientToken,
  ProxyLogItem,
  GlobalConfig,
  SystemMetrics
} from '../src/types/index.js';
import { timingSafeEqual, validateSafeUrl as robustValidateSafeUrl } from '../src/core/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'gateway-store.json');

export interface StoreData {
  providers: ProviderConfig[];
  keys: ApiKeyItem[];
  clients: ClientToken[];
  logs: ProxyLogItem[];
  config: GlobalConfig;
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****' + key.slice(-2);
  return key.slice(0, 4) + '...' + key.slice(-4);
}

export function validateSafeUrl(urlStr: string): { safe: boolean; error?: string } {
  return robustValidateSafeUrl(urlStr);
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    authHeaderFormat: 'query-param',
    enabled: true,
    models: [
      'gemini-3.8-flash',
      'gemini-3.8-pro',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-thinking',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b'
    ],
    modelMappings: {
      'gpt-4o': 'gemini-3.8-flash',
      'gpt-4o-mini': 'gemini-3.8-flash',
      'gpt-4': 'gemini-3.8-pro'
    },
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 60,
    maxRetries: 3,
    isCustom: false,
    description: 'Google DeepMind official Gemini API with native high speed & quota',
    createdAt: new Date().toISOString()
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    authHeaderFormat: 'bearer',
    enabled: true,
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o3-mini',
      'gpt-4-turbo',
      'text-embedding-3-small',
      'text-embedding-3-large'
    ],
    modelMappings: {},
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 60,
    maxRetries: 3,
    isCustom: false,
    description: 'OpenAI official endpoints for GPT-4o, o-series reasoning models',
    createdAt: new Date().toISOString()
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authHeaderFormat: 'x-api-key',
    authHeaderName: 'x-api-key',
    enabled: true,
    models: [
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229'
    ],
    modelMappings: {
      'claude-3-7-sonnet': 'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku': 'claude-3-5-haiku-20241022'
    },
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 90,
    maxRetries: 3,
    isCustom: false,
    description: 'Anthropic Claude models with extended thinking and reasoning capabilities',
    createdAt: new Date().toISOString()
  },
  {
    id: 'deepseek',
    name: 'DeepSeek AI',
    type: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    authHeaderFormat: 'bearer',
    enabled: true,
    models: [
      'deepseek-chat',
      'deepseek-reasoner'
    ],
    modelMappings: {
      'deepseek-v3': 'deepseek-chat',
      'deepseek-r1': 'deepseek-reasoner'
    },
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 120,
    maxRetries: 3,
    isCustom: false,
    description: 'DeepSeek high intelligence & math/code reasoning models at ultra-low cost',
    createdAt: new Date().toISOString()
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    type: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authHeaderFormat: 'bearer',
    enabled: true,
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'deepseek-r1-distill-llama-70b'
    ],
    modelMappings: {},
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 30,
    maxRetries: 2,
    isCustom: false,
    description: 'Groq LPU ultra-high throughput inference engine',
    createdAt: new Date().toISOString()
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    type: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    authHeaderFormat: 'bearer',
    enabled: true,
    models: [
      'grok-4',
      'grok-3',
      'grok-3-mini'
    ],
    modelMappings: {},
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 60,
    maxRetries: 3,
    isCustom: false,
    description: 'xAI Grok models via OpenAI-compatible API',
    createdAt: new Date().toISOString()
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    authHeaderFormat: 'bearer',
    enabled: true,
    models: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest'
    ],
    modelMappings: {},
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 60,
    maxRetries: 3,
    isCustom: false,
    description: 'Mistral AI models via OpenAI-compatible API',
    createdAt: new Date().toISOString()
  },
  {
    id: 'cohere',
    name: 'Cohere',
    type: 'openai',
    baseUrl: 'https://api.cohere.com/compatibility/v1',
    authHeaderFormat: 'bearer',
    enabled: true,
    models: [
      'command-a',
      'command-r-plus',
      'command-r'
    ],
    modelMappings: {},
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 60,
    maxRetries: 3,
    isCustom: false,
    description: 'Cohere models via OpenAI compatibility API',
    createdAt: new Date().toISOString()
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    authHeaderFormat: 'bearer',
    enabled: true,
    models: [
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
      'google/gemini-2.5-flash'
    ],
    modelMappings: {},
    loadBalanceStrategy: 'round-robin',
    timeoutSeconds: 60,
    maxRetries: 3,
    isCustom: false,
    description: 'OpenRouter multi-model routing via OpenAI-compatible API',
    createdAt: new Date().toISOString()
  }
];

class StorageManager {
  private data: StoreData;
  private keyIndices: Map<string, number> = new Map();

  constructor() {
    this.data = this.loadData();
    this.rebuildKeyIndices();
    this.autoSeedEnvKeys();
  }

  private loadData(): StoreData {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<StoreData>;
        return {
          providers: parsed.providers && parsed.providers.length > 0 ? parsed.providers : DEFAULT_PROVIDERS,
          keys: parsed.keys || [],
          clients: parsed.clients || [
            {
              id: 'client-default-admin',
              name: 'Admin Gateway Master Key',
              token: 'sk-gw-' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
              status: 'active',
              allowedProviders: ['*'],
              allowedModels: ['*'],
              rpmLimit: 0,
              quotaLimitTokens: 0,
              quotaUsedTokens: 0,
              quotaLimitRequests: 0,
              quotaUsedRequests: 0,
              createdAt: new Date().toISOString()
            }
          ],
          logs: parsed.logs || [],
          config: {
            defaultProvider: parsed.config?.defaultProvider || 'gemini',
            defaultStrategy: parsed.config?.defaultStrategy || 'round-robin',
            autoCooldownMinutes: parsed.config?.autoCooldownMinutes ?? 5,
            maxRetries: parsed.config?.maxRetries ?? 3,
            enablePublicEndpoints: parsed.config?.enablePublicEndpoints ?? true,
            isInitialized: parsed.config?.isInitialized ?? false,
            adminPassword: parsed.config?.adminPassword || ''
          }
        };
      }
    } catch (e) {
      console.error('[StorageManager] Error reading storage file, initializing defaults:', e);
    }

    return {
      providers: DEFAULT_PROVIDERS,
      keys: [],
      clients: [
        {
          id: 'client-default-admin',
          name: 'Admin Gateway Master Key',
          token: 'sk-gw-admin-' + Math.random().toString(36).substring(2, 10),
          status: 'active',
          allowedProviders: ['*'],
          allowedModels: ['*'],
          rpmLimit: 0,
          quotaLimitTokens: 0,
          quotaUsedTokens: 0,
          quotaLimitRequests: 0,
          quotaUsedRequests: 0,
          createdAt: new Date().toISOString()
        }
      ],
      logs: [],
      config: {
        defaultProvider: 'gemini',
        defaultStrategy: 'round-robin',
        autoCooldownMinutes: 5,
        maxRetries: 3,
        enablePublicEndpoints: true,
        isInitialized: false,
        adminPassword: ''
      }
    };
  }

  private autoSeedEnvKeys() {
    // Check if GEMINI_API_KEY is present in process.env and not yet in Gemini keys
    const geminiEnv = process.env.GEMINI_API_KEY;
    if (geminiEnv && geminiEnv !== 'MY_GEMINI_API_KEY') {
      const exists = this.data.keys.some(k => k.providerId === 'gemini' && k.key === geminiEnv);
      if (!exists) {
        this.addKey({
          providerId: 'gemini',
          key: geminiEnv,
          label: 'Default AI Studio Gemini Key',
          weight: 1,
          status: 'active'
        });
      }
    }
  }

  private save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[StorageManager] Failed to save store:', e);
    }
  }

  private rebuildKeyIndices() {
    this.keyIndices.clear();
    for (const p of this.data.providers) {
      this.keyIndices.set(p.id, 0);
    }
  }

  // --- Providers ---
  getProviders(): ProviderConfig[] {
    return this.data.providers.map(p => ({
      ...p,
      models: Array.isArray(p.models) ? p.models : []
    }));
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.data.providers.find(p => p.id === id);
  }

  upsertProvider(provider: ProviderConfig): ProviderConfig {
    const idx = this.data.providers.findIndex(p => p.id === provider.id);
    if (idx >= 0) {
      this.data.providers[idx] = { ...this.data.providers[idx], ...provider };
    } else {
      this.data.providers.push(provider);
      this.keyIndices.set(provider.id, 0);
    }
    this.save();
    return provider;
  }

  deleteProvider(id: string): boolean {
    const idx = this.data.providers.findIndex(p => p.id === id);
    if (idx >= 0) {
      this.data.providers.splice(idx, 1);
      // Also clean up keys for this provider
      this.data.keys = this.data.keys.filter(k => k.providerId !== id);
      this.keyIndices.delete(id);
      this.save();
      return true;
    }
    return false;
  }

  // --- Keys ---
  getKeys(providerId?: string): ApiKeyItem[] {
    const now = Date.now();
    // Auto-recover cooldown keys
    let changed = false;
    for (const key of this.data.keys) {
      if (key.status === 'rate_limited' && key.cooldownUntil && now >= key.cooldownUntil) {
        key.status = 'active';
        key.cooldownUntil = undefined;
        changed = true;
      }
    }
    if (changed) this.save();

    if (providerId) {
      return this.data.keys.filter(k => k.providerId === providerId);
    }
    return this.data.keys;
  }

  getKey(id: string): ApiKeyItem | undefined {
    return this.data.keys.find(k => k.id === id);
  }

  addKey(params: {
    providerId: string;
    key: string;
    label?: string;
    weight?: number;
    status?: ApiKeyItem['status'];
  }): ApiKeyItem {
    const id = 'key-' + Math.random().toString(36).substring(2, 10);
    const item: ApiKeyItem = {
      id,
      providerId: params.providerId,
      key: params.key.trim(),
      maskedKey: maskKey(params.key.trim()),
      label: params.label?.trim() || `${params.providerId}-key-${this.data.keys.filter(k => k.providerId === params.providerId).length + 1}`,
      weight: Math.max(1, params.weight || 1),
      status: params.status || 'active',
      totalRequests: 0,
      totalTokens: 0,
      successCount: 0,
      errorCount: 0,
      createdAt: new Date().toISOString()
    };
    this.data.keys.push(item);
    this.save();
    return item;
  }

  batchAddKeys(providerId: string, keys: string[]): ApiKeyItem[] {
    const added: ApiKeyItem[] = [];
    for (const rawKey of keys) {
      const clean = rawKey.trim();
      if (!clean) continue;
      // Prevent exact duplicates in the same provider
      const exists = this.data.keys.some(k => k.providerId === providerId && k.key === clean);
      if (!exists) {
        const item = this.addKey({ providerId, key: clean });
        added.push(item);
      }
    }
    return added;
  }

  updateKey(id: string, updates: Partial<ApiKeyItem>): ApiKeyItem | null {
    const key = this.data.keys.find(k => k.id === id);
    if (!key) return null;
    if (updates.key) {
      key.key = updates.key.trim();
      key.maskedKey = maskKey(key.key);
    }
    if (updates.providerId) key.providerId = updates.providerId;
    if (updates.label !== undefined) key.label = updates.label;
    if (updates.weight !== undefined) key.weight = Math.max(1, updates.weight);
    if (updates.status !== undefined) {
      key.status = updates.status;
      if (key.status === 'active') {
        key.cooldownUntil = undefined;
      }
    }
    this.save();
    return key;
  }

  deleteKey(id: string): boolean {
    const idx = this.data.keys.findIndex(k => k.id === id);
    if (idx >= 0) {
      this.data.keys.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  recordKeyUsage(params: {
    keyId: string;
    tokens?: number;
    success: boolean;
    statusCode: number;
    errorMessage?: string;
  }) {
    const key = this.data.keys.find(k => k.id === params.keyId);
    if (!key) return;

    key.totalRequests += 1;
    key.lastUsedAt = new Date().toISOString();
    key.lastStatusCode = params.statusCode;

    if (params.tokens) {
      key.totalTokens += params.tokens;
    }

    if (params.success) {
      key.successCount += 1;
      key.lastError = undefined;
    } else {
      key.errorCount += 1;
      key.lastError = params.errorMessage || `HTTP Error ${params.statusCode}`;

      // Handle 429 Too Many Requests -> Quarantine key for auto-cooldown
      if (params.statusCode === 429) {
        const cooldownMins = this.data.config.autoCooldownMinutes || 5;
        key.status = 'rate_limited';
        key.cooldownUntil = Date.now() + cooldownMins * 60 * 1000;
      } else if (params.statusCode === 401 || params.statusCode === 403) {
        // Invalid or expired key
        key.status = 'invalid';
      }
    }

    this.save();
  }

  // --- Next Key Selection per Strategy ---
  selectNextKey(providerId: string, excludedKeyIds: Set<string> = new Set()): ApiKeyItem | null {
    const provider = this.getProvider(providerId);
    const strategy = provider?.loadBalanceStrategy || this.data.config.defaultStrategy || 'round-robin';
    const now = Date.now();

    // Active candidate keys
    const candidates = this.data.keys.filter(k => {
      if (k.providerId !== providerId) return false;
      if (excludedKeyIds.has(k.id)) return false;
      if (k.status === 'disabled' || k.status === 'invalid') return false;
      if (k.status === 'rate_limited') {
        if (k.cooldownUntil && now >= k.cooldownUntil) {
          k.status = 'active';
          k.cooldownUntil = undefined;
          return true;
        }
        return false;
      }
      return k.status === 'active';
    });

    if (candidates.length === 0) return null;

    if (strategy === 'random') {
      const idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx];
    }

    if (strategy === 'least-errors') {
      // Pick key with lowest error count, or highest success rate
      return candidates.slice().sort((a, b) => {
        const rateA = a.totalRequests > 0 ? a.errorCount / a.totalRequests : 0;
        const rateB = b.totalRequests > 0 ? b.errorCount / b.totalRequests : 0;
        return rateA - rateB;
      })[0];
    }

    if (strategy === 'weighted') {
      const totalWeight = candidates.reduce((sum, c) => sum + (c.weight || 1), 0);
      let rand = Math.random() * totalWeight;
      for (const c of candidates) {
        rand -= (c.weight || 1);
        if (rand <= 0) return c;
      }
      return candidates[0];
    }

    // Default: Round-Robin
    const currentIndex = this.keyIndices.get(providerId) || 0;
    const selected = candidates[currentIndex % candidates.length];
    this.keyIndices.set(providerId, (currentIndex + 1) % candidates.length);
    return selected;
  }

  // --- Clients ---
  getClients(): ClientToken[] {
    return this.data.clients;
  }

  getClient(tokenOrId: string): ClientToken | undefined {
    return this.data.clients.find(c => c.token === tokenOrId || c.id === tokenOrId);
  }

  addClient(params: Partial<ClientToken>): ClientToken {
    const id = 'client-' + Math.random().toString(36).substring(2, 10);
    const token = params.token?.trim() || 'sk-gw-' + Math.random().toString(36).substring(2, 14) + Math.random().toString(36).substring(2, 14);
    const item: ClientToken = {
      id,
      name: params.name?.trim() || 'API Client',
      token,
      status: params.status || 'active',
      allowedProviders: params.allowedProviders && params.allowedProviders.length > 0 ? params.allowedProviders : ['*'],
      allowedModels: params.allowedModels && params.allowedModels.length > 0 ? params.allowedModels : ['*'],
      rpmLimit: params.rpmLimit || 0,
      quotaLimitTokens: params.quotaLimitTokens || 0,
      quotaUsedTokens: 0,
      quotaLimitRequests: params.quotaLimitRequests || 0,
      quotaUsedRequests: 0,
      expiresAt: params.expiresAt,
      createdAt: new Date().toISOString()
    };
    this.data.clients.push(item);
    this.save();
    return item;
  }

  updateClient(id: string, updates: Partial<ClientToken>): ClientToken | null {
    const client = this.data.clients.find(c => c.id === id);
    if (!client) return null;
    Object.assign(client, updates);
    this.save();
    return client;
  }

  deleteClient(id: string): boolean {
    const idx = this.data.clients.findIndex(c => c.id === id);
    if (idx >= 0) {
      this.data.clients.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  recordClientUsage(clientId: string, tokens: number) {
    const client = this.data.clients.find(c => c.id === clientId);
    if (!client) return;
    client.quotaUsedRequests += 1;
    client.quotaUsedTokens += tokens;
    client.lastUsedAt = new Date().toISOString();
    this.save();
  }

  // --- Logs ---
  addLog(log: Omit<ProxyLogItem, 'id' | 'timestamp'>): ProxyLogItem {
    const item: ProxyLogItem = {
      ...log,
      id: 'log-' + Math.random().toString(36).substring(2, 10),
      timestamp: new Date().toISOString()
    };
    this.data.logs.unshift(item);
    if (this.data.logs.length > 1000) {
      this.data.logs = this.data.logs.slice(0, 1000);
    }
    this.save();
    return item;
  }

  getLogs(limit = 100, providerId?: string, status?: string): ProxyLogItem[] {
    let filtered = this.data.logs;
    if (providerId) {
      filtered = filtered.filter(l => l.providerId === providerId);
    }
    if (status) {
      if (status === 'success') {
        filtered = filtered.filter(l => l.statusCode >= 200 && l.statusCode < 300);
      } else if (status === 'error') {
        filtered = filtered.filter(l => l.statusCode >= 400);
      }
    }
    return filtered.slice(0, limit);
  }

  clearLogs() {
    this.data.logs = [];
    this.save();
  }

  // --- Config & Auth ---
  getConfig(): GlobalConfig {
    // Mask password in general config responses
    const cfg = { ...this.data.config };
    if (cfg.adminPassword) {
      cfg.adminPassword = '********';
    }
    return cfg;
  }

  isInitialized(): boolean {
    return Boolean(this.data.config.isInitialized && this.data.config.adminPassword);
  }

  initializePassword(password: string): boolean {
    if (this.isInitialized()) {
      return false; // Already initialized
    }
    this.data.config.adminPassword = password.trim();
    this.data.config.isInitialized = true;
    this.save();
    return true;
  }

  verifyPassword(password: string): boolean {
    if (!this.data.config.adminPassword) return false;
    return timingSafeEqual(this.data.config.adminPassword, password.trim());
  }

  changePassword(oldPassword: string, newPassword: string): boolean {
    if (!this.verifyPassword(oldPassword)) {
      return false;
    }
    this.data.config.adminPassword = newPassword.trim();
    this.data.config.isInitialized = true;
    this.save();
    return true;
  }

  createAdminSession(): string {
    const token = 'sess_' + Math.random().toString(36).substring(2, 14) + Math.random().toString(36).substring(2, 14);
    if (!(this.data.config as any).sessions) {
      (this.data.config as any).sessions = {};
    }
    (this.data.config as any).sessions[token] = Date.now();
    this.save();
    return token;
  }

  verifyAdminSession(token: string): boolean {
    if (!token) return false;
    const sessions = (this.data.config as any).sessions || {};
    const createdAt = sessions[token];
    if (!createdAt) {
      return false;
    }
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - createdAt > maxAgeMs) {
      delete sessions[token];
      this.save();
      return false;
    }
    return true;
  }

  validateSafeUrl(url: string) {
    return validateSafeUrl(url);
  }

  updateConfig(updates: Partial<GlobalConfig>): GlobalConfig {
    const toUpdate = { ...updates };
    // Do not overwrite password with masked value
    if (toUpdate.adminPassword === '********' || !toUpdate.adminPassword) {
      delete toUpdate.adminPassword;
    }
    this.data.config = { ...this.data.config, ...toUpdate };
    this.save();
    return this.getConfig();
  }

  // --- System Metrics ---
  getMetrics(): SystemMetrics {
    const keys = this.getKeys();
    let totalReq = 0;
    let totalTok = 0;
    let successCount = 0;
    let errorCount = 0;
    let activeKeys = 0;
    let rateLimited = 0;
    let invalidKeys = 0;

    const providerStats: SystemMetrics['providerStats'] = {};
    for (const p of this.data.providers) {
      providerStats[p.id] = {
        requests: 0,
        tokens: 0,
        errors: 0,
        healthyKeys: 0,
        totalKeys: 0
      };
    }

    for (const k of keys) {
      totalReq += k.totalRequests;
      totalTok += k.totalTokens;
      successCount += k.successCount;
      errorCount += k.errorCount;

      if (k.status === 'active') activeKeys++;
      else if (k.status === 'rate_limited') rateLimited++;
      else if (k.status === 'invalid') invalidKeys++;

      if (!providerStats[k.providerId]) {
        providerStats[k.providerId] = {
          requests: 0,
          tokens: 0,
          errors: 0,
          healthyKeys: 0,
          totalKeys: 0
        };
      }
      providerStats[k.providerId].requests += k.totalRequests;
      providerStats[k.providerId].tokens += k.totalTokens;
      providerStats[k.providerId].errors += k.errorCount;
      providerStats[k.providerId].totalKeys += 1;
      if (k.status === 'active') {
        providerStats[k.providerId].healthyKeys += 1;
      }
    }

    const totalAttempts = successCount + errorCount;
    const successRate = totalAttempts > 0 ? Math.round((successCount / totalAttempts) * 1000) / 10 : 100;

    // Latency from recent logs
    const recentLogs = this.data.logs.slice(0, 50);
    const avgLatency = recentLogs.length > 0
      ? Math.round(recentLogs.reduce((sum, l) => sum + l.durationMs, 0) / recentLogs.length)
      : 0;

    return {
      totalRequests: totalReq,
      totalTokens: totalTok,
      activeProvidersCount: this.data.providers.filter(p => p.enabled).length,
      totalKeysCount: keys.length,
      activeKeysCount: activeKeys,
      rateLimitedKeysCount: rateLimited,
      invalidKeysCount: invalidKeys,
      successRate,
      averageLatencyMs: avgLatency,
      providerStats
    };
  }
}

export const store = new StorageManager();
