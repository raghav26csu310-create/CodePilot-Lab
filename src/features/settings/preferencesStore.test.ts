import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  getPreferencesSnapshot,
  resetPreferences,
  updatePreferences,
} from './preferencesStore'

describe('preferencesStore', () => {
  it('provides default preferences out of the box', () => {
    const prefs = getPreferencesSnapshot()
    expect(prefs.editor.fontSize).toBe(DEFAULT_PREFERENCES.editor.fontSize)
    expect(prefs.editor.wordWrap).toBe('on')
    expect(prefs.terminal.defaultShell).toBe('powershell.exe')
    expect(prefs.appearance.theme).toBe('midnight')
  })

  it('updates preferences immutably and emits updates', async () => {
    await updatePreferences({
      editor: { fontSize: 18, wordWrap: 'off' },
      terminal: { defaultShell: 'cmd.exe' },
    })

    const updated = getPreferencesSnapshot()
    expect(updated.editor.fontSize).toBe(18)
    expect(updated.editor.wordWrap).toBe('off')
    expect(updated.terminal.defaultShell).toBe('cmd.exe')
    // Untouched properties remain unchanged
    expect(updated.editor.tabSize).toBe(DEFAULT_PREFERENCES.editor.tabSize)
  })

  it('resets preferences back to defaults', async () => {
    await resetPreferences()
    const reset = getPreferencesSnapshot()
    expect(reset.editor.fontSize).toBe(DEFAULT_PREFERENCES.editor.fontSize)
    expect(reset.editor.wordWrap).toBe(DEFAULT_PREFERENCES.editor.wordWrap)
    expect(reset.terminal.defaultShell).toBe(DEFAULT_PREFERENCES.terminal.defaultShell)
  })
})
