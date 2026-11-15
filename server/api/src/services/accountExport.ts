import type { AiService, AiStatus } from '../ai/aiService.ts'
import type { PublicUser } from '../auth/authService.ts'
import type { Store } from '../db/store.ts'

/**
 * Account data export.
 *
 * The export is assembled from the authenticated user's own records only. It
 * deliberately omits everything that is not the user's data or that would be a
 * credential: password hashes, session tokens, encrypted provider keys and
 * server configuration stay on the server.
 */
export const ACCOUNT_EXPORT_FORMAT = 'codepilot-account-export.v1'

export type AccountExportProject = {
  id: string
  name: string
  description: string
  language: string
  createdAt: number
  updatedAt: number
  archived: boolean
  files: Array<{
    id: string
    path: string
    kind: 'file' | 'folder'
    content: string
    updatedAt: number
  }>
}

export type AccountExport = {
  format: typeof ACCOUNT_EXPORT_FORMAT
  exportedAt: string
  user: PublicUser
  projects: AccountExportProject[]
  settings: Record<string, unknown> | null
  settingsUpdatedAt: number | null
  ai: {
    connection: AiStatus['connection']
    usage: AiStatus['usage']
    quota: AiStatus['quota']
    preferredMode: AiStatus['preferredMode']
    note: string
  }
  /** Session metadata the account owns: timestamps only, never token hashes. */
  sessions: Array<{ id: string; createdAt: number; lastSeenAt: number; expiresAt: number }>
  notIncluded: string[]
}

export const ACCOUNT_EXPORT_EXCLUSIONS = [
  'Password hash',
  'Session tokens and cookie values',
  'Provider API keys (only the last four characters are reported)',
  'Server-side configuration and rate-limit counters',
]

export async function buildAccountExport(options: {
  store: Store
  ai: AiService
  user: PublicUser
  now: number
}): Promise<AccountExport> {
  const { store, ai, user, now } = options

  const [projects, settingsRecord, status, sessions] = await Promise.all([
    store.listProjects(user.id),
    store.getSettings(user.id),
    ai.getStatus(user.id),
    store.listSessions(user.id),
  ])

  const exportedProjects: AccountExportProject[] = []
  for (const project of projects) {
    const files = (await store.listProjectFiles(user.id, project.id)) ?? []
    exportedProjects.push({
      id: project.id,
      name: project.name,
      description: project.description,
      language: project.language,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      archived: project.archived,
      files: files.map((file) => ({
        id: file.id,
        path: file.path,
        kind: file.kind,
        content: file.content,
        updatedAt: file.updatedAt,
      })),
    })
  }

  return {
    format: ACCOUNT_EXPORT_FORMAT,
    exportedAt: new Date(now).toISOString(),
    user,
    projects: exportedProjects,
    settings: settingsRecord?.settings ?? null,
    settingsUpdatedAt: settingsRecord?.updatedAt ?? null,
    ai: {
      connection: status.connection,
      usage: status.usage,
      quota: status.quota,
      preferredMode: status.preferredMode,
      note: status.usageNote,
    },
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    })),
    notIncluded: [...ACCOUNT_EXPORT_EXCLUSIONS],
  }
}
