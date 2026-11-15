import { EMPTY_USAGE } from './types.ts'
import type {
  AiConnectionInput,
  AiConnectionRecord,
  AiUsageEvent,
  NewUserInput,
  ProjectFileInput,
  ProjectFileRecord,
  ProjectInput,
  ProjectRecord,
  SessionRecord,
  UsageSummary,
  UserRecord,
  UserSettingsRecord,
} from './types.ts'
import type { Store } from './store.ts'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function emptySummary(): UsageSummary {
  return { today: { ...EMPTY_USAGE }, month: { ...EMPTY_USAGE } }
}

/**
 * In-memory store used by tests and by `npm run api:dev -- --memory`. It applies
 * the same per-user filtering rules as the PostgreSQL implementation so route
 * and isolation tests exercise the real service logic.
 */
export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>()
  private sessions = new Map<string, SessionRecord>()
  private projects = new Map<string, ProjectRecord>()
  private files = new Map<string, ProjectFileRecord>()
  private settings = new Map<string, UserSettingsRecord>()
  private connections = new Map<string, AiConnectionRecord>()
  private usage: AiUsageEvent[] = []

  async ping(): Promise<boolean> {
    return true
  }

  async close(): Promise<void> {}

  async createUser(input: NewUserInput): Promise<UserRecord> {
    const normalized = input.email.trim().toLowerCase()
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === normalized) {
        throw Object.assign(new Error('That email address is already registered.'), {
          code: 'duplicate_email',
        })
      }
    }
    const record: UserRecord = {
      id: input.id,
      email: normalized,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }
    this.users.set(record.id, record)
    return clone(record)
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase()
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === normalized) {
        return clone(user)
      }
    }
    return null
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id)
    return user ? clone(user) : null
  }

  async updateUser(
    id: string,
    patch: { displayName?: string; email?: string; passwordHash?: string; updatedAt: number },
  ): Promise<UserRecord | null> {
    const current = this.users.get(id)
    if (!current) return null
    if (patch.email) {
      const normalized = patch.email.trim().toLowerCase()
      for (const user of this.users.values()) {
        if (user.id !== id && user.email.toLowerCase() === normalized) {
          throw Object.assign(new Error('That email address is already registered.'), {
            code: 'duplicate_email',
          })
        }
      }
    }
    const next: UserRecord = {
      ...current,
      displayName: patch.displayName ?? current.displayName,
      email: patch.email ? patch.email.trim().toLowerCase() : current.email,
      passwordHash: patch.passwordHash ?? current.passwordHash,
      updatedAt: patch.updatedAt,
    }
    this.users.set(id, next)
    return clone(next)
  }

  async deleteUser(id: string): Promise<boolean> {
    if (!this.users.delete(id)) return false
    for (const [sessionId, session] of this.sessions) {
      if (session.userId === id) this.sessions.delete(sessionId)
    }
    for (const [projectId, project] of this.projects) {
      if (project.userId === id) {
        this.projects.delete(projectId)
        for (const [fileId, file] of this.files) {
          if (file.projectId === projectId) this.files.delete(fileId)
        }
      }
    }
    this.settings.delete(id)
    this.connections.delete(id)
    this.usage = this.usage.filter((event) => event.userId !== id)
    return true
  }

  async createSession(input: {
    id: string
    userId: string
    tokenHash: string
    createdAt: number
    expiresAt: number
  }): Promise<SessionRecord> {
    const record: SessionRecord = {
      ...input,
      lastSeenAt: input.createdAt,
    }
    this.sessions.set(record.id, record)
    return clone(record)
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) return clone(session)
    }
    return null
  }

  async touchSession(id: string, at: number): Promise<void> {
    const session = this.sessions.get(id)
    if (session) {
      session.lastSeenAt = at
    }
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
  }

  async deleteExpiredSessions(now: number): Promise<number> {
    let removed = 0
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id)
        removed += 1
      }
    }
    return removed
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map(clone)
  }

  async deleteSessionForUser(userId: string, sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session || session.userId !== userId) return false
    this.sessions.delete(sessionId)
    return true
  }

  async deleteOtherSessions(userId: string, keepSessionId: string): Promise<number> {
    let removed = 0
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && id !== keepSessionId) {
        this.sessions.delete(id)
        removed += 1
      }
    }
    return removed
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    return [...this.projects.values()]
      .filter((project) => project.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(clone)
  }

  async createProject(userId: string, input: ProjectInput): Promise<ProjectRecord> {
    const record: ProjectRecord = {
      ...input,
      userId,
      updatedAt: input.createdAt,
      archived: false,
    }
    this.projects.set(record.id, record)
    return clone(record)
  }

  async getProject(userId: string, projectId: string): Promise<ProjectRecord | null> {
    const project = this.projects.get(projectId)
    if (!project || project.userId !== userId) return null
    return clone(project)
  }

  async updateProject(
    userId: string,
    projectId: string,
    patch: { name?: string; description?: string; language?: string; archived?: boolean },
  ): Promise<ProjectRecord | null> {
    const current = this.projects.get(projectId)
    if (!current || current.userId !== userId) return null
    const next: ProjectRecord = {
      ...current,
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      language: patch.language ?? current.language,
      archived: patch.archived ?? current.archived,
      updatedAt: Date.now(),
    }
    this.projects.set(projectId, next)
    return clone(next)
  }

  async deleteProject(userId: string, projectId: string): Promise<boolean> {
    const project = this.projects.get(projectId)
    if (!project || project.userId !== userId) return false
    this.projects.delete(projectId)
    for (const [fileId, file] of this.files) {
      if (file.projectId === projectId) this.files.delete(fileId)
    }
    return true
  }

  async listProjectFiles(
    userId: string,
    projectId: string,
  ): Promise<ProjectFileRecord[] | null> {
    const project = this.projects.get(projectId)
    if (!project || project.userId !== userId) return null
    return [...this.files.values()]
      .filter((file) => file.projectId === projectId)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(clone)
  }

  async putProjectFile(
    userId: string,
    projectId: string,
    input: ProjectFileInput,
  ): Promise<ProjectFileRecord | null> {
    const project = this.projects.get(projectId)
    if (!project || project.userId !== userId) return null
    let existingId: string | null = null
    for (const [fileId, file] of this.files) {
      if (file.projectId === projectId && file.path === input.path) {
        existingId = fileId
        break
      }
    }
    const record: ProjectFileRecord = {
      id: existingId ?? input.id,
      projectId,
      path: input.path,
      kind: input.kind,
      content: input.content,
      updatedAt: input.updatedAt,
    }
    this.files.set(record.id, record)
    return clone(record)
  }

  async deleteProjectFile(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<boolean> {
    const project = this.projects.get(projectId)
    if (!project || project.userId !== userId) return false
    const file = this.files.get(fileId)
    if (!file || file.projectId !== projectId) return false
    return this.files.delete(fileId)
  }

  async getSettings(userId: string): Promise<UserSettingsRecord | null> {
    const record = this.settings.get(userId)
    return record ? clone(record) : null
  }

  async putSettings(
    userId: string,
    settings: Record<string, unknown>,
  ): Promise<UserSettingsRecord> {
    const record: UserSettingsRecord = { userId, settings, updatedAt: Date.now() }
    this.settings.set(userId, record)
    return clone(record)
  }

  async getAiConnection(userId: string): Promise<AiConnectionRecord | null> {
    const connection = this.connections.get(userId)
    return connection ? clone(connection) : null
  }

  async upsertAiConnection(
    userId: string,
    input: AiConnectionInput,
  ): Promise<AiConnectionRecord> {
    const existing = this.connections.get(userId)
    const record: AiConnectionRecord = {
      ...input,
      userId,
      id: existing?.id ?? input.id,
      createdAt: existing?.createdAt ?? input.createdAt,
      updatedAt: input.createdAt,
      verifiedAt: null,
    }
    this.connections.set(userId, record)
    return clone(record)
  }

  async deleteAiConnection(userId: string): Promise<boolean> {
    return this.connections.delete(userId)
  }

  async markAiConnectionVerified(userId: string, at: number): Promise<void> {
    const connection = this.connections.get(userId)
    if (connection) {
      connection.verifiedAt = at
    }
  }

  async recordUsage(event: AiUsageEvent): Promise<void> {
    this.usage.push(clone(event))
  }

  async getUsageSummary(
    userId: string,
    dayStart: number,
    monthStart: number,
  ): Promise<UsageSummary> {
    const summary = emptySummary()
    for (const event of this.usage) {
      if (event.userId !== userId) continue
      if (event.createdAt >= monthStart) {
        account(summary.month, event)
      }
      if (event.createdAt >= dayStart) {
        account(summary.today, event)
      }
    }
    return summary
  }
}

function account(
  target: { requests: number; promptTokens: number; completionTokens: number; estimatedTokens: number },
  event: AiUsageEvent,
): void {
  target.requests += 1
  target.promptTokens += Math.round(event.promptChars / 4)
  target.completionTokens += Math.round(event.completionChars / 4)
  target.estimatedTokens += event.estimatedTokens
}
