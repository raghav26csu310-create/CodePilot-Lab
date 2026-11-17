import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '../errors'
import { requestJson, streamGatewayChat } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gateway API client', () => {
  it('uses credentialed requests and rejects non-JSON success responses', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('include')
      return new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestJson('/api/health')).rejects.toMatchObject({
      name: 'GatewayError',
      code: 'invalid_response',
    })
  })

  it('classifies request timeouts separately from caller cancellation', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestJson('/api/health', { timeoutMs: 5 })).rejects.toMatchObject({
      name: 'AiError',
      kind: 'timeout',
    })

    const controller = new AbortController()
    const request = requestJson('/api/health', { signal: controller.signal, timeoutMs: 1_000 })
    controller.abort()
    await expect(request).rejects.toMatchObject({
      name: 'AiError',
      kind: 'aborted',
    } satisfies Partial<AiError>)
  })

  it('forwards the actual provider metadata and token usage from the SSE stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          [
            'data: {"type":"meta","mode":"byo","provider":"anthropic","model":"claude-test","label":"Primary"}',
            'data: {"type":"delta","text":"Hello"}',
            'data: {"type":"done","completionChars":5,"promptChars":10,"latencyMs":25,"estimatedTokens":3,"usage":{"promptTokens":2,"completionTokens":1,"estimatedTokens":3,"source":"provider"}}',
            '',
          ].join('\n\n'),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      ),
    )
    const metadata: unknown[] = []
    const usages: unknown[] = []
    let text = ''

    await streamGatewayChat({
      turns: [{ role: 'user', content: 'Say hello.' }],
      signal: new AbortController().signal,
      onDelta: (delta) => (text += delta),
      onMeta: (value) => metadata.push(value),
      onUsage: (value) => usages.push(value),
    })

    expect(text).toBe('Hello')
    expect(metadata).toEqual([
      { mode: 'byo', provider: 'anthropic', model: 'claude-test', label: 'Primary' },
    ])
    expect(usages).toEqual([
      { promptTokens: 2, completionTokens: 1, estimatedTokens: 3, source: 'provider' },
    ])
  })
})
