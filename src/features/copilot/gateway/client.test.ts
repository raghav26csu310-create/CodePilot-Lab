import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '../errors'
import { requestJson } from './client'

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
})
