import { AiError, toAiError } from '../copilot/errors'
import { adapterForSettings } from '../copilot/providers'
import type { AiChatTurn, AiSettings } from '../copilot/types'
import { projectLanguage } from '../editor/projectLanguages'

export type ConversionOutcome = {
  raw: string
  code: string
  notes: string
  warnings: string[]
  /** The model used a fenced block. When false the raw text is shown as code. */
  fenced: boolean
  /** A fence opened but never closed, which usually means the reply was cut off. */
  unclosedFence: boolean
  /** The parser found no usable program (empty, comments only, or truncated). */
  incomplete: boolean
  /** True when the target runtime can be asked to execute the result. */
  executable: boolean
  targetLanguage: string
}

export type ConversionRequest = {
  settings: AiSettings
  sourceLanguage: string
  targetLanguage: string
  sourceCode: string
  instructions: string
  signal: AbortSignal
  onDelta: (chunk: string) => void
}

/**
 * A failed conversion that kept the text received so far. The UI can offer the
 * partial answer for review instead of discarding work the user already paid
 * for with tokens and time.
 */
export class ConversionFailure extends AiError {
  readonly partialRaw: string
  readonly partial: ConversionOutcome | null

  constructor(error: AiError, partialRaw: string, targetLanguage: string) {
    super(error.kind, error.message, {
      status: error.status ?? undefined,
      retryAfterSeconds: error.retryAfterSeconds ?? undefined,
      cause: error,
    })
    this.name = 'ConversionFailure'
    this.partialRaw = partialRaw
    this.partial =
      partialRaw.trim().length > 0 ? buildOutcome(partialRaw, targetLanguage) : null
  }
}

function languageLabel(id: string): string {
  return projectLanguage(id).label
}

const LANGUAGE_HINTS: Record<string, string[]> = {
  python: ['python', 'py'],
  javascript: ['javascript', 'js', 'node'],
  typescript: ['typescript', 'ts'],
  c: ['c', 'c99', 'c11'],
  cpp: ['cpp', 'c++', 'cxx'],
  java: ['java'],
  html: ['html'],
  css: ['css'],
  json: ['json'],
}

function hintFor(languageId: string): string[] {
  return LANGUAGE_HINTS[languageId] ?? [languageId]
}

