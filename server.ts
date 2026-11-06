import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { store } from './server/store.js';
import { handleChatCompletions, authenticateClient } from './server/proxy-engine.js';
import { generateCloudflareWorkerCode } from './server/cloudflare-code.js';
import type { ProviderConfig } from './src/types/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function startServer() {
  const app = express();

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-provider', 'x-requested-with', 'x-admin-session']
  }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ==========================================
  // 1. OpenAI Compatible Gateway Endpoints
  // ==========================================
  app.post('/v1/chat/completions', async (req, res) => {
    try {
      await handleChatCompletions(req, res);
    } catch (err: any) {
      console.error('[Gateway] Uncaught handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: err.message || 'Internal gateway error',
            type: 'internal_server_error'
          }
        });
      }
    }
  });

  // Alias without /v1 prefix for compatibility
  app.post('/chat/completions', async (req, res) => {
    try {
      await handleChatCompletions(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: { message: err.message } });
      }
    }
  });

  // /v1/models: Aggregate all active models across all active providers, filtered by client token permissions
  app.get(['/v1/models', '/models'], (req, res) => {
    const auth = authenticateClient(req);
    const providers = store.getProviders().filter(p => p.enabled);
    const modelMap = new Map<string, any>();

    for (const p of providers) {
      for (const m of p.models) {
        if (!modelMap.has(m)) {
          modelMap.set(m, {
            id: m,
            object: 'model',
            created: 1700000000,
            owned_by: p.id,
            permission: [],
            root: m,
            parent: null
          });
        }
      }
      // Also include mapped models
      if (p.modelMappings) {
        for (const alias of Object.keys(p.modelMappings)) {
          if (!modelMap.has(alias)) {
            modelMap.set(alias, {
              id: alias,
              object: 'model',
              created: 1700000000,
              owned_by: p.id,
              permission: [],
              root: p.modelMappings[alias],
              parent: null
            });
          }
        }
      }
    }

    let allList = Array.from(modelMap.values());

    // If client token is authenticated and specifies explicit allowedModels (without wildcard '*')
    if (auth.client && Array.isArray(auth.client.allowedModels) && auth.client.allowedModels.length > 0 && !auth.client.allowedModels.includes('*')) {
      const allowedSet = new Set(auth.client.allowedModels);
      allList = allList.filter(item => allowedSet.has(item.id));
    }

    res.json({
      object: 'list',
      data: allList
    });
  });

  // Embeddings are not implemented in production (501); local dev
  // mirrors that instead of returning invented vectors.
  app.post(['/v1/embeddings', '/embeddings'], async (req, res) => {
    res.status(501).json({ error: { message: 'Embeddings are not implemented', type: 'not_implemented', code: 'not_implemented' } });
  });

  // ==========================================
  // 2. Admin & Configuration Management APIs
  // ==========================================

  // Admin authentication guard middleware
  const adminAuthGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!store.isInitialized()) {
      return next();
    }
    const token = (req.headers['x-admin-session'] as string) || (req.headers['authorization']?.replace('Bearer ', ''));
    if (!token || !store.verifyAdminSession(token)) {
      return res.status(401).json({ error: 'Unauthorized: Admin session required' });
    }
    next();
  };

  // --- Providers ---
  app.get('/api/providers', adminAuthGuard, (req, res) => {
    res.json(store.getProviders());
  });

  app.post('/api/providers', adminAuthGuard, (req, res) => {
    const body = req.body;
    if (!body.name || !body.baseUrl) {
      return res.status(400).json({ error: 'Name and Base URL are required' });
    }

    const id = body.id?.trim() || ('custom-' + Math.random().toString(36).substring(2, 8));
    const newProvider: ProviderConfig = {
      id,
      name: body.name.trim(),
      type: body.type || 'custom',
      baseUrl: body.baseUrl.trim(),
      authHeaderFormat: body.authHeaderFormat || 'bearer',
      authHeaderName: body.authHeaderName,
      enabled: body.enabled !== false,
      models: Array.isArray(body.models) ? body.models : (body.models ? String(body.models).split(',').map((s: string) => s.trim()) : ['default-model']),
      modelMappings: body.modelMappings || {},
      loadBalanceStrategy: body.loadBalanceStrategy || 'round-robin',
      timeoutSeconds: Number(body.timeoutSeconds) || 60,
      maxRetries: Number(body.maxRetries) || 3,
      isCustom: body.isCustom !== false,
      description: body.description,
      createdAt: new Date().toISOString()
    };

    const saved = store.upsertProvider(newProvider);
    res.status(201).json(saved);
  });

  app.put('/api/providers/:id', adminAuthGuard, (req, res) => {
    const { id } = req.params;
    const existing = store.getProvider(id);
    if (!existing) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    const updated = store.upsertProvider({ ...existing, ...req.body, id });
    res.json(updated);
  });

  app.delete('/api/providers/:id', adminAuthGuard, (req, res) => {
    const { id } = req.params;
    const deleted = store.deleteProvider(id);
    res.json({ success: deleted });
  });

  // Test Provider Connectivity
  app.post('/api/providers/test', adminAuthGuard, async (req, res) => {
    const { baseUrl, apiKey, authHeaderFormat, authHeaderName } = req.body;
    const startTime = Date.now();

    try {
      const urlCheck = store.validateSafeUrl ? store.validateSafeUrl(baseUrl || '') : { safe: true };
      if (!urlCheck.safe) {
        return res.status(400).json({
          success: false,
          statusCode: 400,
          latencyMs: 0,
          message: `安全拦截: ${urlCheck.error || '非法或受保护的目标地址'}`
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

      let resp = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      }).catch(async () => {
        return await fetch(cleanBase, {
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

      res.json({
        success: isReachable,
        statusCode: status,
        latencyMs: durationMs,
        message: msg
      });
    } catch (err: any) {
      res.json({
        success: false,
        statusCode: 0,
        latencyMs: Date.now() - startTime,
        message: err.message || '网络超时或目标域名无法解析'
      });
    }
  });

  // Fetch Available Models from Upstream Provider using API Key
  app.post(['/api/providers/fetch-models', '/api/fetch-models'], async (req, res) => {
    const { providerId, type, baseUrl, apiKey, authHeaderFormat, authHeaderName } = req.body;
    const startTime = Date.now();

    try {
      if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
        return res.status(400).json({
          success: false,
          error: '请先填入有效的 API Key'
        });
      }

      let resolvedType = type;
      let resolvedBase = baseUrl;

      if (providerId && (!resolvedType || !resolvedBase)) {
        const p = store.getProvider(providerId);
        if (p) {
          resolvedType = resolvedType || p.type;
          resolvedBase = resolvedBase || p.baseUrl;
        }
      }

      const trimmedKey = apiKey.trim();

      if (resolvedType === 'gemini') {
        const rawBase = (resolvedBase || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
        const url = `${rawBase}/v1beta/models?key=${encodeURIComponent(trimmedKey)}`;
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'x-goog-api-key': trimmedKey
          }
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return res.status(resp.status).json({
            success: false,
            statusCode: resp.status,
            error: `Google Gemini 接口返回异常 (HTTP ${resp.status}): ${errText.slice(0, 150)}`
          });
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

        return res.json({
          success: true,
          latencyMs: Date.now() - startTime,
          count: finalModels.length,
          models: finalModels
        });
      }

      if (resolvedType === 'anthropic') {
        const rawBase = (resolvedBase || 'https://api.anthropic.com').replace(/\/+$/, '');
        const targetUrl = rawBase.endsWith('/v1') ? `${rawBase}/models` : `${rawBase}/v1/models`;
        try {
          const resp = await fetch(targetUrl, {
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
              return res.json({
                success: true,
                latencyMs: Date.now() - startTime,
                count: models.length,
                models
              });
            }
          }
        } catch {}

        const fallback = [
          'claude-3-7-sonnet-20250219',
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
          'claude-3-opus-20240229'
        ];
        return res.json({
          success: true,
          latencyMs: Date.now() - startTime,
          count: fallback.length,
          models: fallback
        });
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
      const resp = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return res.status(resp.status).json({
          success: false,
          statusCode: resp.status,
          error: `上游返回 HTTP ${resp.status}: ${errText.slice(0, 150) || '获取模型列表失败'}`
        });
      }

      const data: any = await resp.json();
      const rawList: any[] = Array.isArray(data?.data)
        ? data.data
        : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []));

      const models: string[] = rawList
        .map((item: any) => (typeof item === 'string' ? item : item.id || item.name))
        .filter(Boolean);

      return res.json({
        success: true,
        latencyMs: Date.now() - startTime,
        count: models.length,
        models
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err.message || '获取模型失败，请检查 Base URL 与 API Key'
      });
    }
  });

  // --- API Keys ---
  app.get('/api/keys', adminAuthGuard, (req, res) => {
    const providerId = req.query.providerId as string | undefined;
    res.json(store.getKeys(providerId));
  });

  app.post('/api/keys', adminAuthGuard, (req, res) => {
    const { providerId, key, label, weight, status } = req.body;
    if (!providerId || !key) {
      return res.status(400).json({ error: 'providerId and key are required' });
    }
    const item = store.addKey({ providerId, key, label, weight, status });
    res.status(201).json(item);
  });

  app.post('/api/keys/batch', adminAuthGuard, (req, res) => {
    const { providerId, keys } = req.body;
    if (!providerId || !Array.isArray(keys)) {
      return res.status(400).json({ error: 'providerId and array of keys are required' });
    }
    const added = store.batchAddKeys(providerId, keys);
    res.status(201).json({ addedCount: added.length, items: added });
  });

  app.put('/api/keys/:id', adminAuthGuard, (req, res) => {
    const { id } = req.params;
    const updated = store.updateKey(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Key not found' });
    }
    res.json(updated);
  });

  app.delete('/api/keys/:id', adminAuthGuard, (req, res) => {
    const { id } = req.params;
    const deleted = store.deleteKey(id);
    res.json({ success: deleted });
  });

  // Batch Test All Keys for a provider
  app.post('/api/keys/test-all', adminAuthGuard, async (req, res) => {
    const { providerId } = req.body;
    const keys = store.getKeys(providerId);
    const provider = providerId ? store.getProvider(providerId) : null;
    const results: Array<{ id: string; maskedKey: string; status: string; latencyMs: number; error?: string }> = [];

    for (const k of keys) {
      const start = Date.now();
      try {
        let ok = false;
        let errStr = '';

        if (k.providerId === 'gemini') {
          const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${k.key}`;
          const r = await fetch(testUrl);
          ok = r.ok;
          if (!ok) errStr = `HTTP ${r.status}`;
        } else {
          const base = provider?.baseUrl || 'https://api.openai.com/v1';
          const r = await fetch(`${base.replace(/\/+$/, '')}/models`, {
            headers: { 'Authorization': `Bearer ${k.key}` }
          });
          ok = r.ok;
          if (!ok) errStr = `HTTP ${r.status}`;
        }

        const lat = Date.now() - start;
        const newStatus = ok ? 'active' : (errStr.includes('401') ? 'invalid' : 'rate_limited');
        store.updateKey(k.id, { status: newStatus as any, lastError: ok ? undefined : errStr });

        results.push({
          id: k.id,
          maskedKey: k.maskedKey,
          status: newStatus,
          latencyMs: lat,
          error: ok ? undefined : errStr
        });
      } catch (e: any) {
        store.updateKey(k.id, { status: 'rate_limited', lastError: e.message });
        results.push({
          id: k.id,
          maskedKey: k.maskedKey,
          status: 'rate_limited',
          latencyMs: Date.now() - start,
          error: e.message
        });
      }
    }

    res.json({ results });
  });

  // --- Clients (Consumer Tokens) ---
  app.get('/api/clients', adminAuthGuard, (req, res) => {
    res.json(store.getClients());
  });

  app.post('/api/clients', adminAuthGuard, (req, res) => {
    const item = store.addClient(req.body);
    res.status(201).json(item);
  });

  app.put('/api/clients/:id', adminAuthGuard, (req, res) => {
    const { id } = req.params;
    const updated = store.updateClient(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(updated);
  });

  app.delete('/api/clients/:id', adminAuthGuard, (req, res) => {
    const { id } = req.params;
    const deleted = store.deleteClient(id);
    res.json({ success: deleted });
  });

  // --- Logs & Metrics ---
  app.get('/api/logs', adminAuthGuard, (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const providerId = req.query.providerId as string | undefined;
    const status = req.query.status as string | undefined;
    res.json(store.getLogs(limit, providerId, status));
  });

  app.delete('/api/logs/clear', adminAuthGuard, (req, res) => {
    store.clearLogs();
    res.json({ success: true });
  });

  app.get('/api/metrics', adminAuthGuard, (req, res) => {
    res.json(store.getMetrics());
  });

  // --- Config ---
  app.get('/api/config', adminAuthGuard, (req, res) => {
    res.json(store.getConfig());
  });

  app.put('/api/config', adminAuthGuard, (req, res) => {
    res.json(store.updateConfig(req.body));
  });

  // --- Admin Auth & Initialization ---
  app.get('/api/auth/status', (req, res) => {
    res.json({
      isInitialized: store.isInitialized()
    });
  });

  app.post('/api/auth/initialize', (req, res) => {
    const { password } = req.body;
    if (!password || typeof password !== 'string' || password.trim().length < 6) {
      return res.status(400).json({ error: '密码长度不能少于 6 位' });
    }

    if (store.isInitialized()) {
      return res.status(400).json({ error: '系统密码已初始化，请直接登录' });
    }

    const ok = store.initializePassword(password.trim());
    if (ok) {
      const token = store.createAdminSession();
      return res.json({ success: true, token, sessionToken: token, message: '管理员密码初始化成功' });
    }
    return res.status(500).json({ error: '初始化密码失败' });
  });

  app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    if (!store.isInitialized()) {
      return res.status(400).json({
        success: false,
        needInitialize: true,
        error: '首次登录系统，请先初始化管理员密码'
      });
    }

    if (!password) {
      return res.status(400).json({ success: false, error: '请输入密码' });
    }

    const valid = store.verifyPassword(password);
    if (valid) {
      const token = store.createAdminSession();
      return res.json({ success: true, token, sessionToken: token });
    }
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  });

  app.post('/api/auth/change-password', (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.trim().length < 6) {
      return res.status(400).json({ error: '新密码长度不能少于 6 位' });
    }

    const ok = store.changePassword(oldPassword || '', newPassword.trim());
    if (ok) {
      return res.json({ success: true, message: '密码修改成功' });
    }
    return res.status(400).json({ error: '原密码错误，修改失败' });
  });

  // --- Cloudflare Worker Export Bundle ---
  app.get('/api/export-cloudflare', (req, res) => {
    const code = generateCloudflareWorkerCode();
    res.json(code);
  });

  // ==========================================
  // 3. Vite Middlewares / Frontend Serving
  // ==========================================
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AI Balancer] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[AI Balancer] Fatal startup error:', err);
  process.exit(1);
});
