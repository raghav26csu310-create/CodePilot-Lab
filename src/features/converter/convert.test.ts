import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_AI_SETTINGS } from '../copilot/providerPresets'
import { ConversionFailure, convertCode, parseConversionResponse } from './convert'

describe('parseConversionResponse', () => {
  it('extracts a fenced program, notes and approximations', () => {
    const raw = [
      '```javascript',
      'function add(a, b) {',
      '  return a + b',
      '}',
      '```',
      '',
      '### Notes',
      '- JavaScript numbers are doubles, so integer overflow differs.',
      '',
      '### Approximations',
      '- None identified',
    ].join('\n')

    const parsed = parseConversionResponse(raw, 'javascript')
    expect(parsed.code).toContain('function add')
    expect(parsed.fenced).toBe(true)
    expect(parsed.unclosedFence).toBe(false)
    expect(parsed.incomplete).toBe(false)
    expect(parsed.notes).toContain('JavaScript numbers are doubles')
    expect(parsed.warnings).toEqual([])
  })

  it('prefers the fence tagged for the target language over an earlier example', () => {
    const raw = [
      'For example, the original looks like this:',
      '```python',
      'print("source")',
      '```',
      'And here is the translation:',
      '```javascript',
      'const values = [1, 2, 3]',
      'console.log(values)',
      '```',
    ].join('\n')

    const parsed = parseConversionResponse(raw, 'javascript')
    expect(parsed.code).toContain('const values')
    expect(parsed.code).not.toContain('print("source")')
  })

  it('picks the longest block when no fence is tagged', () => {
    const raw = [
      '```',
      'x = 1',
      '```',
      '```',
      'def main():',
      '    total = 0',
      '    for value in range(4):',
      '        total += value',
      '    return total',
      '```',
    ].join('\n')

    const parsed = parseConversionResponse(raw, 'python')
    expect(parsed.code).toContain('def main')
  })

  it('flags an unclosed fence as incomplete and keeps the partial code', () => {
    const raw = ['```javascript', 'function half(a) {', '  return a / 2'].join('\n')

    const parsed = parseConversionResponse(raw, 'javascript')
    expect(parsed.unclosedFence).toBe(true)
    expect(parsed.incomplete).toBe(true)
    expect(parsed.code).toContain('function half')
    expect(parsed.warnings.join(' ')).toContain('ended before the code fence closed')
  })

  it('marks an empty fenced block as incomplete', () => {
    const raw = ['```javascript', '', '```', '### Notes', '- nothing'].join('\n')

    const parsed = parseConversionResponse(raw, 'javascript')
    expect(parsed.code).toBe('')
    expect(parsed.incomplete).toBe(true)
    expect(parsed.warnings.join(' ')).toContain('returned no code')
  })

  it('marks a comments-only block as incomplete', () => {
    const raw = ['```javascript', '// TODO: translate this', '```'].join('\n')

    const parsed = parseConversionResponse(raw, 'javascript')
    expect(parsed.incomplete).toBe(true)
    expect(parsed.warnings.join(' ')).toContain('only comments or whitespace')
  })

  it('discloses a reply without any fence', () => {
    const raw = 'print("hello")\n\n### Notes\n- Plain text reply.'

    const parsed = parseConversionResponse(raw, 'python')
    expect(parsed.fenced).toBe(false)
    expect(parsed.code).toContain('print("hello")')
    expect(parsed.warnings.join(' ')).toContain('did not return a fenced code block')
  })

  it('warns about unbalanced braces outside strings', () => {
    const raw = [
      '```javascript',
      'function broken(a) {',
      '  if (a > 0) {',
      '    return "ok"',
      '}',
      '```',
    ].join('\n')

    const parsed = parseConversionResponse(raw, 'javascript')
    expect(parsed.incomplete).toBe(false)
    expect(parsed.warnings.join(' ')).toContain('unbalanced')
  })

  it('does not treat braces inside strings as unbalanced', () => {
    const raw = [
      '```javascript',
      'const template = "a { b }"',
      'const values = [1, 2, 3]',
      '```',
    ].join('\n')

    const parsed = parseConversionResponse(raw, 'javascript')
    expect(parsed.warnings.join(' ')).not.toContain('unbalanced')
  })

  it('reads prose before the fence as notes only when there is no trailing section', () => {
    const raw = [
      '### Notes',
      '- Translated using the standard library.',
      '### Approximations',
      '- None identified',
      '',
      '```python',
      'def main():',
      '    return 0',
      '```',
    ].join('\n')

    const parsed = parseConversionResponse(raw, 'python')
    expect(parsed.code).toContain('def main')
    expect(parsed.notes).toContain('standard library')
  })

  it('caps warning lists instead of echoing an unbounded reply', () => {
    const bullets = Array.from({ length: 40 }, (_, index) => `- warning ${index}`)
    const raw = ['```', 'x = 1', '```', '### Approximations', ...bullets].join('\n')

    const parsed = parseConversionResponse(raw, 'python')
    expect(parsed.warnings.length).toBeLessThanOrEqual(12)
  })
})

function sseResponse(events: unknown[]): Response {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`: connected\n\n${text}`))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  })
}

const GATEWAY_SETTINGS = {
  ...DEFAULT_AI_SETTINGS,
  preset: 'codepilot' as const,
  provider: 'gateway' as const,
}

function request(overrides: Partial<Parameters<typeof convertCode>[0]> = {}) {
  return {
    settings: GATEWAY_SETTINGS,
    sourceLanguage: 'python',
    targetLanguage: 'javascript',
    sourceCode: 'print("hello")',
    instructions: '',
    signal: new AbortController().signal,
    onDelta: () => {},
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('convertCode through the managed gateway', () => {
  it('returns the parsed program from streamed SSE events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'meta', mode: 'managed', provider: 'openai-compatible', model: 'm', label: 'CodePilot AI' },
          { type: 'delta', text: '```javascript\n' },
          { type: 'delta', text: 'console.log("hello")\n' },
          { type: 'delta', text: '```\n### Notes\n- Same output.\n' },
          { type: 'done', completionChars: 30, promptChars: 10, latencyMs: 12, estimatedTokens: 10 },
        ]),
      ),
    )

    const outcome = await convertCode(request())
    expect(outcome.code).toBe('console.log("hello")')
    expect(outcome.notes).toContain('Same output.')
    expect(outcome.incomplete).toBe(false)
    expect(outcome.executable).toBe(true)
  })

  it('keeps partial output when the gateway reports a provider failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'meta', mode: 'managed', provider: 'openai-compatible', model: 'm', label: 'CodePilot AI' },
          { type: 'delta', text: '```javascript\nconst half = (a) => a / 2\n' },
          { type: 'error', code: 'provider', message: 'The provider disconnected.' },
        ]),
      ),
    )

    await expect(convertCode(request())).rejects.toBeInstanceOf(ConversionFailure)

    try {
      await convertCode(request())
    } catch (error) {
      expect(error).toBeInstanceOf(ConversionFailure)
      const failure = error as ConversionFailure
      expect(failure.message).toContain('disconnected')
      expect(failure.partialRaw).toContain('const half')
      expect(failure.partial?.code).toContain('const half')
    }
  })

  it('fails rather than inventing a result when the stream never completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'meta', mode: 'managed', provider: 'openai-compatible', model: 'm', label: 'CodePilot AI' },
          { type: 'delta', text: '```javascript\nconst x = 1' },
        ]),
      ),
    )

    await expect(convertCode(request())).rejects.toBeInstanceOf(ConversionFailure)
  })
})
