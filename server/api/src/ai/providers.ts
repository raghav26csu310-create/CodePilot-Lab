import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

import type { AiProviderId } from '../db/types.ts'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ProviderConfig = {
  provider: AiProviderId
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
}

export type ProviderUsage = {
  promptTokens: number | null
  completionTokens: number | null
}

export type StreamResult = {
  completionChars: number
  usage: ProviderUsage
}

export type ProviderFailure = {
  code:
    | 'aborted'
    | 'auth'
    | 'rate-limit'
    | 'network'
    | 'timeout'
    | 'not-found'
    | 'provider'
    | 'invalid-endpoint'
  status: number | null
  message: string
}

export class ProviderError extends Error {
  code: ProviderFailure['code']
  status: number | null

  constructor(code: ProviderFailure['code'], message: string, status: number | null = null) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  ollama: 'Ollama',
  deepseek: 'DeepSeek',
  'openai-compatible': 'OpenAI-compatible',
}

type ProviderOptions = {
  fetchImpl: typeof fetch
  allowPrivateEndpoints: boolean
  timeoutMs: number
}

type StreamOptions = {
  signal: AbortSignal
  onDelta: (text: string) => void
}

/**
 * Server-side provider transport. It is the only place that sees a provider API
 * key, and it never logs or returns the key. Both adapters stream text deltas;
 * native `ollama` uses NDJSON and `openai-compatible` (including DeepSeek) uses
 * SSE.
 */
export class ProviderClient {
  private readonly fetchImpl: typeof fetch
  private readonly allowPrivateEndpoints: boolean
  private readonly timeoutMs: number

  constructor(options: ProviderOptions) {
    this.fetchImpl = options.fetchImpl
    this.allowPrivateEndpoints = options.allowPrivateEndpoints
    this.timeoutMs = options.timeoutMs
  }

