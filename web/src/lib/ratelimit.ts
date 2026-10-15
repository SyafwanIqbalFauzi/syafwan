// In-memory sliding-window limiter. One Node process serves the site, so a Map is
// enough; it resets on restart, which is acceptable for login throttling.
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records an attempt for `key`. Returns false once the key is over the limit. */
  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.sweep(now);
    return true;
  }

  /** Forgets a key, e.g. after a successful login. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
