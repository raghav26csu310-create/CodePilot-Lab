import { describe, expect, it } from 'vitest'

import { buildSystemPrompt, buildUserPrompt, CAPABILITIES, capabilityMeta } from './prompts'
import type { ContextBundle } from './types'

function emptyContext(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    files: [],
    omitted: [],
    tree: [],
    treeTruncated: false,
    diagnostics: [],
    selection: null,
    totalChars: 0,
    selectionChars: 0,
    ...overrides,
  }
}

const base = {
  level: 'intermediate' as const,
  projectName: 'Audit Fixture',
  projectLanguage: 'typescript',
  context: emptyContext(),
}

describe('copilot capabilities', () => {
  it('exposes one unique, labelled entry per capability id', () => {
    const ids = CAPABILITIES.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('refactor')
    for (const entry of CAPABILITIES) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.placeholder.length).toBeGreaterThan(0)
      expect(capabilityMeta(entry.id).id).toBe(entry.id)
    }
  })

  it('writes refactor guidance that protects observable behaviour', () => {
    const prompt = buildSystemPrompt({ ...base, capability: 'refactor' })
    expect(prompt).toContain('Task mode: Refactor')
    expect(prompt).toContain('without changing observable behaviour')
    expect(prompt).toContain('public interface')
    expect(prompt).toContain('Never claim to have run code')
  })

  it('defaults the refactor request to the selection when one is attached', () => {
    const withSelection = buildUserPrompt({
      ...base,
      capability: 'refactor',
      userText: '',
      context: emptyContext({
        selection: {
          path: 'src/main.ts',
          text: 'const a = 1',
          startLine: 1,
          endLine: 1,
          startColumn: 1,
          endColumn: 12,
          truncated: false,
        },
      }),
    })
    expect(withSelection).toBe('Refactor the selected code without changing its behaviour.')

    const withoutSelection = buildUserPrompt({
      ...base,
      capability: 'refactor',
      userText: '',
    })
    expect(withoutSelection).toBe('Refactor the shared file without changing its behaviour.')
  })

  it('keeps an explicit user instruction instead of the default', () => {
    const prompt = buildUserPrompt({
      ...base,
      capability: 'refactor',
      userText: '  extract a helper for the parser  ',
    })
    expect(prompt).toBe('extract a helper for the parser')
  })

  it('never claims the model executed anything', () => {
    for (const entry of CAPABILITIES) {
      const prompt = buildSystemPrompt({ ...base, capability: entry.id })
      expect(prompt).toContain('cannot execute anything here')
      expect(prompt).toContain('The user applies every change manually')
    }
  })
})
