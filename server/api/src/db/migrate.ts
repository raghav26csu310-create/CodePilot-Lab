import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import pg from 'pg'

import { buildConfig, loadDotEnv } from '../config/env.ts'

const { Pool } = pg

/**
 * The SQL files live next to the TypeScript source, but a bundled serverless
 * function (Vercel) or the compiled `dist-api` layout places them elsewhere.
 * Try every real layout instead of assuming one.
 */
export function resolveMigrationsDir(): string {
  const candidates = [
    fileURLToPath(new URL('./migrations/', import.meta.url)),
    resolve(process.cwd(), 'server/api/src/db/migrations'),
    resolve(process.cwd(), 'dist-api/db/migrations'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `SQL migrations were not found. Looked in: ${candidates.join(', ')}. ` +
      'Build output must include the migrations directory.',
  )
}

const MIGRATIONS_DIR = resolveMigrationsDir()
const MIGRATION_LOCK_ID = 4_242_001

type MigrationFile = {
  version: number
  name: string
  sql: string
  checksum: string
}

function readMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .map((name) => {
      const match = /^(\d+)_/.exec(name)
      const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8')
      return {
        version: Number(match?.[1] ?? 0),
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      }
    })
    .sort((a, b) => a.version - b.version)
}

/**
 * Versioned migration runner. Applied migrations are immutable: changing an
 * already-applied file fails loudly instead of silently diverging from the
 * database. A PostgreSQL advisory lock prevents two API instances racing.
 */
export async function runMigrations(pool: pg.Pool, log = console.log): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const applied = new Map<number, { name: string; checksum: string }>()
    const result = await client.query('SELECT version, name, checksum FROM schema_migrations')
    for (const row of result.rows) {
      applied.set(Number(row.version), {
        name: String(row.name),
        checksum: String(row.checksum),
      })
    }

    for (const migration of readMigrations()) {
      const existing = applied.get(migration.version)
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.version} (${migration.name}) changed after it was applied. Create a new migration instead of editing history.`,
          )
        }
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        )
        await client.query('COMMIT')
        log(`[api] applied migration ${migration.version} ${migration.name}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID])
    } catch {
      // Connection may already be gone; the lock is released with the session.
    }
    client.release()
  }
}

export async function migrateFromEnv(): Promise<void> {
  loadDotEnv()
  const config = buildConfig()
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to .env or the environment.')
  }
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: /\bsslmode=require\b/.test(config.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
  })
  try {
    await runMigrations(pool)
    console.log('[api] migrations are up to date')
  } finally {
    await pool.end()
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  migrateFromEnv().catch((error) => {
    console.error('[api] migration failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
