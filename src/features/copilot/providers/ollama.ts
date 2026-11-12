import { AiError } from '../errors'
import type { AiSettings, ChatRequest, ProviderAdapter } from '../types'
import { consumeLines, httpError, joinUrl, withTimeout } from './http'

type OllamaTags = {
  models?: { name?: unknown }[]
}

type OllamaChunk = {
  message?: { content?: unknown }
  response?: unknown
  done?: boolean
  error?: unknown
}

function requireModel(settings: AiSettings): string {
  const model = settings.model.trim()
  if (!settings.baseUrl.trim()) {
    throw new AiError('invalid-settings', 'An Ollama base URL is required.')
  }
  if (!model) {
    throw new AiError('invalid-settings', 'Choose an Ollama model before sending.')
  }
  return model
}

async function listModels(settings: AiSettings, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(joinUrl(settings.baseUrl, '/api/tags'), {
    method: 'GET',
    signal: withTimeout(signal, 20000),
  })

  if (!response.ok) {
    throw await httpError(response)
  }

  let payload: OllamaTags
  try {
    payload = (await response.json()) as OllamaTags
  } catch {
    throw new AiError('provider', 'Ollama returned a response that was not valid JSON.')
  }

  const models = Array.isArray(payload.models)
    ? payload.models
        .map((entry) => (typeof entry.name === 'string' ? entry.name : ''))
        .filter((name) => name.length > 0)
    : []

  return models
}

export const ollamaProvider: ProviderAdapter = {
  id: 'ollama',
  label: 'Ollama',
  requiresKey: false,
  requiresSession: false,
  listModels,

  async stream(request: ChatRequest): Promise<void> {
    const model = requireModel(request.settings)
    const response = await fetch(joinUrl(request.settings.baseUrl, '/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: request.turns,
        stream: true,
        // Thinking models otherwise spend a long time on hidden reasoning.
        think: false,
        options: {
          temperature: request.settings.temperature,
          num_predict: request.settings.maxTokens,
        },
      }),
      signal: request.signal,
    })

    if (!response.ok) {
      throw await httpError(response)
    }

    await consumeLines(response, (line) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return
      }

      let chunk: OllamaChunk
      try {
        chunk = JSON.parse(trimmed) as OllamaChunk
      } catch {
        return
      }

      if (typeof chunk.error === 'string' && chunk.error) {
        throw new AiError('provider', chunk.error)
      }

      const content =
        typeof chunk.message?.content === 'string'
          ? chunk.message.content
          : typeof chunk.response === 'string'
            ? chunk.response
            : ''

      if (content) {
        request.onDelta(content)
      }
    })
  },
}
