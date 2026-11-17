import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'

import { AiService } from './ai/aiService.ts'
import { AuthService } from './auth/authService.ts'
import type { AppConfig } from './config/env.ts'
import { runMigrations } from './db/migrate.ts'
import { MemoryStore } from './db/memoryStore.ts'
import { PgStore } from './db/pgStore.ts'
import type { Store } from './db/store.ts'
import { Router } from './http/router.ts'
import { sendJson } from './http/respond.ts'
import type { AppContext } from './http/types.ts'
import { registerAiRoutes } from './routes/aiRoutes.ts'
import { registerAuthRoutes } from './routes/authRoutes.ts'
import { registerGithubRoutes } from './routes/githubRoutes.ts'
import { registerHealthRoutes } from './routes/healthRoutes.ts'
import { registerProjectRoutes } from './routes/projectRoutes.ts'
import { registerSettingsRoutes } from './routes/settingsRoutes.ts'
import { RateLimiter } from './security/rateLimit.ts'
import { createCredentialCipher } from './security/encryption.ts'
import { ProjectService } from './services/projectService.ts'
import { SettingsService } from './services/settingsService.ts'

const pkg = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { version: string }

export const API_VERSION = pkg.version

export type CreateAppOptions = {
  config: AppConfig
  store?: Store
  fetchImpl?: typeof fetch
  now?: () => number
  runMigrationsOnStart?: boolean
}

export type RunningApp = {
  server: Server
  context: AppContext
  router: Router
  close(): Promise<void>
}

/**
 * Composition root. The HTTP router owns auth, CORS, CSRF and rate limiting;
 * this function only chooses a store, constructs the services and wires the
 * route modules. It is exported so tests can exercise the real router with an
 * in-memory store instead of starting a separate process.
 */
export async function createApp(options: CreateAppOptions): Promise<RunningApp> {
  const { config } = options
  const now = options.now ?? Date.now
  const fetchImpl = options.fetchImpl ?? fetch

  let store = options.store
  if (!store) {
    if (config.DATABASE_URL) {
      store = new PgStore(config.DATABASE_URL)
    } else if (config.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is required in production.')
    } else {
      store = new MemoryStore()
    }
  }

  if (options.runMigrationsOnStart && store instanceof PgStore) {
    await runMigrations(store.getPool())
  }

  const cipher = createCredentialCipher(
    config.CREDENTIAL_ENCRYPTION_KEY,
    config.NODE_ENV === 'production',
  )
  const limiter = new RateLimiter(now)
  const auth = new AuthService({
    store,
    sessionTtlDays: config.SESSION_TTL_DAYS,
    now,
  })
  const ai = new AiService({ config, store, cipher, fetchImpl, now })
  const projects = new ProjectService(store, now)
  const settings = new SettingsService(store)

  const context: AppContext = {
    config,
    store,
    storeKind: store instanceof PgStore ? 'postgresql' : 'memory',
    cipher,
    auth,
    ai,
    projects,
    limiter,
    fetchImpl,
    now,
  }

  const router = new Router()
  registerHealthRoutes(router, API_VERSION)
  registerAuthRoutes(router)
  registerProjectRoutes(router)
  registerSettingsRoutes(router, settings)
  registerAiRoutes(router)
  registerGithubRoutes(router)

  const server = createServer((req, res) => {
    void router.handle(context, req, res).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'http.unhandled',
          requestId: res.getHeader('X-Request-Id') ?? null,
          method: req.method ?? 'GET',
          path: safeRequestPath(req.url),
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      )
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: 'internal_error',
          message: 'The API could not complete this request.',
          requestId: res.getHeader('X-Request-Id') ?? null,
        })
      } else if (!res.writableEnded) {
        res.end()
      }
    })
  })

  server.on('clientError', (_error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    }
  })

  return {
    server,
    context,
    router,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      await store.close()
    },
  }
}

function safeRequestPath(requestUrl: string | undefined): string {
  if (!requestUrl) return '/'
  try {
    return new URL(requestUrl, 'http://localhost').pathname
  } catch {
    return '/'
  }
}
