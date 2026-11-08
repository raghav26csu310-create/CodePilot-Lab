/** Shared types for the Phase 5 Copilot bridge. */

export type AiProviderKind = 'ollama' | 'openai-compatible'

export type AiProviderPresetId =
  | 'ollama'
  | 'deepseek'
  | 'openai'
  | 'openrouter'
  | 'groq'
  | 'lmstudio'
  | 'llamacpp'
  | 'custom'

export type AiProviderPreset = {
  id: AiProviderPresetId
  label: string
  kind: AiProviderKind
  baseUrl: string
  defaultModel: string
  /** Whether the provider expects a bearer token for typical use. */
  keyExpected: boolean
  note: string
}

export type AiSettings = {
  preset: AiProviderPresetId
  provider: AiProviderKind
  baseUrl: string
  model: string
  apiKey: string
  /** Persist the key in this browser's IndexedDB. Off by default. */
  rememberKey: boolean
  temperature: number
  maxTokens: number
  /** Character budget for the context block. */
  contextChars: number
  /** Number of previous turns sent back to the model. */
  historyDepth: number
}

export type ExplainLevel = 'beginner' | 'intermediate' | 'advanced'

export type CapabilityId =
  | 'chat'
  | 'explain'
  | 'debug'
  | 'generate'
  | 'review'
  | 'tests'
  | 'learn'

export type ContextOptions = {
  includeActiveFile: boolean
  includeSelection: boolean
  includeTree: boolean
  includeDiagnostics: boolean
}

export type AiChatTurn = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ConnectionReport = {
  ok: boolean
  providerLabel: string
  baseUrl: string
  latencyMs: number
  models: string[]
  message: string
  /** Machine-readable failure class, when relevant. */
  kind?: AiErrorKind
}

export type AiErrorKind =
  | 'aborted'
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'not-found'
  | 'provider'
  | 'invalid-settings'

export type ChatRequest = {
  settings: AiSettings
  turns: AiChatTurn[]
  signal: AbortSignal
  onDelta: (chunk: string) => void
}

export type ProviderAdapter = {
  id: AiProviderKind
  label: string
  requiresKey: boolean
  listModels(settings: AiSettings, signal?: AbortSignal): Promise<string[]>
  stream(request: ChatRequest): Promise<void>
}

export type ContextFile = {
  path: string
  language: string
  content: string
  chars: number
  originalChars: number
  truncated: boolean
  source: 'draft' | 'stored' | 'disk' | 'unavailable'
  dirty: boolean
  reason?: string
}

export type ContextOmission = {
  path: string
  reason: string
}

export type ContextBundle = {
  files: ContextFile[]
  omitted: ContextOmission[]
  tree: string[]
  treeTruncated: boolean
  diagnostics: {
    path: string
    line: number
    column: number
    severity: string
    message: string
    source: string
  }[]
  selection: {
    path: string
    text: string
    startLine: number
    endLine: number
    startColumn: number
    endColumn: number
    truncated: boolean
  } | null
  totalChars: number
  selectionChars: number
}

export type ContextSummary = {
  files: {
    path: string
    language: string
    chars: number
    truncated: boolean
    source: ContextFile['source']
  }[]
  omitted: ContextOmission[]
  treeCount: number
  diagnostics: number
  selectionLines: number
  totalChars: number
}

export type CodeProposal = {
  id: string
  messageId: string
  path: string
  mode: 'replace' | 'create'
  summary: string
  content: string
  language: string
  /** Set when the model emitted a path that cannot be applied safely. */
  invalidReason: string | null
}

export type CopilotMessageStatus = 'streaming' | 'complete' | 'stopped' | 'error'

export type CopilotMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  status: CopilotMessageStatus
  capability: CapabilityId
  level: ExplainLevel
  contextSummary: ContextSummary | null
  proposals: CodeProposal[]
  providerLabel?: string
  model?: string
  elapsedMs?: number
  error?: string
  errorKind?: AiErrorKind
}

export type AppliedRevision = {
  id: string
  proposalId: string
  path: string
  /** Complete previous buffer content. Empty string means the file was new. */
  previousContent: string
  createdAt: number
  restoredAt: number | null
}

export type ProposalPreview = {
  proposal: CodeProposal
  exists: boolean
  before: string
  beforeSource: 'draft' | 'stored' | 'disk' | 'missing'
  after: string
}

export type CopilotStatus =
  | 'unconfigured'
  | 'configured'
  | 'verified'
  | 'generating'
  | 'error'
  | 'rate-limited'
  | 'testing'

export type ComposerSeed = {
  id: number
  text: string
  capability: CapabilityId
  level: ExplainLevel
}
