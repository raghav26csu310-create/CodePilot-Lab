import { ProviderError, type ProviderAdapter } from '../providerTypes.ts'
import { decodeJson, joinUrl, numberOrNull, readLines } from '../providerShared.ts'

type AnthropicEvent = {
  type?: unknown
  delta?: { text?: unknown }
  message?: { usage?: { input_tokens?: unknown } }
  usage?: { output_tokens?: unknown }
  error?: { message?: unknown }
}

export const anthropicProviderAdapter: ProviderAdapter = {
  requiresApiKey: true,

  async listModels(baseUrl, config, transport, signal) {
    const response = await transport.request(
      joinUrl(baseUrl, '/v1/models?limit=1000'),
      {
        method: 'GET',
        headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      },
      signal,
    )
    if (!response.ok) throw await transport.httpError(response)
    const payload = decodeJson<{ data?: { id?: unknown }[] }>(
      await response.text(),
      'Anthropic',
    )
    return Array.isArray(payload.data)
      ? payload.data
          .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
      : []
  },

  async streamChat(baseUrl, config, messages, options, transport) {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const response = await transport.request(
      joinUrl(baseUrl, '/v1/messages'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens ?? 1200,
          temperature: config.temperature ?? 0.3,
          ...(system ? { system } : {}),
          messages: messages
            .filter((message) => message.role !== 'system')
            .map(({ role, content }) => ({ role, content })),
          stream: true,
        }),
      },
      options.signal,
    )
    if (!response.ok) throw await transport.httpError(response)

    let completionChars = 0
    let promptTokens: number | null = null
    let completionTokens: number | null = null
    const applyEvent = (event: AnthropicEvent) => {
      if (typeof event.error?.message === 'string') {
        throw new ProviderError('provider', event.error.message)
      }
      if (event.type === 'message_start') {
        promptTokens = numberOrNull(event.message?.usage?.input_tokens)
      }
      if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
        completionChars += event.delta.text.length
        options.onDelta(event.delta.text)
      }
      if (event.type === 'message_delta') {
        completionTokens = numberOrNull(event.usage?.output_tokens)
      }
    }

    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      const payload = decodeJson<{ content?: { text?: unknown }[]; usage?: { input_tokens?: unknown; output_tokens?: unknown } }>(
        await response.text(),
        'Anthropic',
      )
      const text = (payload.content ?? [])
        .map((block) => (typeof block.text === 'string' ? block.text : ''))
        .join('')
      if (text) {
        completionChars = text.length
        options.onDelta(text)
      }
      promptTokens = numberOrNull(payload.usage?.input_tokens)
      completionTokens = numberOrNull(payload.usage?.output_tokens)
    } else {
      await readLines(response, (line) => {
        if (!line.startsWith('data:')) return
        try {
          applyEvent(JSON.parse(line.slice(5).trim()) as AnthropicEvent)
        } catch (error) {
          if (error instanceof ProviderError) throw error
        }
      })
    }
    return { completionChars, usage: { promptTokens, completionTokens } }
  },
}
