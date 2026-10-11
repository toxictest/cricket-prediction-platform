/**
 * Fixed-window rate limiter held in process memory.
 *
 * It slows brute-force attempts down on a single server instance. The counters
 * are not shared between serverless instances and reset on every deploy, so
 * treat this as a stopgap. Move the counters to Redis before relying on the
 * limit at scale (see docs/SYSTEM_DESIGN.md, section 9).
 */

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys, so a flood of distinct keys cannot exhaust memory. */
  maxKeys?: number;
}) {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const buckets = new Map<string, Bucket>();

  /** Drops expired buckets. Only runs when the map is full. */
  function sweep(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }

  return {
    /** Records one attempt against `key` and reports whether it is allowed. */
    hit(key: string, now: number = Date.now()): RateLimitDecision {
      const current = buckets.get(key);

      if (!current || now >= current.resetAt) {
        if (!current && buckets.size >= maxKeys) {
          sweep(now);
          if (buckets.size >= maxKeys) {
            // Still full: evict the oldest key. Maps iterate in insertion order.
            const oldest = buckets.keys().next().value;
            if (oldest !== undefined) buckets.delete(oldest);
          }
        }
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: limit - 1 };
      }

      if (current.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        };
      }

      current.count += 1;
      return { allowed: true, remaining: limit - current.count };
    },

    /** Forgets one key, or every key. Intended for tests. */
    reset(key?: string): void {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };
}
