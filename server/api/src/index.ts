import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { createApp } from './app.ts'
import {
  buildConfig,
  ConfigurationError,
  loadDotEnv,
  type AppConfig,
} from './config/env.ts'
import { PgStore } from './db/pgStore.ts'

/**
 * API entry point. Run with `npm run api:dev` (watch) or `npm run api:start`.
 * The process refuses to start with an incomplete production configuration and
 * prints only non-secret capability state.
 */
async function main(): Promise<void> {
  loadDotEnv()

  let config: AppConfig
  try {
    config = buildConfig()
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(`[api] configuration error: ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }

  const app = await createApp({ config, runMigrationsOnStart: true })
  const usingPostgres = app.context.store instanceof PgStore

  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(config.API_PORT, config.API_HOST, () => {
      app.server.off('error', reject)
      resolve()
    })
  })

  const lines = [
    `CodePilot API · http://${config.API_HOST}:${config.API_PORT}`,
    `store: ${usingPostgres ? 'postgresql' : 'in-memory (development only)'}`,
    `managed AI: ${config.managedAi ? config.managedAi.label : 'not configured'}`,
    `BYO endpoints: ${config.ALLOW_PRIVATE_AI_ENDPOINTS ? 'private allowed' : 'public only'}`,
    `credentials: ${app.context.cipher.ephemeral ? 'ephemeral development key' : 'configured key'}`,
    `origins: ${config.allowedOrigins.join(', ') || '(none)'}`,
  ]
  console.log(lines.join('\n'))

  if (app.context.cipher.ephemeral) {
    console.warn(
      '[api] CREDENTIAL_ENCRYPTION_KEY is not set. Saved BYO credentials will stop decrypting after restart.',
    )
  }
  if (!usingPostgres) {
    console.warn('[api] Using the in-memory store. Data is lost when this process exits.')
  }

  let closing = false
  const shutdown = (signal: string) => {
    if (closing) return
    closing = true
    console.log(`[api] ${signal} received; closing.`)
    void app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('[api] shutdown failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
      console.error('[api] The configured API_PORT is already in use.')
    } else {
      console.error('[api] failed to start:', error instanceof Error ? error.message : error)
    }
    process.exitCode = 1
  })
}
