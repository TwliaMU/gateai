import type { Request, Response } from 'express';
import { store } from './store.js';
import type { ProviderConfig, ApiKeyItem, ClientToken } from '../src/types/index.js';
import { proxyToGemini } from './adapters/gemini.js';
import { proxyToAnthropic } from './adapters/anthropic.js';
import { proxyToOpenAiCompatible } from './adapters/openai-compatible.js';

export function resolveProviderForModel(requestedModel: string, explicitProviderId?: string): {
  provider: ProviderConfig;
  targetModel: string;
} | null {
  const providers = store.getProviders().filter(p => p.enabled);
  if (providers.length === 0) return null;

  // 1. Explicit provider header or query
  if (explicitProviderId) {
    const prov = providers.find(p => p.id === explicitProviderId);
    if (prov) {
      const mapped = prov.modelMappings?.[requestedModel] || requestedModel;
      return { provider: prov, targetModel: mapped };
    }
  }

  // 2. Exact match in provider models or mappings
  for (const prov of providers) {
    if (prov.modelMappings && prov.modelMappings[requestedModel]) {
      return { provider: prov, targetModel: prov.modelMappings[requestedModel] };
    }
    if (prov.models.includes(requestedModel)) {
      return { provider: prov, targetModel: requestedModel };
    }
  }

  // 3. Heuristic model prefix match
  const lower = requestedModel.toLowerCase();
  if (lower.startsWith('gemini') || lower.includes('flash') || lower.includes('thinking')) {
    const geminiProv = providers.find(p => p.type === 'gemini');
    if (geminiProv) return { provider: geminiProv, targetModel: requestedModel };
  }
  if (lower.startsWith('claude')) {
    const claudeProv = providers.find(p => p.type === 'anthropic');
    if (claudeProv) return { provider: claudeProv, targetModel: requestedModel };
  }
  if (lower.startsWith('deepseek')) {
    const dsProv = providers.find(p => p.type === 'deepseek');
    if (dsProv) return { provider: dsProv, targetModel: requestedModel };
  }
  if (lower.startsWith('llama') || lower.startsWith('mixtral') || lower.includes('groq')) {
    const groqProv = providers.find(p => p.type === 'groq');
    if (groqProv) return { provider: groqProv, targetModel: requestedModel };
  }
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3')) {
    const openAiProv = providers.find(p => p.type === 'openai');
    if (openAiProv) return { provider: openAiProv, targetModel: requestedModel };
    // If OpenAI isn't configured with active keys, but Gemini is configured with mappings for gpt-*
    const geminiProv = providers.find(p => p.type === 'gemini');
    if (geminiProv) {
      const mapped = geminiProv.modelMappings?.[requestedModel] || 'gemini-2.5-flash';
      return { provider: geminiProv, targetModel: mapped };
    }
  }

  // 4. Default provider fallback
  const cfg = store.getConfig();
  const defaultProv = providers.find(p => p.id === cfg.defaultProvider) || providers[0];
  const target = defaultProv.modelMappings?.[requestedModel] || defaultProv.models[0] || requestedModel;
  return { provider: defaultProv, targetModel: target };
}

export function authenticateClient(req: Request): {
  client?: ClientToken;
  isAuthorized: boolean;
  error?: string;
} {
  const authHeader = req.headers['authorization'];
  const adminSession = req.headers['x-admin-session'];
  let tokenStr = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    tokenStr = authHeader.slice(7).trim();
  } else if (typeof req.query.key === 'string') {
    tokenStr = req.query.key.trim();
  }

  const cfg = store.getConfig();

  // If request comes from authenticated Admin Console / Playground Session
  if (adminSession && (adminSession === 'authenticated' || store.verifyPassword(adminSession as string))) {
    const clients = store.getClients();
    return { client: clients[0], isAuthorized: true };
  }

  // If token is supplied, look up client
  if (tokenStr) {
    const client = store.getClient(tokenStr);
    if (!client) {
      // If public endpoints are enabled, allow fallback, otherwise reject
      if (!cfg.enablePublicEndpoints) {
        return { isAuthorized: false, error: 'Invalid API Key / Client Token' };
      }
    } else {
      if (client.status !== 'active') {
        return { isAuthorized: false, error: `Client token is ${client.status}` };
      }
      if (client.expiresAt && new Date(client.expiresAt).getTime() < Date.now()) {
        return { isAuthorized: false, error: 'Client token has expired' };
      }
      if (client.quotaLimitRequests > 0 && client.quotaUsedRequests >= client.quotaLimitRequests) {
        return { isAuthorized: false, error: 'Client request quota exceeded' };
      }
      if (client.quotaLimitTokens > 0 && client.quotaUsedTokens >= client.quotaLimitTokens) {
        return { isAuthorized: false, error: 'Client token quota exceeded' };
      }
      return { client, isAuthorized: true };
    }
  }

  // If no token supplied
  if (!cfg.enablePublicEndpoints) {
    return { isAuthorized: false, error: 'Missing Bearer API Key Authorization header' };
  }

  return { isAuthorized: true };
}

