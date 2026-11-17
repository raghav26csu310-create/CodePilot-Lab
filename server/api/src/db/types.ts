/** Persistence records shared by the PostgreSQL and in-memory stores. */

export type UserRecord = {
  id: string
  email: string
  displayName: string
  passwordHash: string
  createdAt: number
  updatedAt: number
}

export type SessionRecord = {
  id: string
  userId: string
  tokenHash: string
  createdAt: number
  expiresAt: number
  lastSeenAt: number
}

export type ProjectRecord = {
  id: string
  userId: string
  name: string
  description: string
  language: string
  createdAt: number
  updatedAt: number
  archived: boolean
}

export type ProjectFileRecord = {
  id: string
  projectId: string
  path: string
  kind: 'file' | 'folder'
  content: string
  updatedAt: number
}

export type UserSettingsRecord = {
  userId: string
  settings: Record<string, unknown>
  updatedAt: number
}

export type AiProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'deepseek'
  | 'openai-compatible'

export type AiConnectionRecord = {
  id: string
  userId: string
  provider: AiProviderId
  label: string
  baseUrl: string
  model: string
  /** AES-256-GCM envelope. Never returned by an API response. */
  encryptedApiKey: string
  keyLast4: string
  createdAt: number
  updatedAt: number
  verifiedAt: number | null
  lastTestAt: number | null
  lastTestOk: boolean | null
  lastTestMessage: string | null
}

export type AiUsageMode = 'managed' | 'byo'

export type AiUsageEvent = {
  id: string
  userId: string
  mode: AiUsageMode
  provider: string
  model: string
  status: 'complete' | 'error' | 'aborted'
  promptChars: number
  completionChars: number
  estimatedTokens: number
  latencyMs: number
  createdAt: number
}

export type UsageAggregate = {
  requests: number
  promptTokens: number
  completionTokens: number
  estimatedTokens: number
}

export const EMPTY_USAGE: UsageAggregate = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedTokens: 0,
}

export type UsageSummary = {
  today: UsageAggregate
  month: UsageAggregate
}

export type NewUserInput = {
  id: string
  email: string
  displayName: string
  passwordHash: string
  createdAt: number
}

export type ProjectInput = {
  id: string
  name: string
  description: string
  language: string
  createdAt: number
}

export type ProjectFileInput = {
  id: string
  path: string
  kind: 'file' | 'folder'
  content: string
  updatedAt: number
}

export type AiConnectionInput = {
  id: string
  provider: AiProviderId
  label: string
  baseUrl: string
  model: string
  encryptedApiKey: string
  keyLast4: string
  createdAt: number
}

export type AiConnectionTestInput = {
  id: string
  testedAt: number
  ok: boolean
  message: string
}
