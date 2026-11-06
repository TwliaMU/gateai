import type {
  ProviderRecord,
  ApiKeyRecord,
  ClientTokenRecord,
  ProxyLogRecord,
  GlobalGatewayConfig,
  SystemMetricsSummary
} from '../core/types.js';

export interface IGatewayStorage {
  // Initialization & Migrations
  initialize(): Promise<void>;

  // Providers
  getProviders(): Promise<ProviderRecord[]>;
  getProvider(id: string): Promise<ProviderRecord | null>;
  saveProvider(provider: ProviderRecord, models?: string[], mappings?: Record<string, string>): Promise<void>;
  deleteProvider(id: string): Promise<boolean>;
  getProviderModels(providerId: string): Promise<string[]>;
  getAllModelMappings(): Promise<Record<string, string>>;

  // API Keys (Always returns masked keys for UI / external callers)
  getKeys(providerId?: string): Promise<Array<Omit<ApiKeyRecord, 'encryptedKey' | 'keyHash'>>>;
  getKeysFull?(providerId?: string): Promise<ApiKeyRecord[]>;
  getKey(id: string): Promise<ApiKeyRecord | null>;
  addKey(data: {
    providerId: string;
    rawKey: string;
    label?: string;
    weight?: number;
    priority?: number;
    status?: ApiKeyRecord['status'];
  }, secret: string): Promise<Omit<ApiKeyRecord, 'encryptedKey'>>;
  batchAddKeys(providerId: string, rawKeys: string[], secret: string): Promise<number>;
  updateKey(id: string, updates: {
    providerId?: string;
    rawKey?: string;
    key?: string;
    label?: string;
    weight?: number;
    priority?: number;
    status?: ApiKeyRecord['status'];
    cooldownUntil?: number;
    lastError?: string;
  }, secret?: string): Promise<any>;
  updateKeyStatus(id: string, status: ApiKeyRecord['status'], cooldownUntil?: number, lastError?: string): Promise<void>;
  updateKeyUsage(id: string, tokens: number, isError: boolean): Promise<void>;
  deleteKey(id: string): Promise<boolean>;

  // Load Balancing State
  getProviderRrCursor(providerId: string): Promise<number>;
  incrementProviderRrCursor(providerId: string, nextCursor: number): Promise<void>;

  // Client Tokens
  getClients(): Promise<ClientTokenRecord[]>;
  getClientByTokenHash(tokenHash: string): Promise<ClientTokenRecord | null>;
  createClient(data: {
    name: string;
    rpmLimit?: number;
    quotaLimitTokens?: number;
    quotaLimitRequests?: number;
    allowedProviders?: string[];
    allowedModels?: string[];
  }): Promise<{ client: ClientTokenRecord; rawToken: string }>;
  updateClient(id: string, updates: Partial<ClientTokenRecord>): Promise<ClientTokenRecord | null>;
  deleteClient(id: string): Promise<boolean>;
  atomicIncrementClientQuota(clientId: string, requests: number, tokens: number): Promise<boolean>;

  // Logs & Metrics
  recordLog(log: ProxyLogRecord): Promise<void>;
  getLogs(limit?: number, providerId?: string, status?: string): Promise<ProxyLogRecord[]>;
  clearLogs(): Promise<void>;
  getMetricsSummary(): Promise<SystemMetricsSummary>;

  // Global Config & Auth
  getConfig(): Promise<GlobalGatewayConfig>;
  updateConfig(updates: Partial<GlobalGatewayConfig>): Promise<GlobalGatewayConfig>;
  verifyAdminPassword(password: string): Promise<boolean>;
  initializeAdminPassword(password: string): Promise<boolean>;
  changeAdminPassword(oldPassword: string, newPassword: string): Promise<boolean>;
  createAdminSession(): Promise<string>;
  verifyAdminSession(token: string): Promise<boolean>;
}
