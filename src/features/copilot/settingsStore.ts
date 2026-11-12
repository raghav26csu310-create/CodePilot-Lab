import { useSyncExternalStore } from 'react'

import { db } from '../../lib/db'
import { DEFAULT_AI_SETTINGS, PROVIDER_PRESETS, presetById, SETTINGS_LIMITS } from './providerPresets'
import type { AiProviderKind, AiSettings, ConnectionReport } from './types'

const SETTINGS_KEY = 'copilot.provider.v1'

export type AiSettingsSnapshot = {
  settings: AiSettings
  /** False until the IndexedDB read has finished. */
  loaded: boolean
  /** True when an API key was restored from storage in this session. */
  keyRestored: boolean
  /** Result of the most recent real connection test in this session. */
  lastTest: ConnectionReport | null
  /** Best-known model list for the current settings (from a successful test). */
  models: string[]
}

let snapshot: AiSettingsSnapshot = {
  settings: DEFAULT_AI_SETTINGS,
  loaded: false,
  keyRestored: false,
  lastTest: null,
  models: [],
}

const listeners = new Set<() => void>()
let loadPromise: Promise<void> | null = null

function emit(next: AiSettingsSnapshot) {
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): AiSettingsSnapshot {
  return snapshot
}

export function useAiSettings(): AiSettingsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getAiSettings(): AiSettingsSnapshot {
  return snapshot
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Normalizes untrusted input (stored JSON or form values) into a settings
 * object. The key is trimmed and dropped unless the user opted into storage.
 */
export function sanitizeSettings(input: Partial<AiSettings> | null | undefined): AiSettings {
  const base = DEFAULT_AI_SETTINGS
  const preset =
    typeof input?.preset === 'string' && presetById(input.preset) ? input.preset : base.preset
  const presetInfo = presetById(preset)
  const provider: AiProviderKind =
    input?.provider === 'gateway' ||
    input?.provider === 'ollama' ||
    input?.provider === 'openai-compatible'
      ? input.provider
      : (presetInfo?.kind ?? base.provider)
  const rememberKey = input?.rememberKey === true
  const apiKey = rememberKey ? stringOr(input?.apiKey, '').trim() : ''
  const route: AiSettings['route'] =
    input?.route === 'gateway' || input?.route === 'direct'
      ? input.route
      : presetInfo?.kind === 'gateway'
        ? 'gateway'
        : 'direct'

  return {
    preset,
    provider,
    route,
    baseUrl: stringOr(input?.baseUrl, presetInfo?.baseUrl ?? base.baseUrl).trim(),
    model: stringOr(input?.model, presetInfo?.defaultModel ?? base.model).trim(),
    apiKey,
    rememberKey,
    temperature: clamp(
      numberOr(input?.temperature, base.temperature),
      SETTINGS_LIMITS.temperature.min,
      SETTINGS_LIMITS.temperature.max,
    ),
    maxTokens: Math.round(
      clamp(
        numberOr(input?.maxTokens, base.maxTokens),
        SETTINGS_LIMITS.maxTokens.min,
        SETTINGS_LIMITS.maxTokens.max,
      ),
    ),
    contextChars: Math.round(
      clamp(
        numberOr(input?.contextChars, base.contextChars),
        SETTINGS_LIMITS.contextChars.min,
        SETTINGS_LIMITS.contextChars.max,
      ),
    ),
    historyDepth: Math.round(
      clamp(
        numberOr(input?.historyDepth, base.historyDepth),
        SETTINGS_LIMITS.historyDepth.min,
        SETTINGS_LIMITS.historyDepth.max,
      ),
    ),
  }
}

export async function loadAiSettings(): Promise<void> {
  if (loadPromise) {
    return loadPromise
  }

  loadPromise = (async () => {
    try {
      const row = await db.settings.get(SETTINGS_KEY)
      let parsed: Partial<AiSettings> | null = null
      if (row) {
        try {
          parsed = JSON.parse(row.value) as Partial<AiSettings>
        } catch {
          parsed = null
        }
      }

      const settings = sanitizeSettings(parsed)
      emit({
        settings,
        loaded: true,
        keyRestored: keyStored(settings),
        lastTest: null,
        models: [],
      })
    } catch {
      // IndexedDB unavailable: keep the in-memory defaults, still mark loaded so
      // the UI can show an honest "not saved" state.
      emit({ ...snapshot, loaded: true })
    }
  })()

  return loadPromise
}

function serialize(settings: AiSettings): string {
  const safe = sanitizeSettings(settings)
  // Managed mode never persists a provider key: there is no client-side key to
  // keep, and a stale one must not survive a switch to the gateway.
  const persistKey =
    safe.rememberKey && safe.route === 'direct' && safe.provider !== 'gateway'
  return JSON.stringify({
    preset: safe.preset,
    provider: safe.provider,
    route: safe.route,
    baseUrl: safe.baseUrl,
    model: safe.model,
    apiKey: persistKey ? safe.apiKey : '',
    rememberKey: persistKey,
    temperature: safe.temperature,
    maxTokens: safe.maxTokens,
    contextChars: safe.contextChars,
    historyDepth: safe.historyDepth,
  })
}

function keyStored(settings: AiSettings): boolean {
  return (
    settings.route === 'direct' &&
    settings.provider !== 'gateway' &&
    settings.rememberKey &&
    settings.apiKey.length > 0
  )
}

export async function saveAiSettings(input: AiSettings): Promise<AiSettings> {
  const settings = sanitizeSettings(input)
  await db.settings.put({
    key: SETTINGS_KEY,
    value: serialize(settings),
    updatedAt: Date.now(),
  })
  emit({
    settings,
    loaded: true,
    keyRestored: keyStored(settings),
    lastTest: null,
    models: [],
  })
  return settings
}

/** Applies settings for this session without writing them to IndexedDB. */
export function setSessionSettings(input: AiSettings): AiSettings {
  const settings = sanitizeSettings(input)
  emit({ ...snapshot, settings, lastTest: null, models: [] })
  return settings
}

export async function forgetAiSettings(): Promise<void> {
  await db.settings.delete(SETTINGS_KEY)
  emit({ ...snapshot, settings: DEFAULT_AI_SETTINGS, lastTest: null, models: [] })
}

/** Records a real connection result; clears the verified claim on any edit. */
export function recordConnectionTest(report: ConnectionReport): void {
  emit({
    ...snapshot,
    lastTest: report,
    models: report.ok ? report.models : [],
  })
}

export function availablePresets() {
  return PROVIDER_PRESETS
}

/**
 * Applies a preset while preserving values the user already typed where they
 * still make sense (model, key, advanced limits).
 */
export function settingsForPreset(current: AiSettings, presetId: string): AiSettings {
  const preset = presetById(presetId)
  if (!preset) {
    return current
  }

  const switchingProvider = preset.kind !== current.provider
  return sanitizeSettings({
    ...current,
    preset: preset.id,
    provider: preset.kind,
    route: preset.kind === 'gateway' ? 'gateway' : current.route,
    baseUrl: switchingProvider ? preset.baseUrl : preset.baseUrl || current.baseUrl,
    model: preset.defaultModel || (switchingProvider ? '' : current.model),
    apiKey: current.apiKey,
  })
}
