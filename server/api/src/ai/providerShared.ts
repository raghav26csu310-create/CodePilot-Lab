import { ProviderError, type ProviderUsage } from './providerTypes.ts'

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

export function providerUsage(
  promptTokens: unknown,
  completionTokens: unknown,
): ProviderUsage {
  return {
    promptTokens: numberOrNull(promptTokens),
    completionTokens: numberOrNull(completionTokens),
  }
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
}

export async function readLines(
  response: Response,
  onLine: (line: string) => void,
): Promise<void> {
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
    if (buffer.trim()) onLine(buffer.trim())
  } finally {
    reader.releaseLock()
  }
}

export function decodeJson<T>(text: string, provider: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProviderError('provider', `${provider} returned a response that was not valid JSON.`)
  }
}
