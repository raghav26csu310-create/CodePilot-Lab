import type { IncomingMessage, ServerResponse } from 'node:http'

import { createApp, type RunningApp } from '../server/api/src/app.ts'
import {
  buildConfig,
  ConfigurationError,
  type AppConfig,
} from '../server/api/src/config/env.ts'

/**
 * Vercel serverless entry point for the CodePilot API.
 *
 * The Vite build is static, so this function is what makes `/api/*` exist on a
 * Vercel deployment. It uses the exact same router, stores, auth, rate limits
 * and AI gateway as `npm start`; the only differences are the runtime lifespan
 * (one invocation at a time) and the required deployment environment.
 *
 * A managed PostgreSQL database is required because serverless instances do
 * not share memory. When it is missing this endpoint answers 503 with the names
 * of the missing variables (never their values) instead of pretending to be
 * healthy.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

const SETUP_VARIABLES: string[] = ['DATABASE_URL']

function deploymentOrigins(): string[] {
  const origins = new Set<string>()
  const explicit = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, '')
  if (explicit) origins.add(explicit)

  for (const host of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ]) {
    const value = host?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    if (value) origins.add(`https://${value}`)
  }
  return [...origins]
}

function runtimeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const origins = deploymentOrigins()

  env.NODE_ENV ??= 'production'
  env.SESSION_COOKIE_SECURE ??= 'true'
  env.TRUST_PROXY ??= 'true'
  env.AI_REQUEST_TIMEOUT_MS ??= '50000'
  // Public deployments must not let a BYO endpoint probe the private network.
  env.ALLOW_PRIVATE_AI_ENDPOINTS ??= 'false'

  if (!env.PUBLIC_ORIGIN && origins[0]) {
    env.PUBLIC_ORIGIN = origins[0]
  }
  if (!env.CORS_ORIGINS && origins.length > 0) {
    env.CORS_ORIGINS = origins.join(',')
  }
  return env
}

function missingSetup(env: NodeJS.ProcessEnv): string[] {
  const missing = SETUP_VARIABLES.filter((name) => !env[name]?.trim())
  if (!env.CREDENTIAL_ENCRYPTION_KEY?.trim()) missing.push('CREDENTIAL_ENCRYPTION_KEY')
  if (!env.PUBLIC_ORIGIN?.trim() && !env.CORS_ORIGINS?.trim()) {
    missing.push('PUBLIC_ORIGIN (or CORS_ORIGINS)')
  }
  return missing
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  })
  res.end(body)
}

let appPromise: Promise<RunningApp> | null = null

async function buildApp(env: NodeJS.ProcessEnv): Promise<RunningApp> {
  let config: AppConfig
  try {
    config = buildConfig(env)
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw new ConfigurationError(error.message)
    }
    throw error
  }

  return createApp({ config, runMigrationsOnStart: true })
}

async function getApp(env: NodeJS.ProcessEnv): Promise<RunningApp> {
  if (!appPromise) {
    appPromise = buildApp(env).catch((error: unknown) => {
      // A cold start that failed may succeed on a later invocation (for
      // example after the database wakes up), so do not cache the failure.
      appPromise = null
      throw error
    })
  }
  return appPromise
}

const handler: Handler = async (req, res) => {
  const env = runtimeEnv()
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  if (req.method === 'GET' && pathname === '/api/health/live') {
    sendJson(res, 200, {
      ok: true,
      service: 'codepilot-api',
      time: new Date().toISOString(),
    })
    return
  }

  const missing = missingSetup(env)

  if (missing.length > 0) {
    sendJson(res, 503, {
      error: 'configuration_required',
      message:
        'This Vercel deployment is missing the server configuration required for the API. ' +
        `Add ${missing.join(', ')} in the Vercel project environment, then redeploy. ` +
        'AI and accounts cannot work on a static-only deployment.',
      missing,
    })
    return
  }

  try {
    const app = await getApp(env)
    await app.router.handle(app.context, req, res)
  } catch (error) {
    if (error instanceof ConfigurationError) {
      sendJson(res, 503, {
        error: 'configuration_invalid',
        message: error.message,
      })
      return
    }

    console.error(
      JSON.stringify({
        level: 'error',
        event: 'serverless.request_failed',
        path: (req.url ?? '/').split('?')[0],
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }),
    )
    if (!res.headersSent) {
      sendJson(res, 503, {
        error: 'service_unavailable',
        message:
          'The CodePilot API could not initialise. Check DATABASE_URL, the database status and the deployment logs.',
      })
    } else if (!res.writableEnded) {
      res.end()
    }
  }
}

export default handler
