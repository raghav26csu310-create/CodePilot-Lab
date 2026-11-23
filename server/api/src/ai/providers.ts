import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

import type { AiProviderId } from '../db/types.ts'
import { anthropicProviderAdapter } from './providerAdapters/anthropic.ts'
import { geminiProviderAdapter } from './providerAdapters/gemini.ts'
import {
  deepSeekProviderAdapter,
  openAiCompatibleProviderAdapter,
  openAiProviderAdapter,
} from './providerAdapters/openAiCompatible.ts'
import { ollamaProviderAdapter } from './providerAdapters/ollama.ts'
import {
  ProviderError,
  type ChatMessage,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderFailure,
  type ProviderStreamOptions,
  type ProviderTransport,
  type StreamResult,
} from './providerTypes.ts'

export {
  ProviderError,
  type ChatMessage,
  type ProviderConfig,
  type ProviderFailure,
  type ProviderUsage,
  type StreamResult,
} from './providerTypes.ts'

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  ollama: 'Ollama',
  deepseek: 'DeepSeek',
  'openai-compatible': 'OpenAI-compatible',
}

const PROVIDER_ADAPTERS: Record<AiProviderId, ProviderAdapter> = {
  openai: openAiProviderAdapter,
  anthropic: anthropicProviderAdapter,
  gemini: geminiProviderAdapter,
  ollama: ollamaProviderAdapter,
  deepseek: deepSeekProviderAdapter,
  'openai-compatible': openAiCompatibleProviderAdapter,
}

type ProviderOptions = {
  fetchImpl: typeof fetch
  allowPrivateEndpoints: boolean
  timeoutMs: number
}

/**
 * Shared API-facing interface. Each vendor adapter owns its model, request,
 * authentication-header, and streaming protocol; this client owns endpoint
 * validation, deadlines, and provider error classification.
 */
export class ProviderClient {
  private readonly fetchImpl: typeof fetch
  private readonly allowPrivateEndpoints: boolean
  private readonly timeoutMs: number
  private readonly transport: ProviderTransport
  private readonly circuit: Map<string, { failures: number; openedAt: number | null }>

  constructor(options: ProviderOptions) {
    this.fetchImpl = options.fetchImpl
    this.allowPrivateEndpoints = options.allowPrivateEndpoints
    this.timeoutMs = options.timeoutMs
    this.circuit = new Map()
    this.transport = {
      request: (url, init, signal) =>
        this.request(url, { ...init, signal: this.combinedSignal(signal) }),
      httpError: (response) => this.httpError(response),
    }
  }

  async listModels(config: ProviderConfig, signal?: AbortSignal): Promise<string[]> {
    const adapter = this.adapter(config.provider)
    this.requireKey(config, adapter)
    const baseUrl = await assertEndpointAllowed(config.baseUrl, this.allowPrivateEndpoints)
    return adapter.listModels(baseUrl, config, this.transport, signal)
  }

  async streamChat(
    config: ProviderConfig,
    messages: ChatMessage[],
    options: ProviderStreamOptions,
  ): Promise<StreamResult> {
    const adapter = this.adapter(config.provider)
    this.requireKey(config, adapter)
    if (!config.model.trim()) {
      throw new ProviderError('invalid-settings', 'Choose a model before sending.')
    }
    const baseUrl = await assertEndpointAllowed(config.baseUrl, this.allowPrivateEndpoints)
    return adapter.streamChat(baseUrl, config, messages, options, this.transport)
  }

  private adapter(provider: AiProviderId): ProviderAdapter {
    return PROVIDER_ADAPTERS[provider]
  }

