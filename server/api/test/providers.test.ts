import { describe, expect, it, vi } from 'vitest'

import {
  ProviderClient,
  ProviderError,
  type ProviderConfig,
  type ProviderUsage,
} from '../src/ai/providers.ts'

function config(provider: ProviderConfig['provider'], overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider,
    baseUrl:
      provider === 'anthropic'
        ? 'https://api.anthropic.com'
        : provider === 'gemini'
          ? 'https://generativelanguage.googleapis.com/v1beta'
          : provider === 'ollama'
            ? 'http://127.0.0.1:11434'
            : 'https://provider.example/v1',
    apiKey: provider === 'ollama' ? '' : 'test-provider-secret',
    model: 'test-model',
    ...overrides,
  }
}

function eventStream(lines: string[]): Response {
  return new Response(`${lines.map((line) => `data: ${line}\n\n`).join('')}`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function client(fetchImpl: typeof fetch): ProviderClient {
  return new ProviderClient({
    fetchImpl,
    allowPrivateEndpoints: true,
    timeoutMs: 1_000,
  })
}

async function collect(
  provider: ProviderConfig['provider'],
  fetchImpl: typeof fetch,
): Promise<{ text: string; usage: ProviderUsage }> {
  let text = ''
  const result = await client(fetchImpl).streamChat(
    config(provider),
    [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Continue the conversation.' },
      { role: 'assistant', content: 'Earlier answer.' },
      { role: 'user', content: 'Say hello.' },
    ],
    {
      signal: new AbortController().signal,
      onDelta: (delta) => {
        text += delta
      },
    },
  )
  return { text, usage: result.usage }
}

describe('provider adapters', () => {
  it('uses OpenAI chat completions and reports streaming usage', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/models')) {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-provider-secret')
        return Response.json({ data: [{ id: 'gpt-test' }] })
      }
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[]
        stream: boolean
      }
      expect(body.messages).toHaveLength(2)
      expect(body.stream).toBe(true)
      return eventStream([
        '{"choices":[{"delta":{"content":"Hello"}}]}',
        '{"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}',
        '[DONE]',
      ])
    })
    const adapter = client(fetchMock)

    await expect(adapter.listModels(config('openai'))).resolves.toEqual(['gpt-test'])
    let text = ''
    const result = await adapter.streamChat(
      config('openai'),
      [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Say hello.' },
      ],
      { signal: new AbortController().signal, onDelta: (delta) => (text += delta) },
    )
    expect(text).toBe('Hello!')
    expect(result.usage).toEqual({ promptTokens: 4, completionTokens: 2 })
  })

  it('uses Anthropic headers, system instructions, event deltas and usage', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      expect(new Headers(init?.headers).get('x-api-key')).toBe('test-provider-secret')
      expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01')
      if (url.includes('/v1/models')) {
        return Response.json({ data: [{ id: 'claude-test' }] })
      }
      const body = JSON.parse(String(init?.body)) as {
        system: string
        messages: { role: string; content: string }[]
      }
      expect(body.system).toBe('Be concise.')
      expect(body.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
      return eventStream([
        '{"type":"message_start","message":{"usage":{"input_tokens":3}}}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        '{"type":"message_delta","usage":{"output_tokens":2}}',
      ])
    })
    const adapter = client(fetchMock)

    await expect(adapter.listModels(config('anthropic'))).resolves.toEqual(['claude-test'])
    const result = await collect('anthropic', fetchMock)
    expect(result.text).toBe('Hello')
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 2 })
  })

  it('uses Gemini API-key headers and parses generated content and usage', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      expect(url).not.toContain('test-provider-secret')
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-provider-secret')
      if (url.endsWith('/models')) {
        return Response.json({
          models: [
            {
              name: 'models/gemini-test',
              supportedGenerationMethods: ['streamGenerateContent'],
            },
            { name: 'models/embedding-test', supportedGenerationMethods: ['embedContent'] },
          ],
        })
      }
      expect(url).toContain('/models/test-model:streamGenerateContent?alt=sse')
      return eventStream([
        '{"candidates":[{"content":{"parts":[{"text":"Gemini"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1}}',
      ])
    })
    const adapter = client(fetchMock)

    await expect(adapter.listModels(config('gemini'))).resolves.toEqual(['gemini-test'])
    const result = await collect('gemini', fetchMock)
    expect(result.text).toBe('Gemini')
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 1 })
  })

  it('uses Ollama tags and streams NDJSON without assuming the server is available', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'qwen-test:8b' }] })
      }
      return new Response(
        '{"message":{"content":"Local"}}\n{"prompt_eval_count":3,"eval_count":1,"done":true}\n',
        { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
      )
    })
    const adapter = client(fetchMock)

    await expect(adapter.listModels(config('ollama'))).resolves.toEqual(['qwen-test:8b'])
    let text = ''
    const result = await adapter.streamChat(
      config('ollama', { model: 'qwen-test:8b' }),
      [{ role: 'user', content: 'Say hello.' }],
      { signal: new AbortController().signal, onDelta: (delta) => (text += delta) },
    )
    expect(text).toBe('Local')
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 1 })
  })

  it('shares the OpenAI-compatible protocol for DeepSeek and custom endpoints', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'custom-model' }] }))
    const adapter = client(fetchMock)
    await expect(adapter.listModels(config('deepseek'))).resolves.toEqual(['custom-model'])
    await expect(
      adapter.listModels(config('openai-compatible', { apiKey: '' })),
    ).resolves.toEqual(['custom-model'])
  })

  it.each(['openai', 'anthropic', 'gemini', 'deepseek'] as const)(
    'rejects missing credentials for %s before making a request',
    async (provider) => {
      const fetchMock = vi.fn()
      await expect(client(fetchMock).listModels(config(provider, { apiKey: '' }))).rejects.toMatchObject({
        code: 'invalid-settings',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('classifies invalid credentials, downtime, and network failures', async () => {
    const unauthorized = client(async () =>
      new Response('invalid key', { status: 401, statusText: 'Unauthorized' }),
    )
    await expect(unauthorized.listModels(config('anthropic'))).rejects.toMatchObject({
      code: 'auth',
    })

    const down = client(async () => new Response('unavailable', { status: 503 }))
    await expect(down.listModels(config('ollama'))).rejects.toMatchObject({
      code: 'provider',
      status: 503,
    })

    const incorrectModel = client(async () =>
      new Response('model not found', { status: 404 }),
    )
    await expect(
      incorrectModel.streamChat(
        config('openai', { model: 'missing-model' }),
        [{ role: 'user', content: 'Hello.' }],
        { signal: new AbortController().signal, onDelta: () => undefined },
      ),
    ).rejects.toMatchObject({ code: 'not-found', status: 404 })

    const offline = client(async () => {
      throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } })
    })
    await expect(offline.listModels(config('openai'))).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('honors provider request cancellation and deadlines', async () => {
    const fetchMock: typeof fetch = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Timed out', 'TimeoutError')),
          { once: true },
        )
      })
    const timed = new ProviderClient({
      fetchImpl: fetchMock,
      allowPrivateEndpoints: true,
      timeoutMs: 1,
    })
    await expect(timed.listModels(config('openai'))).rejects.toMatchObject({
      code: 'timeout',
    } satisfies Partial<ProviderError>)
  })
})
