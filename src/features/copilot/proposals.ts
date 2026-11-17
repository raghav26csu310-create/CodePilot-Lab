import { normalizeStoredPath, validateStoredPath } from '../../lib/storedPaths'
import type { CodeProposal } from './types'

export type ParsedProposal = Omit<CodeProposal, 'id' | 'messageId'>

export type ParsedMessage = {
  /** Message text with the proposal blocks removed. */
  text: string
  proposals: ParsedProposal[]
}

const OPEN_FENCE = /^(`{3,})codepilot\b(.*)$/i
const ATTRIBUTE = /([a-zA-Z][\w-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s]+))/g

function decodeAttributeValue(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\(["'\\])/g, '$1')
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const key = match[1]?.toLocaleLowerCase()
    const value = decodeAttributeValue(match[2] ?? match[3] ?? match[4] ?? '')
    if (key) {
      attributes[key] = value
    }
  }
  return attributes
}

/** Returns a reason when a model-supplied path is unsafe or unusable. */
export function validateProposalPath(path: string): string | null {
  const value = path.trim()
  if (!value) {
    return 'The proposal has no file path.'
  }

  const problem = validateStoredPath(value)
  if (!problem) {
    return null
  }

  if (problem.includes('Absolute paths are not allowed')) {
    return 'Absolute paths are not allowed; use a path relative to the project root.'
  }
  if (problem.includes('empty, "." or ".."')) {
    if (value.includes('//') || value.startsWith('/') || value.endsWith('/')) {
      return 'The proposal path has an empty segment.'
    }
    if (value.includes('..')) {
      return 'The proposal path escapes the project root.'
    }
    return 'The proposal path contains a dot segment that resolves to the current directory.'
  }
  if (problem.includes('control characters')) {
    return 'The proposal path contains control characters.'
  }
  if (problem.includes('empty')) {
    return 'The proposal path has an empty segment.'
  }

  return problem
}

export function normalizeProposalPath(path: string): string {
  return normalizeStoredPath(path)
}

function readFence(lines: string[], start: number): { end: number; body: string[] } | null {
  const opening = lines[start] ?? ''
  const match = OPEN_FENCE.exec(opening)
  if (!match) {
    return null
  }

  const fence = match[1] ?? '```'
  const close = new RegExp(`^${fence[0]}{${fence.length},}\\s*$`)
  const body: string[] = []

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (close.test(line.trim())) {
      return { end: index, body }
    }
    body.push(line)
  }

  // An unterminated block is still surfaced; the caller marks it untrusted.
  return { end: lines.length - 1, body }
}

/**
 * Extracts proposal blocks from a streamed answer. The parser is defensive:
 * malformed headers produce a proposal marked with `invalidReason` rather than
 * disappearing, so the UI can explain why nothing is applicable.
 */
export function parseProposals(raw: string): ParsedMessage {
  const lines = raw.split(/\r?\n/)
  const proposals: ParsedProposal[] = []
  const kept: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const opening = OPEN_FENCE.exec(line)

    if (!opening) {
      kept.push(line)
      index += 1
      continue
    }

    const block = readFence(lines, index)
    if (!block) {
      kept.push(line)
      index += 1
      continue
    }

    const attributes = parseAttributes(opening[2] ?? '')
    const path = normalizeProposalPath(attributes.path ?? '')
    const modeRaw = (attributes.mode ?? 'replace').toLocaleLowerCase()
    const mode = modeRaw === 'create' ? 'create' : 'replace'
    const summary = (attributes.summary ?? '').trim()
    const content = block.body.join('\n')

    let invalidReason = validateProposalPath(path)
    if (!invalidReason && content.trim().length === 0) {
      invalidReason = 'The proposal block is empty.'
    }
    if (!invalidReason && modeRaw !== 'replace' && modeRaw !== 'create') {
      invalidReason = `Unknown mode "${modeRaw}"; expected replace or create.`
    }

    proposals.push({
      path: path || attributes.path || '(missing path)',
      mode,
      summary,
      content,
      language: path.slice(path.lastIndexOf('.') + 1) || 'text',
      invalidReason,
    })

    // Keep a single blank line where the block was, so prose stays readable.
    if (kept.length > 0 && (kept[kept.length - 1] ?? '').trim().length > 0) {
      kept.push('')
    }
    index = block.end + 1
  }

  const text = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { text, proposals }
}

export function attachProposalIds(
  messageId: string,
  proposals: ParsedProposal[],
): CodeProposal[] {
  return proposals.map((proposal, index) => ({
    ...proposal,
    id: `${messageId}:${index}`,
    messageId,
  }))
}
