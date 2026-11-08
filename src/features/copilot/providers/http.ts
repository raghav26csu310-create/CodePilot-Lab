import { AiError } from '../errors'

/** Removes trailing slashes and appends a path without doubling the slash. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

export function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

/** Reads a response body line by line without buffering the whole stream. */
export async function consumeLines(
  response: Response,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new AiError('provider', 'The provider returned no readable response stream.')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')

      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        onLine(line)
        newline = buffer.indexOf('\n')
      }
    }

    buffer += decoder.decode()
    if (buffer.trim().length > 0) {
      onLine(buffer.replace(/\r$/, ''))
    }
  } catch (cause) {
    try {
      await reader.cancel()
    } catch {
      // The stream is already gone; the original error is the useful one.
    }
    throw cause
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null
  }

  const seconds = Number.parseInt(value, 10)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds
  }

  const date = Date.parse(value)
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000))
  }

  return null
}

type ErrorPayload = {
  error?: { message?: unknown; type?: unknown; code?: unknown } | string
  message?: unknown
}

async function readErrorPayload(response: Response): Promise<string> {
  let text: string
  try {
    text = await response.text()
  } catch {
    return ''
  }

  if (!text) {
    return ''
  }

  try {
    const parsed = JSON.parse(text) as ErrorPayload
    const fromObject =
      typeof parsed.error === 'object' && parsed.error !== null
        ? parsed.error.message
        : typeof parsed.error === 'string'
          ? parsed.error
          : parsed.message
    if (typeof fromObject === 'string' && fromObject.trim()) {
      return fromObject.trim().slice(0, 800)
    }
  } catch {
    // Not JSON; fall through to the raw body.
  }

  return text.trim().slice(0, 800)
}

/** Turns a non-2xx response into a typed, human-readable error. */
export async function httpError(response: Response): Promise<AiError> {
  const detail = await readErrorPayload(response)
  const status = response.status
  const suffix = detail ? ` ${detail}` : ''

  if (status === 401 || status === 403) {
    return new AiError('auth', `HTTP ${status}.${suffix}`, { status })
  }

  if (status === 429) {
    return new AiError('rate-limit', `HTTP 429.${suffix}`, {
      status,
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')) ?? undefined,
    })
  }

  if (status === 404) {
    return new AiError('not-found', `HTTP 404 from ${response.url}.${suffix}`, { status })
  }

  if (status >= 500) {
    return new AiError(
      'provider',
      `The provider reported a server error (HTTP ${status}).${suffix}`,
      { status },
    )
  }

  return new AiError('provider', `HTTP ${status}.${suffix}`, { status })
}

/** Merges an optional caller signal with a timeout without leaking listeners. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  if (!signal) {
    return timeout
  }

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, timeout])
  }

  const controller = new AbortController()
  const abort = () => controller.abort()

  if (signal.aborted || timeout.aborted) {
    controller.abort()
  } else {
    signal.addEventListener('abort', abort, { once: true })
    timeout.addEventListener('abort', abort, { once: true })
  }

  return controller.signal
}