  async listModels(config: ProviderConfig, signal?: AbortSignal): Promise<string[]> {
    const baseUrl = await assertEndpointAllowed(config.baseUrl, this.allowPrivateEndpoints)
    const url =
      config.provider === 'ollama'
        ? joinUrl(baseUrl, '/api/tags')
        : joinUrl(baseUrl, '/models')
    const response = await this.request(url, {
      method: 'GET',
      headers: authHeaders(config.apiKey),
      signal: this.combinedSignal(signal),
    })

    if (!response.ok) {
      throw await this.httpError(response)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ProviderError('provider', 'The provider returned a model list that is not JSON.')
    }

    if (config.provider === 'ollama') {
      const models = (payload as { models?: { name?: unknown }[] }).models
      return Array.isArray(models)
        ? models
            .map((entry) => (typeof entry.name === 'string' ? entry.name : ''))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))
        : []
    }

    const data = (payload as { data?: { id?: unknown }[] }).data
    return Array.isArray(data)
      ? data
          .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
      : []
  }

  async streamChat(
    config: ProviderConfig,
    messages: ChatMessage[],
    options: StreamOptions,
  ): Promise<StreamResult> {
    const baseUrl = await assertEndpointAllowed(config.baseUrl, this.allowPrivateEndpoints)
    if (config.provider === 'ollama') {
      return this.streamOllama(baseUrl, config, messages, options)
    }
    return this.streamOpenAiCompatible(baseUrl, config, messages, options)
  }

  private async streamOllama(
    baseUrl: string,
    config: ProviderConfig,
    messages: ChatMessage[],
    options: StreamOptions,
  ): Promise<StreamResult> {
    const response = await this.request(joinUrl(baseUrl, '/api/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(config.apiKey),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        options: {
          temperature: config.temperature ?? 0.3,
          num_predict: config.maxTokens ?? 1200,
        },
      }),
      signal: this.combinedSignal(options.signal),
    })

    if (!response.ok) {
      throw await this.httpError(response)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as {
        message?: { content?: unknown }
        prompt_eval_count?: unknown
        eval_count?: unknown
      }
      const text = typeof payload.message?.content === 'string' ? payload.message.content : ''
      if (text) options.onDelta(text)
      return {
        completionChars: text.length,
        usage: {
          promptTokens: numberOrNull(payload.prompt_eval_count),
          completionTokens: numberOrNull(payload.eval_count),
        },
      }
    }

    let completionChars = 0
    let promptTokens: number | null = null
    let completionTokens: number | null = null

    await readLines(response, (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let chunk: {
        message?: { content?: unknown }
        done?: unknown
        prompt_eval_count?: unknown
        eval_count?: unknown
        error?: unknown
      }
      try {
        chunk = JSON.parse(trimmed) as typeof chunk
      } catch {
        return
      }
      if (typeof chunk.error === 'string') {
        throw new ProviderError('provider', chunk.error)
      }
      if (typeof chunk.message?.content === 'string' && chunk.message.content) {
        completionChars += chunk.message.content.length
        options.onDelta(chunk.message.content)
      }
      if (numberOrNull(chunk.prompt_eval_count) !== null) {
        promptTokens = numberOrNull(chunk.prompt_eval_count)
      }
      if (numberOrNull(chunk.eval_count) !== null) {
        completionTokens = numberOrNull(chunk.eval_count)
      }
    })

    return { completionChars, usage: { promptTokens, completionTokens } }
  }

  private async streamOpenAiCompatible(
    baseUrl: string,
    config: ProviderConfig,
    messages: ChatMessage[],
    options: StreamOptions,
  ): Promise<StreamResult> {
    const response = await this.request(joinUrl(baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders(config.apiKey),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: config.temperature ?? 0.3,
        max_tokens: config.maxTokens ?? 1200,
      }),
      signal: this.combinedSignal(options.signal),
    })

    if (!response.ok) {
      throw await this.httpError(response)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as OpenAiChunk
      const text = openAiText(payload)
      if (text) options.onDelta(text)
      return {
        completionChars: text.length,
        usage: openAiUsage(payload),
      }
    }

    let completionChars = 0
    let promptTokens: number | null = null
    let completionTokens: number | null = null

    await readLines(response, (line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(':')) return
      const payloadText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
      if (!payloadText || payloadText === '[DONE]') return

      let chunk: OpenAiChunk
      try {
        chunk = JSON.parse(payloadText) as OpenAiChunk
      } catch {
        return
      }
      if (chunk.error && typeof chunk.error === 'object' && typeof chunk.error.message === 'string') {
        throw new ProviderError('provider', chunk.error.message)
      }
      if (typeof chunk.error === 'string' && chunk.error) {
        throw new ProviderError('provider', chunk.error)
      }
      const text = openAiText(chunk)
      if (text) {
        completionChars += text.length
        options.onDelta(text)
      }
      const usage = openAiUsage(chunk)
      if (usage.promptTokens !== null) promptTokens = usage.promptTokens
      if (usage.completionTokens !== null) completionTokens = usage.completionTokens
    })

    return { completionChars, usage: { promptTokens, completionTokens } }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (isAbort(error) || init.signal?.aborted) {
        const reason: unknown = init.signal?.reason
        const timedOut =
          timeoutLike(error) ||
          (reason instanceof DOMException && reason.name === 'TimeoutError') ||
          (reason instanceof Error && reason.name === 'TimeoutError')
        if (timedOut) {
          throw new ProviderError(
            'timeout',
            `The provider did not respond within ${Math.round(this.timeoutMs / 1000)} seconds.`,
          )
        }
        throw new ProviderError('aborted', 'The provider request was cancelled.')
      }
      if (timeoutLike(error)) {
        throw new ProviderError(
          'timeout',
          `The provider did not respond within ${Math.round(this.timeoutMs / 1000)} seconds.`,
        )
      }
      throw new ProviderError(
        'network',
        `The provider endpoint could not be reached (${describeNetworkError(error)}).`,
      )
    }
  }

  private combinedSignal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async httpError(response: Response): Promise<ProviderError> {
    const status = response.status
    let detail = ''
    try {
      const text = (await response.text()).slice(0, 400)
      if (text) {
        try {
          const parsed = JSON.parse(text) as {
            error?: { message?: unknown } | string
            message?: unknown
          }
          detail =
            typeof parsed.error === 'string'
              ? parsed.error
              : typeof parsed.error?.message === 'string'
                ? parsed.error.message
                : typeof parsed.message === 'string'
                  ? parsed.message
                  : text
        } catch {
          detail = text
        }
      }
    } catch {
      // Keep the status-based message.
    }

    if (status === 401 || status === 403) {
      return new ProviderError(
        'auth',
        `The provider rejected the credential (HTTP ${status}). Check the key and account access.`,
        status,
      )
    }
    if (status === 404) {
      return new ProviderError(
        'not-found',
        `The provider endpoint was not found (HTTP 404). Check the base URL${detail ? `: ${detail}` : '.'}`,
        status,
      )
    }
    if (status === 429) {
      return new ProviderError(
        'rate-limit',
        `The provider rate-limited this request (HTTP 429).${detail ? ` ${detail}` : ''}`,
        status,
      )
    }
    return new ProviderError(
      'provider',
      `The provider answered HTTP ${status}${detail ? `: ${detail}` : '.'}`,
      status,
    )
  }
}

