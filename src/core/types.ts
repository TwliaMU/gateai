/**
 * Unified Core Types for Cloudflare Workers & Durable Objects AI Gateway V2
 */

export type LoadBalanceStrategy = 'round-robin' | 'weighted' | 'least-errors' | 'priority-failover' | 'random';
export type KeyStatus = 'active' | 'rate_limited' | 'invalid' | 'disabled';
export type CircuitState = 'closed' | 'open' | 'half-open';
export type AuthHeaderFormat = 'bearer' | 'x-api-key' | 'custom-header' | 'query-param';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface NormalizedChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  tools?: any[];
  tool_choice?: any;
  response_format?: any;
}

export interface NormalizedChoice {
  index: number;
  message?: {
    role: string;
    content: string | null;
    tool_calls?: any[];
  };
  delta?: {
    role?: string;
    content?: string;
    tool_calls?: any[];
  };
  finish_reason: string | null;
}

export interface NormalizedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface NormalizedChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: NormalizedChoice[];
  usage?: NormalizedUsage;
}

export interface NormalizedStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: NormalizedChoice[];
  usage?: NormalizedUsage;
}

export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ProviderRecord {
  id: string;
  name: string;
  type: 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'groq' | 'custom';
  baseUrl: string;
  authHeaderFormat: AuthHeaderFormat;
  authHeaderName?: string;
  enabled: boolean;
  strategy: LoadBalanceStrategy;
  timeoutMs: number;
  maxRetries: number;
  isCustom: boolean;
  description?: string;
  models?: string[];
  modelMappings?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  providerId: string;
  encryptedKey: string;
  keyHash: string;
  keyPrefix: string;
  label?: string;
  status: KeyStatus;
  weight: number;
  priority: number;
  requestCount: number;
  tokenCount: number;
  errorCount: number;
  cooldownUntil?: number;
  lastError?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  status: 'active' | 'revoked' | 'expired';
  rpmLimit: number;
  quotaLimitTokens: number;
  quotaUsedTokens: number;
  quotaLimitRequests: number;
  quotaUsedRequests: number;
  allowedProviders: string[];
  allowedModels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProxyLogRecord {
  id: string;
  timestamp: string;
  clientName: string;
  providerId: string;
  providerName: string;
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

export interface GlobalGatewayConfig {
  defaultProvider: string;
  defaultStrategy: LoadBalanceStrategy;
  autoCooldownMinutes: number;
  maxRetries: number;
  enablePublicEndpoints: boolean;
  adminPasswordHash?: string;
  adminPasswordSalt?: string;
  isInitialized: boolean;
  corsAllowedOrigins: string;
}

export interface SystemMetricsSummary {
  totalRequests: number;
  totalTokens: number;
  activeProvidersCount: number;
  totalKeysCount: number;
  activeKeysCount: number;
  rateLimitedKeysCount: number;
  averageLatencyMs: number;
  successRate: number;
  providerStats: Record<string, {
    requests: number;
    tokens: number;
    errors: number;
    healthyKeys: number;
    totalKeys: number;
  }>;
}
