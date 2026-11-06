import type { ApiKeyRecord, LoadBalanceStrategy } from './types.js';

/**
 * Deterministic Key Load Balancer for Cloudflare Durable Objects
 * Implements stateful Round-Robin, Weighted, Least-Errors, and Priority-Failover.
 */
export class KeyLoadBalancer {
  /**
   * Filter keys that are currently available for invocation:
   * Status must not be 'disabled' or 'invalid'.
   * If 'rate_limited', checks whether cooldownUntil has passed.
   */
  static filterAvailableKeys(keys: ApiKeyRecord[]): ApiKeyRecord[] {
    const now = Date.now();
    return keys.filter(k => {
      if (k.status === 'disabled' || k.status === 'invalid') {
        return false;
      }
      if (k.status === 'rate_limited') {
        if (k.cooldownUntil && now >= k.cooldownUntil) {
          // Cooldown expired, ready for reactivation
          return true;
        }
        return false;
      }
      return true;
    });
  }

  /**
   * Select a key according to strategy and persistent cursor
   */
  static selectKey(
    keys: ApiKeyRecord[],
    strategy: LoadBalanceStrategy,
    currentCursor = 0
  ): { selectedKey: ApiKeyRecord; nextCursor: number } | null {
    const available = this.filterAvailableKeys(keys);
    if (available.length === 0) return null;

    switch (strategy) {
      case 'priority-failover': {
        // Group by priority ascending (1 is highest priority)
        const sorted = [...available].sort((a, b) => a.priority - b.priority);
        const topPriority = sorted[0].priority;
        const topTier = sorted.filter(k => k.priority === topPriority);
        const idx = Math.abs(currentCursor) % topTier.length;
        return {
          selectedKey: topTier[idx],
          nextCursor: (currentCursor + 1) % 1000000
        };
      }

      case 'least-errors': {
        // Sort by error rate, then round-robin within the lowest-error tier
        // (previously the same lowest-error key was sticky forever).
        const sorted = [...available].sort((a, b) => {
          const rateA = a.errorCount / (a.requestCount + 1);
          const rateB = b.errorCount / (b.requestCount + 1);
          if (rateA !== rateB) return rateA - rateB;
          return a.errorCount - b.errorCount;
        });
        const lowestRate = sorted[0].errorCount / (sorted[0].requestCount + 1);
        const tier = sorted.filter(k => k.errorCount / (k.requestCount + 1) === lowestRate);
        const idx = Math.abs(currentCursor) % tier.length;
        return {
          selectedKey: tier[idx],
          nextCursor: currentCursor + 1
        };
      }

      case 'weighted': {
        // Weight <= 0 excludes a key (previously Math.max(1, weight) meant
        // weight 0 still received traffic).
        const weighted = available.filter(k => (k.weight || 1) > 0);
        if (weighted.length === 0) return null;
        const totalWeight = weighted.reduce((sum, k) => sum + (k.weight || 1), 0);
        const cursorMod = Math.abs(currentCursor) % totalWeight;
        let cumulative = 0;
        let chosen = weighted[0];

        for (const k of weighted) {
          cumulative += (k.weight || 1);
          if (cursorMod < cumulative) {
            chosen = k;
            break;
          }
        }

        return {
          selectedKey: chosen,
          nextCursor: (currentCursor + 1) % 1000000
        };
      }

      case 'random': {
        const idx = Math.floor(Math.random() * available.length);
        return {
          selectedKey: available[idx],
          nextCursor: currentCursor + 1
        };
      }

      case 'round-robin':
      default: {
        const idx = Math.abs(currentCursor) % available.length;
        return {
          selectedKey: available[idx],
          nextCursor: (currentCursor + 1) % 1000000
        };
      }
    }
  }
}
