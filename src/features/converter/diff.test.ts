import { describe, expect, it } from 'vitest'

import { diffLines } from './diff'
import { parseProposals, validateProposalPath } from '../copilot/proposals'

describe('diffLines', () => {
  it('reports identical input as unchanged rows', () => {
    const result = diffLines('a\nb', 'a\nb')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.rows.every((row) => row.kind === 'same')).toBe(true)
      expect(result.added).toBe(0)
      expect(result.removed).toBe(0)
    }
  })

  it('counts real added and removed lines', () => {
    const result = diffLines('a\nb\nc', 'a\nc\nd')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.removed).toBe(1)
      expect(result.added).toBe(1)
      expect(result.rows.some((row) => row.kind === 'remove' && row.text === 'b')).toBe(true)
      expect(result.rows.some((row) => row.kind === 'add' && row.text === 'd')).toBe(true)
    }
  })

  it('refuses to build an unbounded table for huge inputs', () => {
    const huge = Array.from({ length: 1500 }, (_, index) => `line ${index}`).join('\n')
    const result = diffLines(huge, huge)
    expect(result.status).toBe('too-large')
  })
})

describe('validateProposalPath', () => {
  it('accepts project-relative paths', () => {
    expect(validateProposalPath('src/main.py')).toBeNull()
    expect(validateProposalPath('README.md')).toBeNull()
  })

  it('rejects traversal, absolute paths, dot segments and empty segments', () => {
    expect(validateProposalPath('../escape.py')).toMatch(/escapes/)
    expect(validateProposalPath('/etc/passwd')).toMatch(/Absolute/)
    expect(validateProposalPath('src/./main.py')).toMatch(/dot segment|current directory/)
    expect(validateProposalPath('a//b.py')).toMatch(/empty segment/)
    expect(validateProposalPath('a\u0000b')).toMatch(/control/)
  })
})

describe('parseProposals', () => {
  const valid = [
    'Here is a change.',
    '```codepilot path="src/main.py" mode="replace" summary="Tidy main"',
    'print("hi")',
    '```',
    'Done.',
  ].join('\n')

  it('extracts a valid proposal and keeps surrounding prose', () => {
    const parsed = parseProposals(valid)
    expect(parsed.proposals).toHaveLength(1)
    expect(parsed.proposals[0]?.path).toBe('src/main.py')
    expect(parsed.proposals[0]?.mode).toBe('replace')
    expect(parsed.proposals[0]?.content).toBe('print("hi")')
    expect(parsed.proposals[0]?.invalidReason).toBeNull()
    expect(parsed.text).toContain('Here is a change.')
    expect(parsed.text).toContain('Done.')
    expect(parsed.text).not.toContain('codepilot')
  })

  it('marks traversal paths invalid instead of dropping them silently', () => {
    const parsed = parseProposals(
      ['```codepilot path="../../etc/passwd" mode="create"', 'x', '```'].join('\n'),
    )
    expect(parsed.proposals).toHaveLength(1)
    expect(parsed.proposals[0]?.invalidReason).toMatch(/escapes/)
  })

  it('marks unknown modes and empty bodies invalid', () => {
    const parsed = parseProposals(
      ['```codepilot path="a.py" mode="overwrite"', '', '```'].join('\n'),
    )
    expect(parsed.proposals[0]?.invalidReason).toBeTruthy()
    expect(parsed.proposals[0]?.mode).toBe('replace')
  })

  it('keeps escaped quotes in attribute values', () => {
    const parsed = parseProposals(
      ['```codepilot path="src/main.py" mode="replace" summary="Said \\"hello\\""', 'print(1)', '```'].join('\n'),
    )
    expect(parsed.proposals[0]?.summary).toBe('Said "hello"')
  })

  it('still surfaces an unterminated block', () => {
    const parsed = parseProposals(
      ['```codepilot path="src/a.py" mode="create"', 'print(1)'].join('\n'),
    )
    expect(parsed.proposals).toHaveLength(1)
    expect(parsed.proposals[0]?.content).toBe('print(1)')
  })
})
