import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from './db'
import { submitFeedback, validateFeedback, type FeedbackDraft } from './feedback'

function draft(overrides: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    category: 'bug',
    rating: 4,
    feature: 'lab',
    message: 'The tracer stopped after the second loop iteration.',
    contact: 'tester@example.test',
    page: '/lab',
    ...overrides,
  }
}

describe('validateFeedback', () => {
  it('requires an actionable message', () => {
    expect(validateFeedback(draft({ message: 'short' }))).toHaveProperty('message')
    expect(validateFeedback(draft({ message: 'x'.repeat(4_001) }))).toHaveProperty('message')
    expect(validateFeedback(draft())).toEqual({})
  })

  it('rejects ratings outside 1–5 and oversized contact fields', () => {
    expect(validateFeedback(draft({ rating: 9 }))).toHaveProperty('rating')
    expect(validateFeedback(draft({ contact: 'x'.repeat(201) }))).toHaveProperty('contact')
  })
})

describe('submitFeedback', () => {
  beforeEach(async () => {
    await db.feedback.clear()
    vi.stubEnv('VITE_FEEDBACK_ENDPOINT', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('always persists locally when no endpoint is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await submitFeedback(draft())
    expect(result.delivery).toBe('local')
    expect(fetchMock).not.toHaveBeenCalled()

    const stored = await db.feedback.get(result.record.id)
    expect(stored?.message).toContain('tracer stopped')
    expect(stored?.appVersion).toBe(__APP_VERSION__)
    expect(stored?.delivery).toBe('local')
  })

  it('records endpoint success without discarding the local copy', async () => {
    vi.stubEnv('VITE_FEEDBACK_ENDPOINT', 'https://feedback.example.test/collect')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await submitFeedback(draft())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.delivery).toBe('endpoint')
    expect(result.endpointStatus).toBe(202)

    const stored = await db.feedback.get(result.record.id)
    expect(stored?.delivery).toBe('endpoint')
    expect(stored?.endpointStatus).toBe(202)
  })

  it('records endpoint failure honestly and keeps the local submission', async () => {
    vi.stubEnv('VITE_FEEDBACK_ENDPOINT', 'https://feedback.example.test/collect')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network down')),
    )

    const result = await submitFeedback(draft())
    expect(result.delivery).toBe('endpoint-failed')
    expect(result.endpointError).toBeTruthy()

    const stored = await db.feedback.get(result.record.id)
    expect(stored).toBeTruthy()
    expect(stored?.delivery).toBe('endpoint-failed')
  })

  it('treats a non-2xx endpoint response as a delivery failure', async () => {
    vi.stubEnv('VITE_FEEDBACK_ENDPOINT', 'https://feedback.example.test/collect')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 500 })))

    const result = await submitFeedback(draft())
    expect(result.delivery).toBe('endpoint-failed')
    expect(result.endpointStatus).toBe(500)
  })
})