  private requireKey(config: ProviderConfig, adapter: ProviderAdapter): void {
    if (adapter.requiresApiKey && !config.apiKey.trim()) {
      throw new ProviderError(
        'invalid-settings',
        `${PROVIDER_LABELS[config.provider]} requires an API key.`,
      )
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const circuitKey = url
    const circuit = this.circuitState(circuitKey)
    if (circuit.openedAt !== null) {
      const elapsed = Date.now() - circuit.openedAt
      if (elapsed < 30_000) {
        throw new ProviderError(
          'provider',
          'The provider circuit is open after repeated failures. Wait briefly before retrying.',
          null,
          'provider',
        )
      }
      circuit.failures = 0
      circuit.openedAt = null
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (init.signal?.aborted) {
        throw new ProviderError('aborted', 'The provider request was cancelled.')
      }
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          redirect: 'error',
          signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
        })
        const retryDecision = await this.retryDecision(response, attempt)
        if (retryDecision.retry) {
          if (
            retryDecision.category === 'billing' ||
            retryDecision.category === 'quota' ||
            retryDecision.category === 'authentication' ||
            retryDecision.category === 'permission'
          ) {
            throw await this.httpError(response)
          }
          const waitSeconds =
            retryDecision.retryAfterSeconds ?? Math.min(8, 2 ** attempt)
          await sleep((waitSeconds * 1000) + Math.floor(Math.random() * 250))
          continue
        }
        if (
          response.status === 408 ||
          response.status === 429 ||
          (response.status >= 500 && response.status <= 599)
        ) {
          this.recordFailure(circuit)
        } else {
          this.recordSuccess(circuit)
        }
        return response
      } catch (error) {
        if (error instanceof ProviderError) throw error
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
              null,
              'timeout',
            )
          }
          throw new ProviderError('aborted', 'The provider request was cancelled.')
        }
        if (timeoutLike(error)) {
          throw new ProviderError(
            'timeout',
            `The provider did not respond within ${Math.round(this.timeoutMs / 1000)} seconds.`,
            null,
            'timeout',
          )
        }
        this.recordFailure(circuit)
        throw new ProviderError(
          'network',
          `The provider endpoint could not be reached (${describeNetworkError(error)}).`,
          null,
          'network',
        )
      }
    }
    throw new ProviderError(
      'provider',
      'The provider remained unavailable after bounded retries.',
      null,
      'overload',
    )
  }

  private circuitState(key: string): { failures: number; openedAt: number | null } {
    let state = this.circuit.get(key)
    if (!state) {
      state = { failures: 0, openedAt: null }
      this.circuit.set(key, state)
    }
    return state
  }

  private recordSuccess(state: { failures: number; openedAt: number | null }): void {
    state.failures = 0
    state.openedAt = null
  }

  private recordFailure(state: { failures: number; openedAt: number | null }): void {
    state.failures += 1
    if (state.failures >= 3) state.openedAt = Date.now()
  }

  private async retryDecision(
    response: Response,
    attempt: number,
  ): Promise<{
    retry: boolean
    category?: ProviderFailure['category']
    retryAfterSeconds?: number
  }> {
    if (attempt >= 2) return { retry: false }
    if (response.status === 408) {
      return { retry: true, category: 'timeout' }
    }
    if (response.status === 429) {
      const text = await response.clone().text().catch(() => '')
      const category = classify429(text)
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))
      return {
        retry: category === 'overload' || category === 'rate_limit',
        category,
        retryAfterSeconds: retryAfterSeconds ?? undefined,
      }
    }
    if (response.status >= 500 && response.status <= 599) {
      // 5xx responses are provider/server failures. Return immediately to
      // fallback or the caller instead of extending past the request deadline.
      return { retry: false, category: 'overload' }
    }
    return { retry: false }
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

    if (status === 400) {
      return new ProviderError(
        'provider',
        `The provider rejected the request as invalid (HTTP 400).${detail ? ` ${detail}` : ' Check the model, messages and parameters.'}`,
        status,
        'request',
      )
    }
    if (status === 401) {
      return new ProviderError(
        'auth',
        'The provider rejected the credential (HTTP 401). Check the API key.',
        status,
        'authentication',
      )
    }
    if (status === 403) {
      return new ProviderError(
        'auth',
        'The provider denied access (HTTP 403). Check account permissions and allowed models.',
        status,
        'permission',
      )
    }
    if (status === 408) {
      return new ProviderError(
        'timeout',
        'The provider request timed out (HTTP 408). Try again or reduce the request size.',
        status,
        'timeout',
      )
    }
    if (status === 413) {
      return new ProviderError(
        'provider',
        'The provider rejected the payload as too large (HTTP 413). Reduce context or token limits.',
        status,
        'payload',
      )
    }
    if (status === 404) {
      return new ProviderError(
        'not-found',
        `The provider endpoint was not found (HTTP 404). Check the base URL${detail ? `: ${detail}` : '.'}`,
        status,
        'not_found',
      )
    }
    if (status === 429) {
      const category = classify429(detail)
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))
      const categoryMessage =
        category === 'billing'
          ? 'Account or billing quota is exhausted.'
          : category === 'quota'
            ? 'Token or daily quota is exhausted.'
            : category === 'overload'
              ? 'The provider is temporarily overloaded.'
              : 'Requests are being rate-limited.'
      return new ProviderError(
        'rate-limit',
        `The provider returned HTTP 429: ${categoryMessage}${detail ? ` ${detail}` : ''}`,
        status,
        category,
        retryAfterSeconds,
      )
    }
    return new ProviderError(
      'provider',
      `The provider answered HTTP ${status}${detail ? `: ${detail}` : '.'}`,
      status,
    )
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(300, Math.ceil(seconds))
  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    return Math.min(300, Math.max(0, Math.ceil((date - Date.now()) / 1000)))
  }
  return null
}

function classify429(detail: string): ProviderFailure['category'] {
  const text = detail.toLowerCase()
  if (
    text.includes('billing') ||
    text.includes('payment') ||
    text.includes('credit') ||
    text.includes('insufficient funds')
  ) return 'billing'
  if (
    text.includes('daily') ||
    text.includes('token') ||
    text.includes('quota') ||
    text.includes('limit exceeded') ||
    text.includes('usage limit')
  ) return 'quota'
  if (
    text.includes('overload') ||
    text.includes('capacity') ||
    text.includes('temporarily unavailable') ||
    text.includes('try again')
  ) return 'overload'
  return 'rate_limit'
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
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
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true
    }
    if (normalized.startsWith('::ffff:')) {
      return isPrivateAddress(normalized.slice('::ffff:'.length))
    }
  }
  return false
}

/** SSRF guard; local endpoints require the operator's explicit opt-in. */
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
