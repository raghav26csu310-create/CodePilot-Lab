import { ProviderError, type ProviderAdapter } from '../providerTypes.ts'
import { decodeJson, joinUrl, numberOrNull, readLines } from '../providerShared.ts'

type GeminiEvent = {
  candidates?: { content?: { parts?: { text?: unknown }[] } }[]
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown }
  error?: { message?: unknown }
}

export const geminiProviderAdapter: ProviderAdapter = {
  requiresApiKey: true,

  async listModels(baseUrl, config, transport, signal) {
    const response = await transport.request(
      joinUrl(baseUrl, '/models'),
      { method: 'GET', headers: { 'x-goog-api-key': config.apiKey } },
      signal,
    )
    if (!response.ok) throw await transport.httpError(response)
    const payload = decodeJson<{
      models?: { name?: unknown; supportedGenerationMethods?: unknown }[]
    }>(await response.text(), 'Google Gemini')
    return Array.isArray(payload.models)
      ? payload.models
          .filter(
            (entry) =>
              !Array.isArray(entry.supportedGenerationMethods) ||
              entry.supportedGenerationMethods.includes('streamGenerateContent') ||
              entry.supportedGenerationMethods.includes('generateContent'),
          )
          .map((entry) =>
            typeof entry.name === 'string' ? entry.name.replace(/^models\//, '') : '',
          )
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
      joinUrl(baseUrl, `/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({
              role: message.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: message.content }],
            })),
          generationConfig: {
            temperature: config.temperature ?? 0.3,
            maxOutputTokens: config.maxTokens ?? 1200,
          },
        }),
      },
      options.signal,
    )
    if (!response.ok) throw await transport.httpError(response)

    let completionChars = 0
    let promptTokens: number | null = null
    let completionTokens: number | null = null
    const applyEvent = (event: GeminiEvent) => {
      if (typeof event.error?.message === 'string') {
        throw new ProviderError('provider', event.error.message)
      }
      for (const part of event.candidates?.[0]?.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text) {
          completionChars += part.text.length
          options.onDelta(part.text)
        }
      }
      if (event.usageMetadata) {
        promptTokens = numberOrNull(event.usageMetadata.promptTokenCount)
        completionTokens = numberOrNull(event.usageMetadata.candidatesTokenCount)
      }
    }

    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      applyEvent(decodeJson<GeminiEvent>(await response.text(), 'Google Gemini'))
    } else {
      await readLines(response, (line) => {
        if (!line.startsWith('data:')) return
        try {
          applyEvent(JSON.parse(line.slice(5).trim()) as GeminiEvent)
        } catch (error) {
          if (error instanceof ProviderError) throw error
        }
      })
    }
    return { completionChars, usage: { promptTokens, completionTokens } }
  },
}
