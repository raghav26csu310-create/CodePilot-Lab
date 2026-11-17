import { afterEach, describe, expect, it } from 'vitest'

import { db } from '../../lib/db'
import { DEFAULT_AI_SETTINGS } from './providerPresets'
import { loadAiSettings, saveAiSettings, sanitizeSettings } from './settingsStore'

const SETTINGS_KEY = 'copilot.provider.v1'

afterEach(async () => {
  await db.settings.delete(SETTINGS_KEY)
})

describe('AI provider settings credential handling', () => {
  it('discards legacy browser keys and migrates them out of IndexedDB', async () => {
    await db.settings.put({
      key: SETTINGS_KEY,
      value: JSON.stringify({
        ...DEFAULT_AI_SETTINGS,
        provider: 'openai-compatible',
        route: 'direct',
        apiKey: 'legacy-browser-secret',
        rememberKey: true,
      }),
      updatedAt: Date.now(),
    })

    await loadAiSettings()

    const stored = await db.settings.get(SETTINGS_KEY)
    expect(stored?.value).not.toContain('legacy-browser-secret')
    expect(JSON.parse(stored?.value ?? '{}')).toMatchObject({
      route: 'gateway',
      apiKey: '',
      rememberKey: false,
    })
    expect(
      sanitizeSettings({
        ...DEFAULT_AI_SETTINGS,
        route: 'direct',
        apiKey: 'another-secret',
        rememberKey: true,
      }),
    ).toMatchObject({ route: 'gateway', apiKey: '', rememberKey: false })
  })

  it('never persists a key supplied to settings', async () => {
    await saveAiSettings({
      ...DEFAULT_AI_SETTINGS,
      route: 'direct',
      apiKey: 'unsaved-provider-secret',
      rememberKey: true,
    })

    const stored = await db.settings.get(SETTINGS_KEY)
    expect(stored?.value).not.toContain('unsaved-provider-secret')
    expect(JSON.parse(stored?.value ?? '{}')).toMatchObject({
      route: 'gateway',
      apiKey: '',
      rememberKey: false,
    })
  })
})
