import type {
  ProviderConfig,
  ApiKeyItem,
  ClientToken,
  ProxyLogItem,
  GlobalConfig,
  SystemMetrics
} from '../types/index.js';

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin-token') || '' : '';
  const headers: Record<string, string> = { ...extra };
  if (token) {
    headers['X-Admin-Session'] = token;
  }
  return headers;
}

async function parseErrorResponse(res: Response, defaultMsg: string): Promise<string> {
  try {
    const data: any = await res.json();
    if (typeof data === 'string') return data;
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.error?.message === 'string') return data.error.message;
    if (typeof data?.message === 'string') return data.message;
    if (data?.error && typeof data.error === 'object') {
      return data.error.message || JSON.stringify(data.error);
    }
    return defaultMsg;
  } catch {
    try {
      const text = await res.text();
      return text || defaultMsg;
    } catch {
      return defaultMsg;
    }
  }
}

export const api = {
  async getMetrics(): Promise<SystemMetrics> {
    const res = await fetch('/api/metrics', { headers: authHeaders() });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '获取监控指标失败'));
    return res.json();
  },

  async getProviders(): Promise<ProviderConfig[]> {
    const res = await fetch('/api/providers', { headers: authHeaders() });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '获取厂商列表失败'));
    return res.json();
  },

  async createProvider(data: Partial<ProviderConfig>): Promise<ProviderConfig> {
    const res = await fetch('/api/providers', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, '创建厂商失败'));
    }
    return res.json();
  },

  async updateProvider(id: string, data: Partial<ProviderConfig>): Promise<ProviderConfig> {
    const res = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '更新厂商失败'));
    return res.json();
  },

  async deleteProvider(id: string): Promise<void> {
    const res = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '删除厂商失败'));
  },

  async testProvider(data: {
    providerId?: string;
    baseUrl: string;
    apiKey?: string;
    authHeaderFormat?: string;
    authHeaderName?: string;
  }): Promise<{ success: boolean; statusCode: number; latencyMs: number; message: string }> {
    const res = await fetch('/api/providers/test', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async fetchUpstreamModels(data: {
    providerId?: string;
    type?: string;
    baseUrl?: string;
    apiKey: string;
    authHeaderFormat?: string;
    authHeaderName?: string;
  }): Promise<{ success: boolean; count?: number; models?: string[]; latencyMs?: number; error?: string }> {
    const res = await fetch('/api/providers/fetch-models', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    const json = await res.json().catch(() => ({ success: false, error: '解析响应失败' }));
    return json as { success: boolean; count?: number; models?: string[]; latencyMs?: number; error?: string };
  },

  async getKeys(providerId?: string): Promise<ApiKeyItem[]> {
    const url = providerId ? `/api/keys?providerId=${encodeURIComponent(providerId)}` : '/api/keys';
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '获取密钥列表失败'));
    return res.json();
  },

  async addKey(data: {
    providerId: string;
    key: string;
    label?: string;
    weight?: number;
    status?: ApiKeyItem['status'];
  }): Promise<ApiKeyItem> {
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '添加密钥失败'));
    return res.json();
  },

  async batchAddKeys(providerId: string, keys: string[]): Promise<{ addedCount: number; items: ApiKeyItem[] }> {
    const res = await fetch('/api/keys/batch', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ providerId, keys })
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '批量添加密钥失败'));
    return res.json();
  },

  async updateKey(id: string, updates: Partial<ApiKeyItem>): Promise<ApiKeyItem> {
    const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '更新密钥状态失败'));
    return res.json();
  },

  async deleteKey(id: string): Promise<void> {
    const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '删除密钥失败'));
  },

  async testAllKeys(providerId?: string): Promise<{ results: Array<{ id: string; maskedKey: string; status: string; latencyMs: number; error?: string }> }> {
    const res = await fetch('/api/keys/test-all', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ providerId })
    });
    return res.json();
  },

  async getClients(): Promise<ClientToken[]> {
    const res = await fetch('/api/clients', { headers: authHeaders() });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '获取客户端令牌失败'));
    return res.json();
  },

  async addClient(data: Partial<ClientToken>): Promise<ClientToken> {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '创建客户端令牌失败'));
    return res.json();
  },

  async updateClient(id: string, updates: Partial<ClientToken>): Promise<ClientToken> {
    const res = await fetch(`/api/clients/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '更新客户端令牌失败'));
    return res.json();
  },

  async deleteClient(id: string): Promise<void> {
    const res = await fetch(`/api/clients/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '删除客户端令牌失败'));
  },

  async getLogs(limit = 100, providerId?: string, status?: string): Promise<ProxyLogItem[]> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (providerId) params.set('providerId', providerId);
    if (status) params.set('status', status);

    const res = await fetch(`/api/logs?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '获取调用日志失败'));
    return res.json();
  },

  async clearLogs(): Promise<void> {
    const res = await fetch('/api/logs/clear', { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '清空日志失败'));
  },

  async getConfig(): Promise<GlobalConfig> {
    const res = await fetch('/api/config', { headers: authHeaders() });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '获取系统配置失败'));
    return res.json();
  },

  async updateConfig(data: Partial<GlobalConfig>): Promise<GlobalConfig> {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '更新系统配置失败'));
    return res.json();
  },

  async getHealth(): Promise<{ status: string; version?: string }> {
    const res = await fetch('/health', { cache: 'no-store' });
    if (!res.ok) throw new Error('网关未响应');
    return res.json();
  },

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
    } catch {
      // Best effort: local markers are cleared by the caller regardless.
    }
  },

  async getAuthStatus(): Promise<{ isInitialized: boolean }> {
    const res = await fetch('/api/auth/status', { headers: authHeaders() });
    if (!res.ok) throw new Error(await parseErrorResponse(res, '获取认证状态失败'));
    return res.json();
  },

  async initializeAdminPassword(password: string): Promise<{ success: boolean; token?: string; message?: string }> {
    const res = await fetch('/api/auth/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '初始化密码失败');
    }
    const token = data.token || data.sessionToken;
    if (token) {
      localStorage.setItem('admin-token', token);
      localStorage.setItem('admin-auth', 'true');
    }
    return data;
  },

  async loginAdmin(password: string): Promise<{ success: boolean; token?: string; needInitialize?: boolean; error?: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, needInitialize: data.needInitialize, error: data.error || '登录失败' };
    }
    const token = data.token || data.sessionToken;
    if (token) {
      localStorage.setItem('admin-token', token);
      localStorage.setItem('admin-auth', 'true');
    }
    return data;
  },

  async changeAdminPassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '修改密码失败');
    }
    return data;
  },

};
