/**
 * Normalized SQLite Database Schema and Versioned Migrations
 * Designed for Cloudflare Durable Objects SQLite (ctx.storage.sql)
 */

export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_normalized_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        auth_header_format TEXT NOT NULL DEFAULT 'bearer',
        auth_header_name TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        strategy TEXT NOT NULL DEFAULT 'round-robin',
        timeout_ms INTEGER NOT NULL DEFAULT 60000,
        max_retries INTEGER NOT NULL DEFAULT 3,
        is_custom INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_models (
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        alias TEXT,
        PRIMARY KEY (provider_id, model),
        FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS model_mappings (
        from_model TEXT PRIMARY KEY,
        to_model TEXT NOT NULL,
        provider_id TEXT
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        weight INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 1,
        request_count INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider_id, status);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

      CREATE TABLE IF NOT EXISTS client_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        rpm_limit INTEGER NOT NULL DEFAULT 0,
        quota_limit_tokens INTEGER NOT NULL DEFAULT 0,
        quota_used_tokens INTEGER NOT NULL DEFAULT 0,
        quota_limit_requests INTEGER NOT NULL DEFAULT 0,
        quota_used_requests INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_client_tokens_hash ON client_tokens(token_hash);

      CREATE TABLE IF NOT EXISTS client_provider_permissions (
        client_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        PRIMARY KEY (client_id, provider_id),
        FOREIGN KEY (client_id) REFERENCES client_tokens(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS client_model_permissions (
        client_id TEXT NOT NULL,
        model TEXT NOT NULL,
        PRIMARY KEY (client_id, model),
        FOREIGN KEY (client_id) REFERENCES client_tokens(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provider_state (
        provider_id TEXT PRIMARY KEY,
        rr_cursor INTEGER NOT NULL DEFAULT 0,
        circuit_status TEXT NOT NULL DEFAULT 'closed',
        circuit_fail_count INTEGER NOT NULL DEFAULT 0,
        circuit_cooldown_until INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proxy_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        client_name TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        key_masked TEXT NOT NULL,
        model TEXT NOT NULL,
        mapped_model TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status_code INTEGER NOT NULL,
        is_stream INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_proxy_logs_timestamp ON proxy_logs(timestamp DESC);

      CREATE TABLE IF NOT EXISTS metrics_hourly (
        provider_id TEXT NOT NULL,
        hour_timestamp TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        latency_sum INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider_id, hour_timestamp)
      );

      CREATE TABLE IF NOT EXISTS gateway_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  }
];

export const DEFAULT_PROVIDERS_DATA = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    authHeaderFormat: 'query-param',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 60000,
    maxRetries: 3,
    isCustom: 0,
    description: 'Google DeepMind official Gemini API with native high speed & quota',
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
    mappings: {
      'gpt-4o': 'gemini-3.8-flash',
      'gpt-4o-mini': 'gemini-3.8-flash',
      'gpt-4': 'gemini-3.8-pro'
    }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    authHeaderFormat: 'bearer',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 60000,
    maxRetries: 3,
    isCustom: 0,
    description: 'OpenAI official API including GPT-4o, o1, o3-mini',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o3-mini',
      'gpt-4-turbo',
      'text-embedding-3-small',
      'text-embedding-3-large'
    ],
    mappings: {}
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    authHeaderFormat: 'x-api-key',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 90000,
    maxRetries: 3,
    isCustom: 0,
    description: 'Anthropic Claude models with extended thinking and reasoning capabilities',
    models: [
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229'
    ],
    mappings: {
      'claude-3-7-sonnet': 'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku': 'claude-3-5-haiku-20241022'
    }
  },
  {
    id: 'deepseek',
    name: 'DeepSeek AI',
    type: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    authHeaderFormat: 'bearer',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 120000,
    maxRetries: 3,
    isCustom: 0,
    description: 'DeepSeek high intelligence & math/code reasoning models at ultra-low cost',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    mappings: {
      'deepseek-v3': 'deepseek-chat',
      'deepseek-r1': 'deepseek-reasoner'
    }
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    type: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authHeaderFormat: 'bearer',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 30000,
    maxRetries: 3,
    isCustom: 0,
    description: 'Ultra-fast LPU inference engine',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'deepseek-r1-distill-llama-70b'
    ],
    mappings: {}
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    type: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    authHeaderFormat: 'bearer',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 60000,
    maxRetries: 3,
    isCustom: 0,
    description: 'xAI Grok models via OpenAI-compatible API',
    models: [
      'grok-4',
      'grok-3',
      'grok-3-mini'
    ],
    mappings: {}
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    authHeaderFormat: 'bearer',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 60000,
    maxRetries: 3,
    isCustom: 0,
    description: 'Mistral AI models via OpenAI-compatible API',
    models: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest'
    ],
    mappings: {}
  },
  {
    id: 'cohere',
    name: 'Cohere',
    type: 'openai',
    baseUrl: 'https://api.cohere.com/compatibility/v1',
    authHeaderFormat: 'bearer',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 60000,
    maxRetries: 3,
    isCustom: 0,
    description: 'Cohere models via OpenAI compatibility API',
    models: [
      'command-a',
      'command-r-plus',
      'command-r'
    ],
    mappings: {}
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    authHeaderFormat: 'bearer',
    enabled: 1,
    strategy: 'round-robin',
    timeoutMs: 60000,
    maxRetries: 3,
    isCustom: 0,
    description: 'OpenRouter multi-model routing via OpenAI-compatible API',
    models: [
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
      'google/gemini-2.5-flash'
    ],
    mappings: {}
  }
];
