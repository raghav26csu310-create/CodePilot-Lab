import pg from 'pg'
import type { Pool as PgPool, QueryResultRow } from 'pg'

import type { Store } from './store.ts'
import {
  EMPTY_USAGE,
  type AiConnectionInput,
  type AiConnectionRecord,
  type AiUsageEvent,
  type NewUserInput,
  type ProjectFileInput,
  type ProjectFileRecord,
  type ProjectInput,
  type ProjectRecord,
  type SessionRecord,
  type UsageSummary,
  type UserRecord,
  type UserSettingsRecord,
} from './types.ts'

const { Pool } = pg

function ms(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return new Date(value).getTime()
  if (typeof value === 'number') return value
  return 0
}

function mapUser(row: QueryResultRow): UserRecord {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    passwordHash: row.password_hash as string,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  }
}

function mapProject(row: QueryResultRow): ProjectRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    description: row.description as string,
    language: row.language as string,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    archived: row.archived as boolean,
  }
}

function mapFile(row: QueryResultRow): ProjectFileRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    path: row.path as string,
    kind: row.kind as 'file' | 'folder',
    content: row.content as string,
    updatedAt: ms(row.updated_at),
  }
}

function mapConnection(row: QueryResultRow): AiConnectionRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    provider: row.provider as AiConnectionRecord['provider'],
    label: row.label as string,
    baseUrl: row.base_url as string,
    model: row.model as string,
    encryptedApiKey: row.encrypted_api_key as string,
    keyLast4: row.key_last4 as string,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    verifiedAt: row.verified_at ? ms(row.verified_at) : null,
  }
}

