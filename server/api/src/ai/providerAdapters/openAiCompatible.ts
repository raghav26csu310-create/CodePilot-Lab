import { ProviderError, type ProviderAdapter, type ProviderUsage } from '../providerTypes.ts'
import { authHeaders, decodeJson, joinUrl, numberOrNull, readLines } from '../providerShared.ts'

type OpenAiChunk = {
  choices?: {
    delta?: { content?: unknown }
    message?: { content?: unknown }
  }[]
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
  error?: { message?: unknown } | string
}

function parseChunk(chunk: OpenAiChunk): { text: string; usage: ProviderUsage } {
  const error =
    typeof chunk.error === 'string'
      ? chunk.error
      : typeof chunk.error?.message === 'string'
        ? chunk.error.message
        : null
  if (error) throw new ProviderError('provider', error)
  const choice = chunk.choices?.[0]
  const content = choice?.delta?.content ?? choice?.message?.content
  return {
    text: typeof content === 'string' ? content : '',
    usage: {
      promptTokens: numberOrNull(chunk.usage?.prompt_tokens),
      completionTokens: numberOrNull(chunk.usage?.completion_tokens),
    },
  }
}

function createOpenAiCompatibleAdapter(requiresApiKey: boolean): ProviderAdapter {
  return {
    requiresApiKey,

    async listModels(baseUrl, config, transport, signal) {
      const response = await transport.request(
        joinUrl(baseUrl, '/models'),
        { method: 'GET', headers: authHeaders(config.apiKey) },
        signal,
      )
      if (!response.ok) throw await transport.httpError(response)
      const payload = decodeJson<{ data?: { id?: unknown }[] }>(
        await response.text(),
        'The provider',
      )
      return Array.isArray(payload.data)
        ? payload.data
            .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))
        : []
    },

    async streamChat(baseUrl, config, messages, options, transport) {
      const response = await transport.request(
        joinUrl(baseUrl, '/chat/completions'),
        {
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
        },
        options.signal,
      )
      if (!response.ok) throw await transport.httpError(response)

      let completionChars = 0
      let promptTokens: number | null = null
      let completionTokens: number | null = null
      const applyChunk = (chunk: OpenAiChunk) => {
        const parsed = parseChunk(chunk)
        if (parsed.text) {
          completionChars += parsed.text.length
          options.onDelta(parsed.text)
        }
        if (parsed.usage.promptTokens !== null) promptTokens = parsed.usage.promptTokens
        if (parsed.usage.completionTokens !== null) {
          completionTokens = parsed.usage.completionTokens
        }
      }

      if ((response.headers.get('content-type') ?? '').includes('application/json')) {
        applyChunk(decodeJson<OpenAiChunk>(await response.text(), 'The provider'))
      } else {
        await readLines(response, (line) => {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) return
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === '[DONE]') return
          try {
            applyChunk(JSON.parse(payload) as OpenAiChunk)
          } catch (error) {
            if (error instanceof ProviderError) throw error
          }
        })
      }
      return {
        completionChars,
        usage: { promptTokens, completionTokens },
      }
    },
  }
}

export const openAiProviderAdapter = createOpenAiCompatibleAdapter(true)
export const deepSeekProviderAdapter = createOpenAiCompatibleAdapter(true)
export const openAiCompatibleProviderAdapter = createOpenAiCompatibleAdapter(false)
