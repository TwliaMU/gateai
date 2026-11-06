/**
 * Circuit Breaker state machine for Providers and API Keys
 * Protects against cascading failures, 429 storms, and timeout storms.
 */

export interface CircuitStateInfo {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime: number;
  cooldownUntil: number;
}

export class CircuitBreaker {
  private states = new Map<string, CircuitStateInfo>();
  // Half-open single-flight probes: only one in-flight trial per id,
  // so a recovering provider is not hit by a thundering herd.
  private halfOpenProbes = new Set<string>();

  constructor(
    private failureThreshold = 5,
    private cooldownMs = 60000 // 60 seconds
  ) {}

  getState(id: string): CircuitStateInfo {
    const existing = this.states.get(id);
    if (!existing) {
      const initial: CircuitStateInfo = {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: 0,
        cooldownUntil: 0
      };
      this.states.set(id, initial);
      return initial;
    }

    const now = Date.now();
    // If state is OPEN and cooldown has elapsed, move to HALF-OPEN to allow trial request
    if (existing.state === 'open' && now >= existing.cooldownUntil) {
      existing.state = 'half-open';
    }

    return existing;
  }

  canExecute(id: string): boolean {
    const info = this.getState(id);
    if (info.state === 'closed') return true;
    if (info.state === 'half-open') {
      if (this.halfOpenProbes.has(id)) return false;
      this.halfOpenProbes.add(id);
      return true;
    }
    return false;
  }

  recordSuccess(id: string): void {
    this.halfOpenProbes.delete(id);
    const info = this.getState(id);
    info.state = 'closed';
    info.failureCount = 0;
    info.lastFailureTime = 0;
    info.cooldownUntil = 0;
  }

  recordFailure(id: string, customCooldownMs?: number): void {
    this.halfOpenProbes.delete(id);
    const info = this.getState(id);
    const now = Date.now();
    info.failureCount++;
    info.lastFailureTime = now;

    if (info.failureCount >= this.failureThreshold || info.state === 'half-open') {
      info.state = 'open';
      const duration = Math.min(customCooldownMs || this.cooldownMs, 300000);
      info.cooldownUntil = now + duration;
    }
  }

  reset(id: string): void {
    this.states.delete(id);
    this.halfOpenProbes.delete(id);
  }
}
