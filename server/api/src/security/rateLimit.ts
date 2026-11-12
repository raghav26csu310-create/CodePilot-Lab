export type RateLimitDecision = {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

type Bucket = {
  count: number
  resetAt: number
}

/**
 * Fixed-window in-memory limiter. It is correct for a single API process; a
 * horizontally scaled deployment must move the same counters to Redis or the
 * database. This limitation is documented rather than hidden.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  consume(key: string, limit: number, windowMs: number): RateLimitDecision {
    const at = this.now()
    const existing = this.buckets.get(key)
    if (!existing || existing.resetAt <= at) {
      const resetAt = at + windowMs
      this.buckets.set(key, { count: 1, resetAt })
      this.prune(at)
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - 1),
        resetAt,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      }
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: existing.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - at) / 1000)),
      }
    }

    existing.count += 1
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - existing.count),
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - at) / 1000)),
    }
  }

  reset(): void {
    this.buckets.clear()
  }

  private prune(at: number): void {
    if (this.buckets.size < 5_000) return
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= at) {
        this.buckets.delete(key)
      }
    }
  }
}

export const LIMITS = {
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  chat: { limit: 30, windowMs: 60 * 1000 },
  connectionTest: { limit: 10, windowMs: 5 * 60 * 1000 },
  general: { limit: 240, windowMs: 60 * 1000 },
} as const
