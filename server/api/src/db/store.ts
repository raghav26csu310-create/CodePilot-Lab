import type {
  AiConnectionInput,
  AiConnectionRecord,
  AiConnectionTestInput,
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

/**
 * Persistence boundary. Every method that touches user-owned data takes the
 * user id and filters by it, which is what makes cross-user reads impossible
 * even when a caller knows another user's identifier.
 */
export type Store = {
  ping(): Promise<boolean>
  close(): Promise<void>

  createUser(input: NewUserInput): Promise<UserRecord>
  findUserByEmail(email: string): Promise<UserRecord | null>
  findUserById(id: string): Promise<UserRecord | null>
  updateUser(
    id: string,
    patch: { displayName?: string; email?: string; passwordHash?: string; updatedAt: number },
  ): Promise<UserRecord | null>
  deleteUser(id: string): Promise<boolean>

  createSession(input: {
    id: string
    userId: string
    tokenHash: string
    createdAt: number
    expiresAt: number
  }): Promise<SessionRecord>
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>
  touchSession(id: string, at: number): Promise<void>
  deleteSession(id: string): Promise<void>
  deleteExpiredSessions(now: number): Promise<number>
  /** Sessions owned by one account, newest first. Never leaves the store with token hashes. */
  listSessions(userId: string): Promise<SessionRecord[]>
  /** Revokes one session only when it belongs to the account. */
  deleteSessionForUser(userId: string, sessionId: string): Promise<boolean>
  /** Revokes every session of the account except the one making the request. */
  deleteOtherSessions(userId: string, keepSessionId: string): Promise<number>

  listProjects(userId: string): Promise<ProjectRecord[]>
  createProject(userId: string, input: ProjectInput): Promise<ProjectRecord>
  getProject(userId: string, projectId: string): Promise<ProjectRecord | null>
  updateProject(
    userId: string,
    projectId: string,
    patch: { name?: string; description?: string; language?: string; archived?: boolean },
  ): Promise<ProjectRecord | null>
  deleteProject(userId: string, projectId: string): Promise<boolean>

  listProjectFiles(userId: string, projectId: string): Promise<ProjectFileRecord[] | null>
  putProjectFile(
    userId: string,
    projectId: string,
    input: ProjectFileInput,
  ): Promise<ProjectFileRecord | null>
  deleteProjectFile(userId: string, projectId: string, fileId: string): Promise<boolean>

  getSettings(userId: string): Promise<UserSettingsRecord | null>
  putSettings(userId: string, settings: Record<string, unknown>): Promise<UserSettingsRecord>

  listAiConnections(userId: string): Promise<AiConnectionRecord[]>
  getAiConnection(userId: string, connectionId: string): Promise<AiConnectionRecord | null>
  upsertAiConnection(userId: string, input: AiConnectionInput): Promise<AiConnectionRecord>
  deleteAiConnection(userId: string, connectionId: string): Promise<boolean>
  markAiConnectionTest(userId: string, input: AiConnectionTestInput): Promise<void>

  recordUsage(event: AiUsageEvent): Promise<void>
  getUsageSummary(userId: string, dayStart: number, monthStart: number): Promise<UsageSummary>
}
