import { AiError } from '../errors'
import type { AiSettings, ChatRequest, ProviderAdapter } from '../types'
import { authHeaders, consumeLines, httpError, joinUrl, withTimeout } from './http'

type ModelList = {
  data?: { id?: unknown }[]
}

type StreamChunk = {
  choices?: {
    delta?: { content?: unknown; reasoning_content?: unknown }
    message?: { content?: unknown }
    finish_reason?: unknown
  }[]
  error?: { message?: unknown } | string
}

function requireModel(settings: AiSettings): string {
  const model = settings.model.trim()
  if (!settings.baseUrl.trim()) {
    throw new AiError('invalid-settings', 'An OpenAI-compatible base URL is required.')
  }
  if (!model) {
    throw new AiError('invalid-settings', 'Choose a model before sending.')
  }
  return model
}

async function listModels(settings: AiSettings, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(joinUrl(settings.baseUrl, '/models'), {
    method: 'GET',
    headers: authHeaders(settings.apiKey),
    signal: withTimeout(signal, 20000),
  })

  if (!response.ok) {
    throw await httpError(response)
  }

  let payload: ModelList
  try {
    payload = (await response.json()) as ModelList
  } catch {
    throw new AiError('provider', 'The provider returned a model list that was not valid JSON.')
  }

  return Array.isArray(payload.data)
    ? payload.data
        .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
        .filter((id) => id.length > 0)
        .sort((a, b) => a.localeCompare(b))
    : []
}

function chunkText(chunk: StreamChunk): string {
  if (typeof chunk.error === 'string' && chunk.error) {
    throw new AiError('provider', chunk.error)
  }
  if (chunk.error && typeof chunk.error === 'object' && typeof chunk.error.message === 'string') {
    throw new AiError('provider', chunk.error.message)
  }

  const choice = chunk.choices?.[0]
  if (!choice) {
    return ''
  }

  const delta = choice.delta ?? choice.message
  if (!delta) {
    return ''
  }

  // `reasoning_content` (DeepSeek-style hidden reasoning) is deliberately not
  // surfaced as answer text; only the visible `content` stream is rendered.
  return typeof delta.content === 'string' ? delta.content : ''
}

export const openAiCompatibleProvider: ProviderAdapter = {
  id: 'openai-compatible',
  label: 'OpenAI-compatible',
  requiresKey: false,
  listModels,

  async stream(request: ChatRequest): Promise<void> {
    const model = requireModel(request.settings)
    const response = await fetch(joinUrl(request.settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(request.settings.apiKey),
      },
      body: JSON.stringify({
        model,
        messages: request.turns,
        stream: true,
        temperature: request.settings.temperature,
        max_tokens: request.settings.maxTokens,
      }),
      signal: request.signal,
    })

    if (!response.ok) {
      throw await httpError(response)
    }

    const contentType = response.headers.get('content-type') ?? ''

    // Some compatible servers ignore `stream: true` and answer with one JSON body.
    if (contentType.includes('application/json')) {
      let payload: StreamChunk
      try {
        payload = (await response.json()) as StreamChunk
      } catch {
        throw new AiError('provider', 'The provider returned a response that was not valid JSON.')
      }
      const text = chunkText(payload)
      if (text) {
        request.onDelta(text)
      }
      return
    }

    await consumeLines(response, (line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(':')) {
        return
      }

      const payload = trimmed.startsWith('data:')
        ? trimmed.slice(5).trim()
        : trimmed

      if (!payload) {
        return
      }

      if (payload === '[DONE]') {
        return
      }

      let chunk: StreamChunk
      try {
        chunk = JSON.parse(payload) as StreamChunk
      } catch {
        // Keep-alive text or a provider-specific non-JSON line.
        return
      }

      const text = chunkText(chunk)
      if (text) {
        request.onDelta(text)
      }
    })
  },
}
