import { sendJson } from '../http/respond.ts'
import type { AppContext } from '../http/types.ts'
import type { Router } from '../http/router.ts'

export function registerHealthRoutes(router: Router, version: string): void {
  router.add('GET', '/api/health/live', 'public', async (ctx) => {
    sendJson(ctx.res, 200, {
      ok: true,
      service: 'codepilot-api',
      version,
      time: new Date(ctx.now()).toISOString(),
    })
  })

  router.add('GET', '/api/health/ready', 'public', async (ctx) => {
    const database = await databaseStatus(ctx)
    sendJson(ctx.res, database ? 200 : 503, healthPayload(ctx, version, database))
  })

  router.add('GET', '/api/health', 'public', async (ctx) => {
    const database = await databaseStatus(ctx)
    const payload = healthPayload(ctx, version, database)
    sendJson(ctx.res, database ? 200 : 503, payload)
  })
}

async function databaseStatus(ctx: AppContext): Promise<boolean> {
  try {
    return await ctx.store.ping()
  } catch {
    return false
  }
}

function healthPayload(ctx: AppContext, version: string, database: boolean) {
  return {
    ok: database,
    service: 'codepilot-api',
    version,
    time: new Date(ctx.now()).toISOString(),
    runtime: `node ${process.version}`,
    database: {
      reachable: database,
      engine: ctx.storeKind,
      durable: ctx.storeKind === 'postgresql',
      note:
        ctx.storeKind === 'memory'
          ? 'Development-only in-memory store. Accounts, projects and usage are lost when the process exits.'
          : 'PostgreSQL is the durable store for this process.',
    },
    managedAi: {
      available: ctx.config.managedAi !== null,
      label: ctx.config.managedAi?.label ?? ctx.config.MANAGED_AI_LABEL,
    },
    credentials: {
      algorithm: 'aes-256-gcm',
      ephemeralKey: ctx.cipher.ephemeral,
      note: ctx.cipher.ephemeral
        ? 'CREDENTIAL_ENCRYPTION_KEY is not set, so this development process uses an ephemeral key. Saved provider keys stop decrypting after a restart.'
        : 'Provider keys are encrypted at rest with the configured key.',
    },
    rateLimiting: {
      strategy: 'in-memory fixed window',
      note: 'Correct for a single API process; a multi-instance deployment needs a shared counter store.',
    },
    privateAiEndpointsAllowed: ctx.config.ALLOW_PRIVATE_AI_ENDPOINTS,
  }
}
