import type { Store } from '../db/store.ts'
import type { UserSettingsRecord } from '../db/types.ts'
import { badRequest } from '../http/errors.ts'

const MAX_SETTINGS_BYTES = 64 * 1024
const FORBIDDEN_KEY = /(api[_-]?key|secret|password|token|credential|authorization)/i

/**
 * Non-secret user preferences. Provider credentials have a dedicated,
 * encrypted store; this endpoint refuses secret-shaped keys so a future client
 * cannot accidentally persist a key in plaintext JSON.
 */
export class SettingsService {
  private readonly store: Store

  constructor(store: Store) {
    this.store = store
  }

  async get(userId: string): Promise<UserSettingsRecord> {
    const record = await this.store.getSettings(userId)
    return record ?? { userId, settings: {}, updatedAt: 0 }
  }

  async put(userId: string, settings: Record<string, unknown>): Promise<UserSettingsRecord> {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw badRequest('Settings must be a JSON object.')
    }
    const serialized = JSON.stringify(settings)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SETTINGS_BYTES) {
      throw badRequest('Settings exceed the 64 KB limit.')
    }
    const offending = findSecretKey(settings)
    if (offending) {
      throw badRequest(
        `Settings key "${offending}" looks like a credential. Use the AI connection endpoint, which encrypts keys.`,
      )
    }
    return this.store.putSettings(userId, settings)
  }
}

function findSecretKey(value: unknown, depth = 0): string | null {
  if (depth > 8 || !value || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) return key
    const nested = findSecretKey(child, depth + 1)
    if (nested) return nested
  }
  return null
}