export async function handleChatCompletions(req: Request, res: Response) {
  const startTime = Date.now();
  const auth = authenticateClient(req);

  if (!auth.isAuthorized) {
    return res.status(401).json({
      error: {
        message: auth.error || 'Unauthorized',
        type: 'invalid_request_error',
        code: 'unauthorized'
      }
    });
  }

  const body = req.body;
  if (!body || !body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: "messages" array is required',
        type: 'invalid_request_error'
      }
    });
  }

  const requestedModel = body.model || 'gemini-2.5-flash';
  const explicitProvider = (req.headers['x-provider'] as string) || (req.query.provider as string);

  const resolved = resolveProviderForModel(requestedModel, explicitProvider);
  if (!resolved) {
    return res.status(503).json({
      error: {
        message: 'No active AI providers available to handle this request',
        type: 'provider_unavailable_error'
      }
    });
  }

  const { provider, targetModel } = resolved;

  // Check client permission for provider and model
  if (auth.client) {
    if (
      !auth.client.allowedProviders.includes('*') &&
      !auth.client.allowedProviders.includes(provider.id)
    ) {
      return res.status(403).json({
        error: {
          message: `Client token is not authorized for provider "${provider.id}"`,
          type: 'permission_denied'
        }
      });
    }
    if (
      !auth.client.allowedModels.includes('*') &&
      !auth.client.allowedModels.includes(requestedModel) &&
      !auth.client.allowedModels.includes(targetModel)
    ) {
      return res.status(403).json({
        error: {
          message: `Client token is not authorized for model "${requestedModel}"`,
          type: 'permission_denied'
        }
      });
    }
  }

  const maxRetries = Math.min(provider.maxRetries || 3, 5);
  const excludedKeys = new Set<string>();
  let attempt = 0;
  let lastError: any = null;

  while (attempt < maxRetries) {
    attempt++;
    const key = store.selectNextKey(provider.id, excludedKeys);

    if (!key) {
      // No more healthy keys in this provider
      break;
    }

    excludedKeys.add(key.id);

    try {
      let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      if (provider.type === 'gemini') {
        tokenUsage = await proxyToGemini({
          apiKey: key.key,
          model: targetModel,
          body,
          res
        });
      } else if (provider.type === 'anthropic') {
        tokenUsage = await proxyToAnthropic({
          apiKey: key.key,
          baseUrl: provider.baseUrl,
          model: targetModel,
          body,
          res
        });
      } else {
        // OpenAI or OpenAI-compatible (DeepSeek, Groq, custom)
        tokenUsage = await proxyToOpenAiCompatible({
          provider,
          apiKey: key.key,
          targetModel,
          body,
          res
        });
      }

      // Record success
      const durationMs = Date.now() - startTime;
      store.recordKeyUsage({
        keyId: key.id,
        tokens: tokenUsage.totalTokens,
        success: true,
        statusCode: 200
      });

      if (auth.client) {
        store.recordClientUsage(auth.client.id, tokenUsage.totalTokens);
      }

      store.addLog({
        clientTokenName: auth.client?.name || 'Public Client',
        clientTokenId: auth.client?.id,
        providerId: provider.id,
        providerName: provider.name,
        keyId: key.id,
        keyMasked: key.maskedKey,
        model: requestedModel,
        mappedModel: targetModel !== requestedModel ? targetModel : undefined,
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
        durationMs,
        statusCode: 200,
        isStream: Boolean(body.stream)
      });

      return;
    } catch (err: any) {
      lastError = err;
      const statusCode = err.statusCode || 500;
      const errorMessage = err.message || 'Upstream Error';

      store.recordKeyUsage({
        keyId: key.id,
        success: false,
        statusCode,
        errorMessage
      });

      // If headers already sent (e.g. mid-stream failure), we cannot retry
      if (res.headersSent) {
        store.addLog({
          clientTokenName: auth.client?.name || 'Public Client',
          clientTokenId: auth.client?.id,
          providerId: provider.id,
          providerName: provider.name,
          keyId: key.id,
          keyMasked: key.maskedKey,
          model: requestedModel,
          mappedModel: targetModel !== requestedModel ? targetModel : undefined,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          durationMs: Date.now() - startTime,
          statusCode,
          isStream: Boolean(body.stream),
          errorMessage: `Stream interrupted: ${errorMessage}`
        });
        return;
      }

      console.warn(`[ProxyEngine] Key ${key.maskedKey} failed with ${statusCode}: ${errorMessage}. Retrying with next key...`);
    }
  }

  // All keys exhausted or failed
  const finalStatus = lastError?.statusCode || 502;
  const finalMessage = lastError?.message || `All available API keys for provider "${provider.name}" failed or are rate-limited.`;

  store.addLog({
    clientTokenName: auth.client?.name || 'Public Client',
    clientTokenId: auth.client?.id,
    providerId: provider.id,
    providerName: provider.name,
    keyId: 'none',
    keyMasked: 'none',
    model: requestedModel,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: Date.now() - startTime,
    statusCode: finalStatus,
    isStream: Boolean(body.stream),
    errorMessage: finalMessage
  });

  if (!res.headersSent) {
    return res.status(finalStatus).json({
      error: {
        message: finalMessage,
        type: 'proxy_load_balancer_error',
        provider: provider.id,
        attempts: attempt
      }
    });
  }
}
