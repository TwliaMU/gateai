import type { ProviderRecord } from './types.js';

export interface RouteResolution {
  targetModel: string;
  primaryProvider: ProviderRecord;
  fallbackProviders: ProviderRecord[];
  /** True only if a provider directly lists the model (or a mapping for it)
   *  or a type heuristic matched it. False means the model is unknown. */
  matched: boolean;
}

export class ModelRouter {
  /**
   * Resolve an incoming request model to primary and fallback providers
   */
  static resolveRoute(
    requestedModel: string,
    providers: ProviderRecord[],
    modelMappings: Record<string, string>,
    defaultProviderId = 'gemini'
  ): RouteResolution | null {
    const enabledProviders = providers.filter(p => p.enabled);
    if (enabledProviders.length === 0) return null;

    // 1. Check if model has an explicit global alias or redirect
    let targetModel = requestedModel;
    if (modelMappings && modelMappings[requestedModel]) {
      targetModel = modelMappings[requestedModel];
    }

    // 2. Find providers that explicitly support this model (or targetModel)
    const matchingProviders: ProviderRecord[] = [];
    const lower = targetModel.toLowerCase();

    for (const p of enabledProviders) {
      // 1. Direct model inclusion check in provider's configured models
      if (Array.isArray(p.models) && (p.models.includes(targetModel) || p.models.includes(requestedModel))) {
        matchingProviders.push(p);
        continue;
      }

      // 2. Provider internal mappings check
      if (p.modelMappings && (p.modelMappings[requestedModel] || p.modelMappings[targetModel])) {
        matchingProviders.push(p);
        continue;
      }

      // 3. Heuristic matching based on provider type or ID
      if ((p.type === 'gemini' || p.id === 'gemini') && (lower.includes('gemini') || lower.includes('google') || lower.includes('flash') || lower.includes('thinking'))) {
        matchingProviders.push(p);
      } else if ((p.type === 'anthropic' || p.id === 'anthropic') && (lower.includes('claude') || lower.includes('anthropic') || lower.includes('sonnet') || lower.includes('haiku') || lower.includes('opus'))) {
        matchingProviders.push(p);
      } else if ((p.type === 'deepseek' || p.id === 'deepseek') && lower.includes('deepseek')) {
        matchingProviders.push(p);
      } else if ((p.type === 'groq' || p.id === 'groq') && (lower.includes('llama') || lower.includes('mixtral') || lower.includes('gemma'))) {
        matchingProviders.push(p);
      } else if ((p.type === 'openai' || p.id === 'openai') && (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.includes('text-embedding'))) {
        matchingProviders.push(p);
      }
    }

    // If no direct heuristic match, fall back to the default provider for
    // backwards compatibility of the return shape, but mark it unmatched
    // so callers can reject unknown models instead of sending them upstream.
    let primary: ProviderRecord;
    let fallbacks: ProviderRecord[] = [];

    if (matchingProviders.length > 0) {
      primary = matchingProviders[0];
      // Matching providers first, then the rest in creation order.
      fallbacks = [
        ...matchingProviders.filter(p => p.id !== primary.id),
        ...enabledProviders.filter(p => p.id !== primary.id && !matchingProviders.some(m => m.id === p.id)),
      ];
    } else {
      primary = enabledProviders.find(p => p.id === defaultProviderId) || enabledProviders[0];
      fallbacks = enabledProviders.filter(p => p.id !== primary.id);
    }

    return {
      targetModel,
      primaryProvider: primary,
      fallbackProviders: fallbacks,
      matched: matchingProviders.length > 0
    };
  }
}
