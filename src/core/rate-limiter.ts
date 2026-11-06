/**
 * Sliding Window In-Memory Rate Limiter for Durable Object / Edge execution
 */

interface WindowData {
  windowStart: number;
  count: number;
}

export class ClientRateLimiter {
  private windows = new Map<string, WindowData>();

  /**
   * Check if client exceeds RPM (Requests Per Minute)
   * @param clientId client token ID
   * @param rpmLimit 0 means unlimited
   */
  checkRateLimit(clientId: string, rpmLimit: number): { allowed: boolean; currentRpm: number; retryAfterSeconds: number } {
    if (!rpmLimit || rpmLimit <= 0) {
      return { allowed: true, currentRpm: 0, retryAfterSeconds: 0 };
    }

    const now = Date.now();
    const windowSizeMs = 60000; // 1 minute
    // Opportunistically drop expired windows so the map cannot grow
    // without bound as new client ids appear.
    for (const [id, w] of this.windows) {
      if (now - w.windowStart >= windowSizeMs) this.windows.delete(id);
    }
    let data = this.windows.get(clientId);

    if (!data || now - data.windowStart >= windowSizeMs) {
      // New 1-minute window
      data = { windowStart: now, count: 1 };
      this.windows.set(clientId, data);
      return { allowed: true, currentRpm: 1, retryAfterSeconds: 0 };
    }

    if (data.count >= rpmLimit) {
      const remainingMs = windowSizeMs - (now - data.windowStart);
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      return { allowed: false, currentRpm: data.count, retryAfterSeconds };
    }

    data.count++;
    return { allowed: true, currentRpm: data.count, retryAfterSeconds: 0 };
  }

  reset(clientId: string): void {
    this.windows.delete(clientId);
  }
}
