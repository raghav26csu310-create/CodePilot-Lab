import { AiError, isAbortError } from '../errors'
import type { AiChatTurn, AiErrorKind } from '../types'
import { consumeLines } from '../providers/http'

/**
 * Browser client for the CodePilot API gateway.
 *
 * The browser never receives a platform provider key and never talks to a
 * managed AI provider directly. It sends chat turns to the API, which resolves
 * managed/BYO credentials server-side and streams text deltas back over SSE.
 *
 * `gatewayBaseUrl()` returns an empty string for a same-origin deployment, so
 * every path below is relative and works behind a reverse proxy. Set
 * `VITE_API_BASE_URL` only when the API lives on another origin.
 */
export function gatewayBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return typeof configured === 'string' ? configured.trim().replace(/\/+$/, '') : ''
}

export type GatewayUser = {
  id: string
  email: string
  displayName: string
  createdAt: number
}

export type GatewayConnection = {
  provider: string
  providerLabel: string
  label: string
  baseUrl: string
  model: string
  hasKey: boolean
  keyLast4: string
  verifiedAt: number | null
  updatedAt: number
}

export type GatewayUsage = {
  requests: number
  estimatedTokens: number
  promptChars: number
  completionChars: number
}

export type GatewayStatus = {
  managed: {
    available: boolean
    label: string
    model: string | null
    models: string[]
    reason: string | null
    limits: { dailyRequests: number; monthlyTokens: number }
  }
  connection: GatewayConnection | null
  usage: { today: GatewayUsage; month: GatewayUsage }
  quota: {
    managedDailyRequests: number
    managedMonthlyTokens: number
    remainingToday: number | null
    remainingTokens: number | null
  }
  preferredMode: 'managed' | 'byo' | null
  defaultMode: 'managed' | 'byo' | 'none'
  usageNote: string
}

export type GatewayProbe = {
  reachable: boolean
  version: string | null
  user: GatewayUser | null
  message: string
}

/**
 * A failure that came from the CodePilot gateway itself (as opposed to a
 * provider). `code` is the server's machine-readable code so the UI can tell a
 * quota limit apart from a provider outage or a signed-out session.
 */
export class GatewayError extends AiError {
  readonly code: string

  constructor(code: string, message: string, options: { status?: number } = {}) {
    super(mapGatewayKind(code, options.status), message, options)
    this.name = 'GatewayError'
    this.code = code
  }
}

function mapGatewayKind(code: string, status?: number): AiErrorKind {
  switch (code) {
    case 'unauthorized':
      return 'auth'
    case 'rate_limited':
    case 'rate-limit':
      return 'rate-limit'
    case 'aborted':
      return 'aborted'
    case 'timeout':
      return 'timeout'
    case 'not_found':
      return 'not-found'
    case 'invalid_request':
      return 'invalid-settings'
    default:
      break
  }
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate-limit'
  if (status === 404) return 'not-found'
  return 'provider'
}

export function describeGatewayError(error: GatewayError): string {
  switch (error.code) {
    case 'unauthorized':
      return 'Sign in to CodePilot Cloud to use managed AI.'
    case 'rate_limited':
      return error.message
    case 'service_unavailable':
      return error.message
    default:
      return error.message
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

export async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers()
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${gatewayBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (cause) {
    if (isAbortError(cause)) {
      throw new AiError('aborted', 'The request was cancelled.', { cause })
    }
    throw new AiError(
      'network',
      'The CodePilot API could not be reached. Start the API (npm run api:dev) or check the configured API URL.',
      { cause },
    )
  }

  if (!response.ok) {
    throw await gatewayHttpError(response)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new GatewayError(
      'invalid_response',
      'The CodePilot API returned a response that is not JSON.',
      { status: response.status },
    )
  }
}

async function gatewayHttpError(response: Response): Promise<GatewayError> {
  let code = 'http_error'
  let message = `The CodePilot API answered HTTP ${response.status}.`
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown }
    if (typeof payload.error === 'string') code = payload.error
    if (typeof payload.message === 'string') message = payload.message
  } catch {
    // Non-JSON error bodies keep the generic HTTP message.
  }
  return new GatewayError(code, message, { status: response.status })
}

/** Real reachability probe: a failed request is reported as unreachable. */
export async function probeGateway(signal?: AbortSignal): Promise<GatewayProbe> {
  try {
    const [health, session] = await Promise.all([
      requestJson<{ ok: boolean; version?: string }>('/api/health', { signal }),
      requestJson<{ user: GatewayUser | null }>('/api/auth/session', { signal }),
    ])
    return {
      reachable: health.ok === true,
      version: typeof health.version === 'string' ? health.version : null,
      user: session.user ?? null,
      message: health.ok
        ? 'The CodePilot API answered.'
        : 'The CodePilot API answered but is not healthy.',
    }
  } catch (cause) {
    if (cause instanceof AiError && cause.kind === 'aborted') {
      return { reachable: false, version: null, user: null, message: cause.message }
    }
    return {
      reachable: false,
      version: null,
      user: null,
      message:
        cause instanceof Error
          ? cause.message
          : 'The CodePilot API did not answer.',
    }
  }
}

export async function fetchGatewaySession(signal?: AbortSignal): Promise<GatewayUser | null> {
  const payload = await requestJson<{ user: GatewayUser | null }>('/api/auth/session', { signal })
  return payload.user ?? null
}

export async function fetchGatewayStatus(signal?: AbortSignal): Promise<GatewayStatus> {
  const payload = await requestJson<{ status: GatewayStatus }>('/api/ai/status', { signal })
  return payload.status
}

