const KEY = 'codepilot.lab.drafts.v1'

type LabDrafts = Record<string, string>

function readAll(): LabDrafts {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const result: LabDrafts = {}
    for (const [language, code] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof code === 'string') {
        result[language] = code
      }
    }
    return result
  } catch {
    return {}
  }
}

export function readLabDraft(language: string): string | null {
  return readAll()[language] ?? null
}

export function writeLabDraft(language: string, code: string): void {
  try {
    const drafts = readAll()
    drafts[language] = code
    window.localStorage.setItem(KEY, JSON.stringify(drafts))
  } catch {
    // Drafts are a convenience; the editor still works without persistence.
  }
}

/** Used by the workspace Run panel to hand its live buffer to the Lab. */
export function stageLabDraft(language: string, code: string): void {
  writeLabDraft(language, code)
}