function buildTurns(request: ConversionRequest): AiChatTurn[] {
  const source = languageLabel(request.sourceLanguage)
  const target = languageLabel(request.targetLanguage)
  const extra = request.instructions.trim()

  return [
    {
      role: 'system',
      content: [
        'You are a meticulous source-to-source translator inside a local coding laboratory.',
        `Translate the supplied ${source} program into complete, idiomatic ${target}.`,
        'Preserve the algorithm, observable input/output behaviour, edge-case handling and error behaviour wherever the target language permits it.',
        'Use the target language standard library only. Do not invent external dependencies.',
        'You may not verify the result by running it, so never claim semantic equivalence or guaranteed identical behaviour.',
        'If a construct has no exact equivalent, choose the closest safe equivalent and disclose the difference under Approximations.',
        '',
        'Output format — follow exactly:',
        `1. One fenced code block containing the complete ${target} program. No diff, no truncation, no commentary inside the fence.`,
        '2. Then a heading "### Notes" with 1–4 short bullets about the translation, including language-behaviour differences a learner should know.',
        '3. Then a heading "### Approximations" with short bullets for anything that cannot be translated exactly, or the single word "None identified" when nothing is approximate.',
        'Do not place any prose before the code block.',
        extra ? `Additional user instruction: ${extra}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    {
      role: 'user',
      content: `Source language: ${source}\nTarget language: ${target}\n\nSource code:\n\n${request.sourceCode}`,
    },
  ]
}

type Fence = {
  info: string
  body: string
  start: number
  end: number
  closed: boolean
}

/**
 * Finds every fenced block, plus a trailing unclosed fence. Models sometimes
 * write an example fence before the real answer and sometimes get cut off
 * mid-block; both cases must be distinguishable.
 */
function findFences(raw: string): Fence[] {
  const fences: Fence[] = []
  const closedPattern = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = closedPattern.exec(raw)) !== null) {
    fences.push({
      info: (match[1] ?? '').trim().toLowerCase(),
      body: match[2] ?? '',
      start: match.index,
      end: match.index + match[0].length,
      closed: true,
    })
  }

  const lastClosedEnd = fences.reduce((end, fence) => Math.max(end, fence.end), 0)
  const trailing = raw.slice(lastClosedEnd)
  const open = trailing.match(/```([^\r\n`]*)\r?\n([\s\S]*)$/)

  if (open) {
    fences.push({
      info: (open[1] ?? '').trim().toLowerCase(),
      body: open[2] ?? '',
      start: lastClosedEnd + (open.index ?? 0),
      end: raw.length,
      closed: false,
    })
  }

  return fences
}

function scoreFence(fence: Fence, languageId: string): number {
  const hints = hintFor(languageId)
  const info = fence.info
  let score = 0

  if (hints.some((hint) => info === hint || info.startsWith(`${hint} `))) {
    score += 1000
  } else if (hints.some((hint) => info.includes(hint))) {
    score += 500
  }
  if (fence.closed) {
    score += 100
  }
  // A real program is usually longer than a quoted example. Length is a
  // tie-breaker, never the only signal.
  score += Math.min(400, Math.floor(fence.body.length / 40))
  return score
}

function chooseFence(fences: Fence[], languageId: string): Fence | null {
  if (fences.length === 0) {
    return null
  }
  return fences.reduce((best, candidate) =>
    scoreFence(candidate, languageId) > scoreFence(best, languageId) ? candidate : best,
  )
}

function parseWarnings(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^none( identified)?\.?$/i.test(line) &&
        !/^n\/a\.?$/i.test(line),
    )
    .slice(0, 12)
}

function sectionAfter(text: string, headings: RegExp): string {
  const match = text.match(headings)
  return match?.[1]?.trim() ?? ''
}

const NOTES_HEADING =
  /###?\s*(?:Notes?|Explanation|Differences?|Translation notes)\s*\n([\s\S]*?)(?=\n###|\s*$)/i
const APPROX_HEADING =
  /###?\s*(?:Approximations?|Warnings?|Limitations?|Unsupported|Caveats?)\s*\n([\s\S]*?)(?=\n###|\s*$)/i

/** True when the text contains at least one token that is not a comment. */
function hasProgramContent(code: string): boolean {
  const withoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ')
    .replace(/#[^\r\n]*/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  return /[A-Za-z0-9_$@<>()[\]{}]/.test(withoutComments)
}

/**
 * Ignores strings and comments, then reports whether braces and brackets are
 * balanced. A mismatch is a strong signal that the reply was truncated.
 */
function hasBalancedDelimiters(code: string): boolean {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, '``')

  let braces = 0
  let brackets = 0
  let parens = 0

  for (const char of stripped) {
    if (char === '{') braces += 1
    else if (char === '}') braces -= 1
    else if (char === '[') brackets += 1
    else if (char === ']') brackets -= 1
    else if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    if (braces < 0 || brackets < 0 || parens < 0) {
      return false
    }
  }

  return braces === 0 && brackets === 0 && parens === 0
}

/**
 * Defensive parser. It picks the most plausible fenced block for the target
 * language, keeps notes and approximations, and discloses every ambiguity
 * instead of hiding it. It never invents code: when nothing usable is present
 * the result is marked incomplete and the caller must not offer it as a
 * finished translation.
 */
export function parseConversionResponse(
  raw: string,
  targetLanguageId = '',
): Omit<ConversionOutcome, 'raw' | 'executable' | 'targetLanguage'> {
  const fences = findFences(raw)
  const chosen = chooseFence(fences, targetLanguageId)

  let code: string
  let fenced = false
  let unclosedFence = false
  let tail = ''
  let before = ''

  if (chosen) {
    code = chosen.body.replace(/\s+$/, '')
    fenced = true
    unclosedFence = !chosen.closed
    tail = raw.slice(chosen.end).trim()
    before = raw.slice(0, chosen.start).trim()
  } else {
    code = raw.trim()
  }

  const notesSource = tail || before
  const notes = sectionAfter(notesSource, NOTES_HEADING) || notesSource
  const approximations = sectionAfter(notesSource, APPROX_HEADING)

  const warnings: string[] = []
  const incomplete = unclosedFence || !hasProgramContent(code)

  if (unclosedFence) {
    warnings.push(
      'The reply ended before the code fence closed, so the converted program may be incomplete.',
    )
  }
  if (!fenced) {
    warnings.push(
      'The model did not return a fenced code block. The raw reply is shown as code and should be reviewed carefully.',
    )
  }
  if (!code.trim()) {
    warnings.push('The model returned no code at all.')
  } else if (!hasProgramContent(code)) {
    warnings.push(
      'The returned block contains only comments or whitespace, so there is no program to review.',
    )
  } else if (
    code.length > 40 &&
    /[{}[\]()]/.test(code) &&
    !hasBalancedDelimiters(code)
  ) {
    warnings.push(
      'Braces or brackets are unbalanced outside strings and comments, which usually means the program was truncated.',
    )
  }
  if (notes === tail && tail && !sectionAfter(tail, NOTES_HEADING)) {
    warnings.push('The reply did not use the requested “### Notes” heading; the trailing text is shown as notes.')
  }

  warnings.push(...parseWarnings(approximations))

  return {
    code,
    notes,
    warnings: warnings.slice(0, 12),
    fenced,
    unclosedFence,
    incomplete,
  }
}

function buildOutcome(raw: string, targetLanguage: string): ConversionOutcome {
  const parsed = parseConversionResponse(raw, targetLanguage)
  const target = projectLanguage(targetLanguage)
  return {
    raw,
    ...parsed,
    executable: target.runtime !== null,
    targetLanguage,
  }
}

/**
 * Streams a real conversion through the selected adapter — the managed gateway
 * by default, or a direct provider in advanced mode. A provider failure keeps
 * the partial text and rethrows it as `ConversionFailure` so the UI can offer a
 * reviewable partial result. No placeholder conversion is ever produced.
 */
export async function convertCode(request: ConversionRequest): Promise<ConversionOutcome> {
  let raw = ''

  try {
    const adapter = adapterForSettings(request.settings)
    await adapter.stream({
      settings: request.settings,
      turns: buildTurns(request),
      signal: request.signal,
      onDelta: (chunk) => {
        raw += chunk
        request.onDelta(chunk)
      },
    })
  } catch (cause) {
    const error = cause instanceof AiError ? cause : toAiError(cause, request.settings.baseUrl)
    throw new ConversionFailure(error, raw, request.targetLanguage)
  }

  return buildOutcome(raw, request.targetLanguage)
}
