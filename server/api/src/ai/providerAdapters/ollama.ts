import { ProviderError, type ProviderAdapter } from '../providerTypes.ts'
import { authHeaders, decodeJson, joinUrl, numberOrNull, readLines } from '../providerShared.ts'

type OllamaChunk = {
  message?: { content?: unknown }
  response?: unknown
  prompt_eval_count?: unknown
  eval_count?: unknown
  error?: unknown
}

export const ollamaProviderAdapter: ProviderAdapter = {
  requiresApiKey: false,

  async listModels(baseUrl, config, transport, signal) {
    const response = await transport.request(
      joinUrl(baseUrl, '/api/tags'),
      { method: 'GET', headers: authHeaders(config.apiKey) },
      signal,
    )
    if (!response.ok) throw await transport.httpError(response)
    const payload = decodeJson<{ models?: { name?: unknown }[] }>(
      await response.text(),
      'Ollama',
    )
    return Array.isArray(payload.models)
      ? payload.models
          .map((entry) => (typeof entry.name === 'string' ? entry.name : ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
      : []
  },

  async streamChat(baseUrl, config, messages, options, transport) {
    const response = await transport.request(
      joinUrl(baseUrl, '/api/chat'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(config.apiKey) },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
          options: {
            temperature: config.temperature ?? 0.3,
            num_predict: config.maxTokens ?? 1200,
          },
        }),
      },
      options.signal,
    )
    if (!response.ok) throw await transport.httpError(response)

    let completionChars = 0
    let promptTokens: number | null = null
    let completionTokens: number | null = null
    const applyChunk = (chunk: OllamaChunk) => {
      if (typeof chunk.error === 'string' && chunk.error) {
        throw new ProviderError('provider', chunk.error)
      }
      const text =
        typeof chunk.message?.content === 'string'
          ? chunk.message.content
          : typeof chunk.response === 'string'
            ? chunk.response
            : ''
      if (text) {
        completionChars += text.length
        options.onDelta(text)
      }
      if (numberOrNull(chunk.prompt_eval_count) !== null) {
        promptTokens = numberOrNull(chunk.prompt_eval_count)
      }
      if (numberOrNull(chunk.eval_count) !== null) {
        completionTokens = numberOrNull(chunk.eval_count)
      }
    }

    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      applyChunk(decodeJson<OllamaChunk>(await response.text(), 'Ollama'))
    } else {
      await readLines(response, (line) => {
        if (!line.trim()) return
        try {
          applyChunk(JSON.parse(line) as OllamaChunk)
        } catch (error) {
          if (error instanceof ProviderError) throw error
        }
      })
    }
    return { completionChars, usage: { promptTokens, completionTokens } }
  },
}
