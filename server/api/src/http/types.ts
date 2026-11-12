import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AiService } from '../ai/aiService.ts'
import type { AuthService } from '../auth/authService.ts'
import type { AppConfig } from '../config/env.ts'
import type { Store } from '../db/store.ts'
import type { SessionRecord, UserRecord } from '../db/types.ts'
import type { CredentialCipher } from '../security/encryption.ts'
import type { RateLimiter } from '../security/rateLimit.ts'
import type { ProjectService } from '../services/projectService.ts'

export type AppContext = {
  config: AppConfig
  store: Store
  /** What the process actually uses, reported by /api/health without guessing. */
  storeKind: 'memory' | 'postgresql'
  cipher: CredentialCipher
  auth: AuthService
  ai: AiService
  projects: ProjectService
  limiter: RateLimiter
  fetchImpl: typeof fetch
  now: () => number
}

export type RequestContext = AppContext & {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  params: Record<string, string>
  user: UserRecord | null
  session: SessionRecord | null
  ip: string
}

export type AuthMode = 'public' | 'optional' | 'required'

export type RouteHandler = (ctx: RequestContext) => Promise<void>
