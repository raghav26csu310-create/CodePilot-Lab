const KEY = 'codepilot.convert.source.v1'

export type StagedConversionSource = {
  projectId: string
  path: string
  code: string
  /** Project language id, e.g. "python". */
  language: string
  createdAt: number
}

/**
 * The workspace cannot hand a live Monaco buffer to another route through
 * props, so it stages the exact current text here. The converter consumes and
 * removes it, and labels the origin truthfully.
 */
export function stageConversionSource(source: Omit<StagedConversionSource, 'createdAt'>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...source, createdAt: Date.now() }))
  } catch {
    // The converter is still usable with pasted code.
  }
}

export function consumeStagedConversionSource(): StagedConversionSource | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      return null
    }
    window.localStorage.removeItem(KEY)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const candidate = parsed as Partial<StagedConversionSource>
    if (
      typeof candidate.projectId !== 'string' ||
      typeof candidate.path !== 'string' ||
      typeof candidate.code !== 'string' ||
      typeof candidate.language !== 'string'
    ) {
      return null
    }
    return {
      projectId: candidate.projectId,
      path: candidate.path,
      code: candidate.code,
      language: candidate.language,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
    }
  } catch {
    return null
  }
}
