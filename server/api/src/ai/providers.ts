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

  constructor(options: ProviderOptions) {
    this.fetchImpl = options.fetchImpl
    this.allowPrivateEndpoints = options.allowPrivateEndpoints
    this.timeoutMs = options.timeoutMs
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
