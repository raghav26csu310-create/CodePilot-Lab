import { describe, expect, it } from 'vitest'

import { LIMITS, gradeSubmission, runCode, traceCode } from './executor.mjs'

const python = { language: 'python', code: 'print(1)' }

async function rejection(promise) {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

describe('executor request validation', () => {
  it('rejects unknown languages before spawning anything', async () => {
    const error = await rejection(runCode({ language: 'ruby', code: 'puts 1' }))
    expect(error?.statusCode).toBe(400)
    expect(error?.message).toMatch(/Language must be one of/)
  })

  it('rejects missing, empty and oversized source', async () => {
    expect((await rejection(runCode({ language: 'python', code: '' })))?.statusCode).toBe(400)
    expect(
      (await rejection(runCode({ language: 'python', code: 'x'.repeat(LIMITS.maxCodeChars + 1) })))
        ?.statusCode,
    ).toBe(400)
  })

  it('rejects non-string and oversized stdin', async () => {
    expect((await rejection(runCode({ ...python, stdin: 42 })))?.message).toMatch(/stdin/)
    expect(
      (await rejection(runCode({ ...python, stdin: 'x'.repeat(LIMITS.maxStdinChars + 1) })))?.message,
    ).toMatch(/stdin exceeds/)
  })

  it('caps the number of tests in one request', async () => {
    const tests = Array.from({ length: LIMITS.maxTests + 1 }, () => ({ stdin: '' }))
    expect((await rejection(runCode({ ...python, tests })))?.message).toMatch(/At most/)
  })

  it('applies the same stdin limit to tracing', async () => {
    expect(
      (await rejection(traceCode({ language: 'python', code: 'x=1', stdin: 'x'.repeat(LIMITS.maxStdinChars + 1) })))
        ?.message,
    ).toMatch(/stdin exceeds/)
  })

  it('refuses to invent tracer events for non-Python languages', async () => {
    const result = await traceCode({ language: 'javascript', code: 'let x = 1' })
    expect(result.status).toBe('unsupported')
    expect(result.events).toEqual([])
  })
})

describe('grading response shape', () => {
  it('rejects unknown problem ids with 404', async () => {
    const error = await rejection(
      gradeSubmission({ ...python, problemId: 'not-a-problem' }, {}),
    )
    expect(error?.statusCode).toBe(404)
  })

  it('never returns hidden inputs or expected outputs for an unsupported language', async () => {
    const suites = {
      demo: {
        supported: ['python'],
        tests: [
          { stdin: 'secret-input', expected: 'secret-output', hidden: true },
          { stdin: 'visible', expected: 'visible-output', hidden: false },
        ],
      },
    }

    const result = await gradeSubmission(
      { language: 'javascript', code: 'console.log(1)', problemId: 'demo' },
      suites,
    )

    expect(result.verdict).toBe('unsupported_language')
    expect(result.cases).toEqual([])
    expect(JSON.stringify(result)).not.toContain('secret-input')
    expect(JSON.stringify(result)).not.toContain('secret-output')
  })
})
