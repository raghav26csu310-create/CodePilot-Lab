import { AiError, toAiError } from '../errors'
import { isConfigured, providerLabel } from '../providerPresets'
import type {
  AiProviderKind,
  AiSettings,
  ConnectionReport,
  ProviderAdapter,
} from '../types'
import { ollamaProvider } from './ollama'
import { openAiCompatibleProvider } from './openaiCompatible'

const ADAPTERS: Record<AiProviderKind, ProviderAdapter> = {
  ollama: ollamaProvider,
  'openai-compatible': openAiCompatibleProvider,
}

export function adapterFor(kind: AiProviderKind): ProviderAdapter {
  return ADAPTERS[kind]
}

/**
 * Performs a real request against the configured endpoint. A provider is only
 * ever reported as reachable when this succeeds; nothing is simulated.
 */
export async function testProviderConnection(settings: AiSettings): Promise<ConnectionReport> {
  const label = providerLabel(settings)
  const startedAt = performance.now()

  if (!settings.baseUrl.trim()) {
    return {
      ok: false,
      providerLabel: label,
      baseUrl: settings.baseUrl,
      latencyMs: 0,
      models: [],
      message: 'No base URL is set for this provider.',
      kind: 'invalid-settings',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)

  try {
    const models = await adapterFor(settings.provider).listModels(settings, controller.signal)
    return {
      ok: true,
      providerLabel: label,
      baseUrl: settings.baseUrl,
      latencyMs: Math.round(performance.now() - startedAt),
      models,
      message:
        models.length > 0
          ? `Endpoint responded with ${models.length} model${models.length === 1 ? '' : 's'}.`
          : 'Endpoint responded, but it advertised no models.',
    }
  } catch (cause) {
    const error =
      cause instanceof DOMException && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
        ? new AiError('timeout', 'The connection test timed out after 25 seconds.')
        : toAiError(cause, settings.baseUrl)
    return {
      ok: false,
      providerLabel: label,
      baseUrl: settings.baseUrl,
      latencyMs: Math.round(performance.now() - startedAt),
      models: [],
      message: error.message,
      kind: error.kind,
    }
  } finally {
    clearTimeout(timer)
  }
}

export function canSend(settings: AiSettings): boolean {
  return isConfigured(settings)
}