type OpenAiChunk = {
  choices?: {
    delta?: { content?: unknown }
    message?: { content?: unknown }
  }[]
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
  }
  error?: { message?: unknown } | string
}

function openAiText(chunk: OpenAiChunk): string {
  const choice = chunk.choices?.[0]
  const content = choice?.delta?.content ?? choice?.message?.content
  return typeof content === 'string' ? content : ''
}

function openAiUsage(chunk: OpenAiChunk): ProviderUsage {
  return {
    promptTokens: numberOrNull(chunk.usage?.prompt_tokens),
    completionTokens: numberOrNull(chunk.usage?.completion_tokens),
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

async function readLines(response: Response, onLine: (line: string) => void): Promise<void> {
  if (!response.body) {
    throw new ProviderError('provider', 'The provider returned an empty response body.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        onLine(line)
        index = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      onLine(buffer.trim())
    }
  } finally {
    reader.releaseLock()
  }
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function timeoutLike(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  const cause = (error as { cause?: { code?: string } }).cause
  return cause?.code ?? error.name ?? 'network error'
}

const PRIVATE_HOST_PATTERN =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const parts = address.split('.').map(Number)
    const a = parts[0] ?? 0
    const b = parts[1] ?? 0
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (family === 6) {
    const normalized = address.toLowerCase()
    if (normalized === '::1' || normalized === '::') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true
    }
    if (normalized.startsWith('::ffff:')) {
      return isPrivateAddress(normalized.slice('::ffff:'.length))
    }
  }
  return false
}

/**
 * SSRF guard for user-supplied base URLs. Local/private endpoints are allowed
 * only when the operator opts in (needed for Ollama on a laptop). This is a
 * defence-in-depth check; an egress firewall remains the authoritative control.
 */
export async function assertEndpointAllowed(
  raw: string,
  allowPrivate: boolean,
): Promise<string> {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ProviderError('invalid-endpoint', 'Enter a valid http(s) provider base URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError('invalid-endpoint', 'Provider base URLs must use http or https.')
  }
  if (url.username || url.password) {
    throw new ProviderError('invalid-endpoint', 'Provider base URLs cannot embed credentials.')
  }
  url.hash = ''
  url.search = ''

  if (allowPrivate) {
    return url.toString().replace(/\/+$/, '')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (PRIVATE_HOST_PATTERN.test(hostname) || isPrivateAddress(hostname)) {
    throw new ProviderError(
      'invalid-endpoint',
      'Private and loopback provider endpoints are disabled on this server. Point the base URL at a public endpoint, or set ALLOW_PRIVATE_AI_ENDPOINTS=1 for a local deployment.',
    )
  }

  if (!isIP(hostname)) {
    let addresses: { address: string }[]
    try {
      addresses = await lookup(hostname, { all: true })
    } catch {
      throw new ProviderError('network', `The provider host ${hostname} could not be resolved.`)
    }
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new ProviderError(
        'invalid-endpoint',
        'That hostname resolves to a private address, which this server will not call.',
      )
    }
  }

  return url.toString().replace(/\/+$/, '')
}
