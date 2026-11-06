export type ProviderType = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'groq' | 'custom';

export type AuthHeaderFormat = 'bearer' | 'x-api-key' | 'custom-header' | 'query-param';

export type LoadBalanceStrategy = 'round-robin' | 'random' | 'least-errors' | 'weighted' | 'priority-failover';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  authHeaderFormat: AuthHeaderFormat;
  authHeaderName?: string;
  enabled: boolean;
  models: string[];
  modelMappings?: Record<string, string>;
  loadBalanceStrategy: LoadBalanceStrategy;
  timeoutSeconds: number;
  maxRetries: number;
  isCustom: boolean;
  description?: string;
  icon?: string;
  createdAt: string;
}

export type KeyStatus = 'active' | 'rate_limited' | 'invalid' | 'disabled';

export interface ApiKeyItem {
  id: string;
  providerId: string;
  key: string;
  maskedKey: string;
  label: string;
  weight: number;
  status: KeyStatus;
  totalRequests: number;
  totalTokens: number;
  successCount: number;
  errorCount: number;
  lastUsedAt?: string;
  lastError?: string;
  lastStatusCode?: number;
  cooldownUntil?: number;
  createdAt: string;
}

export type ClientStatus = 'active' | 'revoked' | 'expired';

export interface ClientToken {
  id: string;
  name: string;
  token: string;
  status: ClientStatus;
  allowedProviders: string[];
  allowedModels: string[];
  rpmLimit: number;
  quotaLimitTokens: number;
  quotaUsedTokens: number;
  quotaLimitRequests: number;
  quotaUsedRequests: number;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface ProxyLogItem {
  id: string;
  timestamp: string;
  clientTokenName: string;
  clientTokenId?: string;
  providerId: string;
  providerName: string;
  keyId: string;
  keyMasked: string;
  model: string;
  mappedModel?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  statusCode: number;
  isStream: boolean;
  errorMessage?: string;
}

export interface GlobalConfig {
  adminPassword?: string;
  isInitialized?: boolean;
  defaultProvider: string;
  defaultStrategy: LoadBalanceStrategy;
  autoCooldownMinutes: number;
  maxRetries: number;
  enablePublicEndpoints: boolean;
  customSystemPrompt?: string;
}

export interface SystemMetrics {
  totalRequests: number;
  totalTokens: number;
  activeProvidersCount: number;
  totalKeysCount: number;
  activeKeysCount: number;
  rateLimitedKeysCount: number;
  invalidKeysCount: number;
  successRate: number;
  averageLatencyMs: number;
  providerStats: Record<string, {
    requests: number;
    tokens: number;
    errors: number;
    healthyKeys: number;
    totalKeys: number;
  }>;
}
