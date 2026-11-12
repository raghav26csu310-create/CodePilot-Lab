/**
 * Typed client for the local execution service (server/index.mjs).
 *
 * The browser never executes user code. When the service is offline every
 * method rejects with an explicit `ExecutionServiceError` and the UI shows the
 * real start command instead of pretending a run happened.
 */

const ENDPOINT_KEY = 'codepilot.exec.endpoint.v1'
export const DEFAULT_EXEC_ENDPOINT = 'http://127.0.0.1:5310'

export type ExecutionStatus =
  | 'ok'
  | 'compile_error'
  | 'runtime_error'
  | 'timeout'
  | 'unsupported'
  | 'cancelled'

export type ExecutionCase = {
  status: ExecutionStatus
  stdout: string
  stderr: string
  exitCode: number | null
  signal?: string | null
  durationMs: number
  message: string | null
  note: string | null
}

export type CompileInfo = {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  memoryLimit?: string | null
} | null

export type RunRequest = {
  language: string
  code: string
  stdin?: string
  tests?: { stdin: string }[]
  timeoutMs?: number
  jobId?: string
}

export type RunResponse = {
  language: string
  status: ExecutionStatus
  message: string | null
  compile: CompileInfo
  durationMs?: number
  results: ExecutionCase[]
}

export type RuntimeProbe = {
  ok: boolean
  version: string | null
  label?: string
}

export type LanguageSupport = {
  id: string
  label: string
  extension: string
  executable: boolean
  tracer: boolean
}

export type HealthResponse = {
  ok: boolean
  service: string
  platform: string
  limits: {
    maxCodeChars: number
    maxStdinChars: number
    maxStdoutChars: number
    maxStderrChars: number
    compileTimeoutMs: number
    runTimeoutMs: number
    maxTests: number
    maxTraceEvents: number
  }
  runtimes: Record<string, RuntimeProbe>
  languages: LanguageSupport[]
  tracing: { languages: string[]; note: string }
}

export type TraceVariable = {
  name: string
  type: string
  value: string
  previousValue: string | null
  changed: boolean
  scope: string
  declaredAt: number
  changedAt: number
  frameId: number
}

export type TraceFrame = {
  function: string
  line: number
}

export type TraceEvent = {
  index: number
  event: 'call' | 'line' | 'return' | 'exception'
  line: number
  function: string
  stack: TraceFrame[]
  variables: TraceVariable[]
  output: string
  returnValue?: string
  exception?: string
}

export type TraceMeta = {
  ok: boolean
  error: string | null
  events: number
  truncated: boolean
  python: string
  sourcePath: string
  finalOutput: string
} | null

export type TraceResponse = {
  status: 'ok' | 'unsupported' | 'error' | 'timeout' | 'cancelled'
  language: string
  message: string | null
  stdout?: string
  stderr?: string
  exitCode?: number | null
  durationMs?: number
  events: TraceEvent[]
  truncated: boolean
  meta: TraceMeta
  instrumentation?: string
}

export type GradeCase = {
  index: number
  hidden: boolean
  status: 'passed' | 'wrong_answer' | ExecutionStatus
  durationMs: number
  stderr: string
}

export type GradeVerdict =
  | 'accepted'
  | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error'
  | 'time_limit_exceeded'
  | 'unsupported_language'
  | 'cancelled'

export type GradeResponse = {
  verdict: GradeVerdict
  passed: number
  total: number
  message: string | null
  compile?: CompileInfo
  cases: GradeCase[]
}

export type ExecutionServiceErrorKind = 'unreachable' | 'timeout' | 'invalid-response' | 'aborted'

export class ExecutionServiceError extends Error {
  kind: ExecutionServiceErrorKind

  constructor(kind: ExecutionServiceErrorKind, message: string) {
    super(message)
    this.name = 'ExecutionServiceError'
    this.kind = kind
  }
}

export function getExecEndpoint(): string {
  try {
    const stored = window.localStorage.getItem(ENDPOINT_KEY)?.trim()
    if (stored && /^https?:\/\//.test(stored)) {
      return stored.replace(/\/+$/, '')
    }
  } catch {
    // localStorage can be unavailable; the default is still honest.
  }
  return DEFAULT_EXEC_ENDPOINT
}

export function setExecEndpoint(endpoint: string): void {
  const cleaned = endpoint.trim().replace(/\/+$/, '')
  try {
    if (cleaned && /^https?:\/\//.test(cleaned)) {
      window.localStorage.setItem(ENDPOINT_KEY, cleaned)
    } else {
      window.localStorage.removeItem(ENDPOINT_KEY)
    }
  } catch {
    // Preference is not critical; the caller reports the real endpoint.
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${getExecEndpoint()}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(rest.headers ?? {}),
      },
    })

    if (!response.ok) {
      let message = `The execution service answered ${response.status}.`
      try {
        const payload = (await response.json()) as { message?: string }
        if (payload.message) {
          message = payload.message
        }
      } catch {
        // Keep the status-based message.
      }
      throw new ExecutionServiceError('invalid-response', message)
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof ExecutionServiceError) {
      throw error
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ExecutionServiceError(
        'timeout',
        'The execution service did not answer in time. It may still be compiling or running.',
      )
    }
    throw new ExecutionServiceError(
      'unreachable',
      `No execution service is listening at ${getExecEndpoint()}. Start it with “npm run exec” in the project folder.`,
    )
  } finally {
    window.clearTimeout(timer)
  }
}

export function fetchExecutionHealth(timeoutMs = 8_000): Promise<HealthResponse> {
  return request<HealthResponse>('/health', { timeoutMs })
}

export function runCode(payload: RunRequest, timeoutMs = 40_000): Promise<RunResponse> {
  return request<RunResponse>('/run', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs,
  })
}

export function traceCode(
  payload: { language: string; code: string; stdin?: string; timeoutMs?: number; jobId?: string },
  timeoutMs = 40_000,
): Promise<TraceResponse> {
  return request<TraceResponse>('/trace', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs,
  })
}

export function gradeSubmission(
  payload: {
    problemId: string
    language: string
    code: string
    timeoutMs?: number
    jobId?: string
  },
  timeoutMs = 90_000,
): Promise<GradeResponse> {
  return request<GradeResponse>('/grade', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs,
  })
}

export function cancelExecution(jobId: string): Promise<{ cancelled: boolean; message: string }> {
  return request<{ cancelled: boolean; message: string }>('/cancel', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
    timeoutMs: 8_000,
  })
}

export function newJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