/** PostgreSQL-backed store. Every user-owned query includes `user_id = $n`. */
export class PgStore implements Store {
  private pool: PgPool

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: /\bsslmode=require\b/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
    })
  }

  getPool(): PgPool {
    return this.pool
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async createUser(input: NewUserInput): Promise<UserRecord> {
    const normalized = input.email.trim().toLowerCase()
    try {
      const result = await this.pool.query(
        `INSERT INTO users (id, email, email_normalized, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING *`,
        [input.id, normalized, normalized, input.displayName, input.passwordHash, new Date(input.createdAt)],
      )
      return mapUser(result.rows[0]!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Object.assign(new Error('That email address is already registered.'), {
          code: 'duplicate_email',
        })
      }
      throw error
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE email_normalized = $1 LIMIT 1',
      [email.trim().toLowerCase()],
    )
    return result.rows[0] ? mapUser(result.rows[0]) : null
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id])
    return result.rows[0] ? mapUser(result.rows[0]) : null
  }

  async updateUser(
    id: string,
    patch: { displayName?: string; email?: string; passwordHash?: string; updatedAt: number },
  ): Promise<UserRecord | null> {
    const current = await this.findUserById(id)
    if (!current) return null
    const normalized = patch.email ? patch.email.trim().toLowerCase() : current.email
    try {
      const result = await this.pool.query(
        `UPDATE users
            SET display_name = $2, email = $3, email_normalized = $3, password_hash = $4, updated_at = $5
          WHERE id = $1
          RETURNING *`,
        [
          id,
          patch.displayName ?? current.displayName,
          normalized,
          patch.passwordHash ?? current.passwordHash,
          new Date(patch.updatedAt),
        ],
      )
      return result.rows[0] ? mapUser(result.rows[0]) : null
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Object.assign(new Error('That email address is already registered.'), {
          code: 'duplicate_email',
        })
      }
      throw error
    }
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM users WHERE id = $1', [id])
    return (result.rowCount ?? 0) > 0
  }

  async createSession(input: {
    id: string
    userId: string
    tokenHash: string
    createdAt: number
    expiresAt: number
  }): Promise<SessionRecord> {
    const result = await this.pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $4)
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.tokenHash,
        new Date(input.createdAt),
        new Date(input.expiresAt),
      ],
    )
    const row = result.rows[0]!
    return {
      id: row.id as string,
      userId: row.user_id as string,
      tokenHash: row.token_hash as string,
      createdAt: ms(row.created_at),
      expiresAt: ms(row.expires_at),
      lastSeenAt: ms(row.last_seen_at),
    }
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM sessions WHERE token_hash = $1 LIMIT 1',
      [tokenHash],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id as string,
      userId: row.user_id as string,
      tokenHash: row.token_hash as string,
      createdAt: ms(row.created_at),
      expiresAt: ms(row.expires_at),
      lastSeenAt: ms(row.last_seen_at),
    }
  }

  async touchSession(id: string, at: number): Promise<void> {
    await this.pool.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [
      id,
      new Date(at),
    ])
  }

  async deleteSession(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [id])
  }

  async deleteExpiredSessions(now: number): Promise<number> {
    const result = await this.pool.query('DELETE FROM sessions WHERE expires_at <= $1', [
      new Date(now),
    ])
    return result.rowCount ?? 0
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    const result = await this.pool.query(
      'SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId],
    )
    return result.rows.map(mapProject)
  }

  async createProject(userId: string, input: ProjectInput): Promise<ProjectRecord> {
    const result = await this.pool.query(
      `INSERT INTO projects (id, user_id, name, description, language, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [input.id, userId, input.name, input.description, input.language, new Date(input.createdAt)],
    )
    return mapProject(result.rows[0]!)
  }

  async getProject(userId: string, projectId: string): Promise<ProjectRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2 LIMIT 1',
      [projectId, userId],
    )
    return result.rows[0] ? mapProject(result.rows[0]) : null
  }

  async updateProject(
    userId: string,
    projectId: string,
    patch: { name?: string; description?: string; language?: string; archived?: boolean },
  ): Promise<ProjectRecord | null> {
    const current = await this.getProject(userId, projectId)
    if (!current) return null
    const result = await this.pool.query(
      `UPDATE projects
          SET name = $3, description = $4, language = $5, archived = $6, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [
        projectId,
        userId,
        patch.name ?? current.name,
        patch.description ?? current.description,
        patch.language ?? current.language,
        patch.archived ?? current.archived,
      ],
    )
    return result.rows[0] ? mapProject(result.rows[0]) : null
  }

  async deleteProject(userId: string, projectId: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM projects WHERE id = $1 AND user_id = $2', [
      projectId,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  }

  async listProjectFiles(
    userId: string,
    projectId: string,
  ): Promise<ProjectFileRecord[] | null> {
    const project = await this.getProject(userId, projectId)
    if (!project) return null
    const result = await this.pool.query(
      'SELECT * FROM project_files WHERE project_id = $1 ORDER BY path ASC',
      [projectId],
    )
    return result.rows.map(mapFile)
  }

  async putProjectFile(
    userId: string,
    projectId: string,
    input: ProjectFileInput,
  ): Promise<ProjectFileRecord | null> {
    const project = await this.getProject(userId, projectId)
    if (!project) return null
    const result = await this.pool.query(
      `INSERT INTO project_files (id, project_id, path, kind, content, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, path)
       DO UPDATE SET kind = EXCLUDED.kind, content = EXCLUDED.content, updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [input.id, projectId, input.path, input.kind, input.content, new Date(input.updatedAt)],
    )
    return mapFile(result.rows[0]!)
  }

  async deleteProjectFile(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<boolean> {
    const project = await this.getProject(userId, projectId)
    if (!project) return false
    const result = await this.pool.query(
      'DELETE FROM project_files WHERE id = $1 AND project_id = $2',
      [fileId, projectId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async getSettings(userId: string): Promise<UserSettingsRecord | null> {
    const result = await this.pool.query('SELECT * FROM user_settings WHERE user_id = $1', [
      userId,
    ])
    const row = result.rows[0]
    if (!row) return null
    return {
      userId: row.user_id as string,
      settings: row.settings as Record<string, unknown>,
      updatedAt: ms(row.updated_at),
    }
  }

  async putSettings(
    userId: string,
    settings: Record<string, unknown>,
  ): Promise<UserSettingsRecord> {
    const result = await this.pool.query(
      `INSERT INTO user_settings (user_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
       RETURNING *`,
      [userId, JSON.stringify(settings)],
    )
    const row = result.rows[0]!
    return {
      userId: row.user_id as string,
      settings: row.settings as Record<string, unknown>,
      updatedAt: ms(row.updated_at),
    }
  }

  async getAiConnection(userId: string): Promise<AiConnectionRecord | null> {
    const result = await this.pool.query('SELECT * FROM ai_connections WHERE user_id = $1', [
      userId,
    ])
    return result.rows[0] ? mapConnection(result.rows[0]) : null
  }

  async upsertAiConnection(
    userId: string,
    input: AiConnectionInput,
  ): Promise<AiConnectionRecord> {
    const result = await this.pool.query(
      `INSERT INTO ai_connections
         (id, user_id, provider, label, base_url, model, encrypted_api_key, key_last4, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (user_id) DO UPDATE SET
         provider = EXCLUDED.provider,
         label = EXCLUDED.label,
         base_url = EXCLUDED.base_url,
         model = EXCLUDED.model,
         encrypted_api_key = EXCLUDED.encrypted_api_key,
         key_last4 = EXCLUDED.key_last4,
         updated_at = EXCLUDED.updated_at,
         verified_at = NULL
       RETURNING *`,
      [
        input.id,
        userId,
        input.provider,
        input.label,
        input.baseUrl,
        input.model,
        input.encryptedApiKey,
        input.keyLast4,
        new Date(input.createdAt),
      ],
    )
    return mapConnection(result.rows[0]!)
  }

  async deleteAiConnection(userId: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM ai_connections WHERE user_id = $1', [userId])
    return (result.rowCount ?? 0) > 0
  }

  async markAiConnectionVerified(userId: string, at: number): Promise<void> {
    await this.pool.query(
      'UPDATE ai_connections SET verified_at = $2, updated_at = $2 WHERE user_id = $1',
      [userId, new Date(at)],
    )
  }

  async recordUsage(event: AiUsageEvent): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO ai_usage_events
           (id, user_id, mode, provider, model, status, prompt_chars, completion_chars,
            estimated_tokens, latency_ms, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          event.id,
          event.userId,
          event.mode,
          event.provider,
          event.model,
          event.status,
          event.promptChars,
          event.completionChars,
          event.estimatedTokens,
          event.latencyMs,
          new Date(event.createdAt),
        ],
      )
      await client.query(
        `INSERT INTO ai_usage_daily (user_id, day, requests, prompt_tokens, completion_tokens)
         VALUES ($1, (to_timestamp($2 / 1000.0))::date, 1, $3, $4)
         ON CONFLICT (user_id, day) DO UPDATE SET
           requests = ai_usage_daily.requests + 1,
           prompt_tokens = ai_usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
           completion_tokens = ai_usage_daily.completion_tokens + EXCLUDED.completion_tokens`,
        [
          event.userId,
          event.createdAt,
          Math.round(event.promptChars / 4),
          Math.round(event.completionChars / 4),
        ],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getUsageSummary(
    userId: string,
    dayStart: number,
    monthStart: number,
  ): Promise<UsageSummary> {
    const result = await this.pool.query(
      `SELECT
         COUNT(*)::int AS requests,
         COALESCE(SUM(prompt_chars), 0)::bigint AS prompt_chars,
         COALESCE(SUM(completion_chars), 0)::bigint AS completion_chars,
         COALESCE(SUM(estimated_tokens), 0)::bigint AS estimated_tokens,
         COALESCE(SUM(CASE WHEN created_at >= $2 THEN 1 ELSE 0 END), 0)::int AS day_requests,
         COALESCE(SUM(CASE WHEN created_at >= $2 THEN prompt_chars ELSE 0 END), 0)::bigint AS day_prompt_chars,
         COALESCE(SUM(CASE WHEN created_at >= $2 THEN completion_chars ELSE 0 END), 0)::bigint AS day_completion_chars,
         COALESCE(SUM(CASE WHEN created_at >= $2 THEN estimated_tokens ELSE 0 END), 0)::bigint AS day_estimated_tokens
       FROM ai_usage_events
       WHERE user_id = $1 AND created_at >= $3`,
      [userId, new Date(dayStart), new Date(monthStart)],
    )
    const row = result.rows[0]
    if (!row) {
      return { today: { ...EMPTY_USAGE }, month: { ...EMPTY_USAGE } }
    }
    const promptChars = Number(row.prompt_chars ?? 0)
    const completionChars = Number(row.completion_chars ?? 0)
    return {
      today: {
        requests: Number(row.day_requests ?? 0),
        promptTokens: Math.round(Number(row.day_prompt_chars ?? 0) / 4),
        completionTokens: Math.round(Number(row.day_completion_chars ?? 0) / 4),
        estimatedTokens: Number(row.day_estimated_tokens ?? 0),
      },
      month: {
        requests: Number(row.requests ?? 0),
        promptTokens: Math.round(promptChars / 4),
        completionTokens: Math.round(completionChars / 4),
        estimatedTokens: Number(row.estimated_tokens ?? 0),
      },
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}