export async function signInWithGateway(input: {
  email: string
  password: string
}): Promise<GatewayUser> {
  const payload = await requestJson<{ user: GatewayUser }>('/api/auth/login', {
    method: 'POST',
    body: input,
  })
  return payload.user
}

export async function registerWithGateway(input: {
  email: string
  password: string
  displayName: string
}): Promise<GatewayUser> {
  const payload = await requestJson<{ user: GatewayUser }>('/api/auth/register', {
    method: 'POST',
    body: input,
  })
  return payload.user
}

export async function signOutOfGateway(): Promise<void> {
  await requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

/**
 * Download the authenticated user's server-side data as JSON. The API decides
 * the filename; the browser only turns the response bytes into a file the user
 * saves. Nothing is written to IndexedDB or localStorage.
 */
export async function exportAccountData(): Promise<{ filename: string; blob: Blob }> {
  let response: Response
  try {
    response = await fetch(`${gatewayBaseUrl()}/api/account/export`, {
      method: 'GET',
      credentials: 'include',
    })
  } catch (cause) {
    throw new AiError(
      'network',
      'The CodePilot API could not be reached, so the export was not downloaded.',
      { cause },
    )
  }

  if (!response.ok) {
    throw await gatewayHttpError(response)
  }

  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/i.exec(disposition)
  return {
    filename: match?.[1] ?? 'codepilot-account.json',
    blob: await response.blob(),
  }
}

export async function setGatewayMode(mode: 'managed' | 'byo'): Promise<GatewayStatus> {
  const payload = await requestJson<{ status: GatewayStatus }>('/api/ai/mode', {
    method: 'POST',
    body: { mode },
  })
  return payload.status
}

export async function saveGatewayConnection(input: {
  provider: 'ollama' | 'deepseek' | 'openai-compatible'
  label?: string
  baseUrl: string
  model: string
  apiKey?: string
}): Promise<GatewayStatus> {
  const payload = await requestJson<{ status: GatewayStatus }>('/api/ai/connection', {
    method: 'PUT',
    body: input,
  })
  return payload.status
}

export async function deleteGatewayConnection(): Promise<GatewayStatus> {
  const payload = await requestJson<{ status: GatewayStatus }>('/api/ai/connection', {
    method: 'DELETE',
  })
  return payload.status
}

export type GatewayTestResult = {
  ok: boolean
  mode: 'managed' | 'byo'
  label: string
  baseUrl: string
  latencyMs: number
  models: string[]
  message: string
  kind?: string
}

export async function testGatewayConnection(input: {
  mode?: 'managed' | 'byo'
  provider?: 'ollama' | 'deepseek' | 'openai-compatible'
  baseUrl?: string
  model?: string
  apiKey?: string
}): Promise<GatewayTestResult> {
  const payload = await requestJson<{ result: GatewayTestResult }>('/api/ai/connection/test', {
    method: 'POST',
    body: input,
  })
  return payload.result
}

export type GatewayChatInput = {
  turns: AiChatTurn[]
  mode?: 'managed' | 'byo'
  model?: string
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
  onDelta: (chunk: string) => void
  onMeta?: (meta: { mode: 'managed' | 'byo'; provider: string; model: string; label: string }) => void
}

type SseEvent =
  | { type: 'meta'; mode: 'managed' | 'byo'; provider: string; model: string; label: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; completionChars: number; promptChars: number; latencyMs: number; estimatedTokens: number }
  | { type: 'error'; code: string; message: string }

/**
 * Streams a chat completion through the gateway. Text deltas are forwarded as
 * they arrive; a provider or quota failure arrives as a structured `error`
 * event and is thrown as a `GatewayError` so partial text is preserved by the
 * caller.
 */
export async function streamGatewayChat(input: GatewayChatInput): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${gatewayBaseUrl()}/api/ai/chat`, {
      method: 'POST',
      credentials: 'include',
      signal: input.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        mode: input.mode,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        messages: input.turns.map((turn) => ({ role: turn.role, content: turn.content })),
      }),
    })
  } catch (cause) {
    if (isAbortError(cause)) {
      throw new AiError('aborted', 'Generation stopped.', { cause })
    }
    throw new AiError(
      'network',
      'The CodePilot API could not be reached. Check that the API is running and that VITE_API_BASE_URL points at it.',
      { cause },
    )
  }

  if (!response.ok) {
    throw await gatewayHttpError(response)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    throw new GatewayError(
      'invalid_response',
      'The CodePilot API did not return an event stream. Check the API URL and that you are signed in.',
      { status: response.status },
    )
  }

  const state: { failure: GatewayError | null; completed: boolean } = {
    failure: null,
    completed: false,
  }

  await consumeLines(response, (line) => {
    if (!line.startsWith('data:')) {
      return
    }
    const payload = line.slice(5).trim()
    if (!payload) {
      return
    }

    let event: SseEvent
    try {
      event = JSON.parse(payload) as SseEvent
    } catch {
      return
    }

    switch (event.type) {
      case 'meta':
        input.onMeta?.({
          mode: event.mode,
          provider: event.provider,
          model: event.model,
          label: event.label,
        })
        break
      case 'delta':
        if (typeof event.text === 'string' && event.text.length > 0) {
          input.onDelta(event.text)
        }
        break
      case 'done':
        state.completed = true
        break
      case 'error':
        state.failure = new GatewayError(event.code, event.message)
        break
      default:
        break
    }
  })

  if (state.failure) {
    throw state.failure
  }
  if (!state.completed) {
    throw new GatewayError(
      'incomplete_stream',
      'The stream ended before the API reported completion. Partial output is kept for review.',
    )
  }
}
