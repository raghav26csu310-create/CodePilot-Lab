import { tooManyRequests } from './errors.ts'
import { LIMITS } from '../security/rateLimit.ts'
import type { RequestContext } from './types.ts'

type LimitName = keyof typeof LIMITS

export function enforceLimit(ctx: RequestContext, name: LimitName, scope: string): void {
  const rule = LIMITS[name]
  const decision = ctx.limiter.consume(`${name}:${scope}`, rule.limit, rule.windowMs)
  if (!decision.allowed) {
    ctx.res.setHeader('Retry-After', String(decision.retryAfterSeconds))
    throw tooManyRequests(
      `Too many requests. Try again in ${decision.retryAfterSeconds} second${decision.retryAfterSeconds === 1 ? '' : 's'}.`,
      {
        scope: name,
        limit: decision.limit,
        resetAt: decision.resetAt,
        retryAfterSeconds: decision.retryAfterSeconds,
      },
    )
  }
  ctx.res.setHeader('X-RateLimit-Limit', String(decision.limit))
  ctx.res.setHeader('X-RateLimit-Remaining', String(decision.remaining))
}
