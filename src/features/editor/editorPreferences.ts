export type EditorThemeId = 'midnight' | 'graphite'

export type EditorPreferences = {
  fontSize: number
  minimap: boolean
  wordWrap: boolean
  theme: EditorThemeId
  /** Runs Prettier before writing the file. */
  formatOnSave: boolean
  /** Default formatter for supported files. */
  formatter: 'prettier'
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontSize: 13,
  minimap: true,
  wordWrap: false,
  theme: 'midnight',
  formatOnSave: false,
  formatter: 'prettier',
}

const STORAGE_KEY = 'codepilot.workspace.editor.v1'
const MIN_FONT_SIZE = 11
const MAX_FONT_SIZE = 22

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_EDITOR_PREFERENCES.fontSize
  }
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
}

export function readEditorPreferences(): EditorPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_EDITOR_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_EDITOR_PREFERENCES
    }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_EDITOR_PREFERENCES
    }

    const candidate = parsed as Partial<EditorPreferences>
    return {
      fontSize:
        typeof candidate.fontSize === 'number'
          ? clampFontSize(candidate.fontSize)
          : DEFAULT_EDITOR_PREFERENCES.fontSize,
      minimap:
        typeof candidate.minimap === 'boolean'
          ? candidate.minimap
          : DEFAULT_EDITOR_PREFERENCES.minimap,
      wordWrap:
        typeof candidate.wordWrap === 'boolean'
          ? candidate.wordWrap
          : DEFAULT_EDITOR_PREFERENCES.wordWrap,
      theme:
        candidate.theme === 'graphite' || candidate.theme === 'midnight'
          ? candidate.theme
          : DEFAULT_EDITOR_PREFERENCES.theme,
      formatOnSave:
        typeof candidate.formatOnSave === 'boolean'
          ? candidate.formatOnSave
          : DEFAULT_EDITOR_PREFERENCES.formatOnSave,
      formatter: 'prettier',
    }
  } catch {
    return DEFAULT_EDITOR_PREFERENCES
  }
}

export function writeEditorPreferences(preferences: EditorPreferences): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Editor preferences are small cosmetics; a blocked localStorage should not
    // take down the workspace or pretend the setting persisted.
  }
}
