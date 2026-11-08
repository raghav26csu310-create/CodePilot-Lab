import type { AiErrorKind } from './types'

/**
 * A classified provider failure. The Copilot UI renders these verbatim; no
 * generic "something went wrong" replaces what the provider actually said.
 */
export class AiError extends Error {
  readonly kind: AiErrorKind
  readonly status: number | null
  readonly retryAfterSeconds: number | null

  constructor(
    kind: AiErrorKind,
    message: string,
    options: { status?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'AiError'
    this.kind = kind
    this.status = options.status ?? null
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}

export function isAbortError(value: unknown): boolean {
  return value instanceof DOMException
    ? value.name === 'AbortError'
    : value instanceof Error && value.name === 'AbortError'
}

export function toAiError(cause: unknown, baseUrl: string): AiError {
  if (cause instanceof AiError) {
    return cause
  }

  if (isAbortError(cause)) {
    return new AiError('aborted', 'Generation stopped.')
  }

  if (
    cause instanceof DOMException &&
    (cause.name === 'TimeoutError' || cause.name === 'AbortError')
  ) {
    return new AiError('timeout', 'The provider did not answer before the request timed out.')
  }

  if (cause instanceof TypeError) {
    return new AiError(
      'network',
      `The request to ${baseUrl} never reached a provider. The server may be offline, or the browser blocked the cross-origin request (CORS).`,
      { cause },
    )
  }

  if (cause instanceof Error && cause.message) {
    return new AiError('provider', cause.message, { cause })
  }

  return new AiError('provider', 'The provider request failed without an error message.')
}

export function describeAiError(error: AiError): string {
  switch (error.kind) {
    case 'auth':
      return `The provider rejected the credentials (HTTP ${error.status ?? 401}). Check the API key in provider settings.`
    case 'rate-limit': {
      const wait =
        error.retryAfterSeconds !== null
          ? ` Retry after ${error.retryAfterSeconds} second${error.retryAfterSeconds === 1 ? '' : 's'}.`
          : ''
      return `The provider rate-limited this request (HTTP 429).${wait} Free tiers are not unlimited; nothing is retried automatically.`
    }
    case 'network':
      return error.message
    case 'timeout':
      return 'The provider did not respond before the timeout. It may be loading a large model, or the endpoint is wrong.'
    case 'not-found':
      return `${error.message} Check the base URL path — it usually ends in /v1 for OpenAI-compatible providers.`
    case 'invalid-settings':
      return error.message
    case 'aborted':
      return 'Generation stopped.'
    default:
      return error.message
  }
}
