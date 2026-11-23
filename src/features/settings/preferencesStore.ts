import { useSyncExternalStore } from 'react'
import { db } from '../../lib/db'

export type EditorPreferences = {
  fontFamily: string
  fontSize: number
  tabSize: number
  wordWrap: 'on' | 'off'
  minimap: boolean
  lineNumbers: 'on' | 'off'
  formatOnSave: boolean
  cursorBlinking: 'blink' | 'smooth' | 'solid'
}

export type TerminalPreferences = {
  defaultShell: 'powershell.exe' | 'cmd.exe'
  fontSize: number
  scrollback: number
  cursorBlink: boolean
}

export type AppearancePreferences = {
  theme: 'midnight' | 'graphite' | 'carbon'
  density: 'comfortable' | 'compact'
}

export type GeneralPreferences = {
  autoSaveDelayMs: number
  confirmOnDelete: boolean
}

export type UserPreferences = {
  editor: EditorPreferences
  terminal: TerminalPreferences
  appearance: AppearancePreferences
  general: GeneralPreferences
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  editor: {
    fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
    fontSize: 14,
    tabSize: 2,
    wordWrap: 'on',
    minimap: true,
    lineNumbers: 'on',
    formatOnSave: true,
    cursorBlinking: 'smooth',
  },
  terminal: {
    defaultShell: 'powershell.exe',
    fontSize: 13,
    scrollback: 5000,
    cursorBlink: true,
  },
  appearance: {
    theme: 'midnight',
    density: 'comfortable',
  },
  general: {
    autoSaveDelayMs: 1500,
    confirmOnDelete: true,
  },
}

const STORAGE_KEY = 'codepilot.preferences.v1'

let currentPreferences: UserPreferences = DEFAULT_PREFERENCES
let isLoaded = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPreferencesSnapshot(): UserPreferences {
  return currentPreferences
}

export function useUserPreferences(): UserPreferences {
  return useSyncExternalStore(subscribePreferences, getPreferencesSnapshot, getPreferencesSnapshot)
}

/** Initializer that loads preferences from Dexie (and localStorage fallback). */
export async function initPreferences(): Promise<UserPreferences> {
  if (isLoaded) return currentPreferences

  try {
    const record = await db.settings.get(STORAGE_KEY)
    if (record?.value) {
      const parsed = JSON.parse(record.value) as Partial<UserPreferences>
      currentPreferences = {
        editor: { ...DEFAULT_PREFERENCES.editor, ...parsed.editor },
        terminal: { ...DEFAULT_PREFERENCES.terminal, ...parsed.terminal },
        appearance: { ...DEFAULT_PREFERENCES.appearance, ...parsed.appearance },
        general: { ...DEFAULT_PREFERENCES.general, ...parsed.general },
      }
    } else if (typeof localStorage !== 'undefined') {
      const local = localStorage.getItem(STORAGE_KEY)
      if (local) {
        const parsed = JSON.parse(local) as Partial<UserPreferences>
        currentPreferences = {
          editor: { ...DEFAULT_PREFERENCES.editor, ...parsed.editor },
          terminal: { ...DEFAULT_PREFERENCES.terminal, ...parsed.terminal },
          appearance: { ...DEFAULT_PREFERENCES.appearance, ...parsed.appearance },
          general: { ...DEFAULT_PREFERENCES.general, ...parsed.general },
        }
      }
    }
  } catch {
    // Keep defaults on error
  }

  isLoaded = true
  emit()
  return currentPreferences
}

// Auto-run init on module load
if (typeof window !== 'undefined') {
  void initPreferences()
}

export async function updatePreferences(
  patch: Partial<{
    editor: Partial<EditorPreferences>
    terminal: Partial<TerminalPreferences>
    appearance: Partial<AppearancePreferences>
    general: Partial<GeneralPreferences>
  }>,
): Promise<UserPreferences> {
  currentPreferences = {
    editor: { ...currentPreferences.editor, ...patch.editor },
    terminal: { ...currentPreferences.terminal, ...patch.terminal },
    appearance: { ...currentPreferences.appearance, ...patch.appearance },
    general: { ...currentPreferences.general, ...patch.general },
  }

  emit()

  try {
    const serialized = JSON.stringify(currentPreferences)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, serialized)
    }
    await db.settings.put({
      key: STORAGE_KEY,
      value: serialized,
      updatedAt: Date.now(),
    })
  } catch {
    // Ignore storage save failure
  }

  return currentPreferences
}

export async function resetPreferences(): Promise<UserPreferences> {
  currentPreferences = DEFAULT_PREFERENCES
  emit()

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
    await db.settings.delete(STORAGE_KEY)
  } catch {
    // Ignore
  }

  return currentPreferences
}
