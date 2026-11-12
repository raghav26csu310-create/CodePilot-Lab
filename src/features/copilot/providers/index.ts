import { AiError, toAiError } from '../errors'
import {
  fetchGatewayStatus,
  testGatewayConnection,
  type GatewayStatus,
} from '../gateway/client'
import { gatewayProvider, modelsForStatus } from './gateway'
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
  gateway: gatewayProvider,
  ollama: ollamaProvider,
  'openai-compatible': openAiCompatibleProvider,
}

export function adapterFor(kind: AiProviderKind): ProviderAdapter {
  return ADAPTERS[kind]
}

/**
 * Selects the transport from the settings, not only the provider kind. A BYO
 * provider can be routed through the API (server-held encrypted key) or called
 * directly by the browser in advanced mode.
 */
export function adapterForSettings(settings: AiSettings): ProviderAdapter {
  return settings.route === 'gateway' ? gatewayProvider : ADAPTERS[settings.provider]
}

/**
 * Performs a real request against the configured endpoint. A provider is only
 * ever reported as reachable when this succeeds; nothing is simulated.
 */
export async function testProviderConnection(settings: AiSettings): Promise<ConnectionReport> {
  const label = providerLabel(settings)
  const startedAt = performance.now()

  if (settings.route === 'gateway') {
    return testGateway(settings, label, startedAt)
  }

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

/**
 * The gateway test verifies three real things in order: the API answered, the
 * session is valid, and the account has a provider. A BYO route tests the draft
 * endpoint server-side so the browser never needs the key. A reachable API
 * without an available provider is reported as unavailable, not as a success.
 */
async function testGateway(
  settings: AiSettings,
  label: string,
  startedAt: number,
): Promise<ConnectionReport> {
  const managedPreset = settings.provider === 'gateway'

  if (!managedPreset) {
    try {
      const result = await testGatewayConnection({
        mode: 'byo',
        provider: settings.provider === 'ollama' ? 'ollama' : 'openai-compatible',
        baseUrl: settings.baseUrl.trim(),
        model: settings.model.trim(),
        apiKey: settings.apiKey.trim() || undefined,
      })
      return {
        ok: result.ok,
        providerLabel: result.label || label,
        baseUrl: result.baseUrl,
        latencyMs: result.latencyMs,
        models: result.models,
        message: result.message,
        kind: result.kind ? normalizeKind(result.kind) : undefined,
      }
    } catch (cause) {
      const error = toAiError(cause, 'the CodePilot API')
      return {
        ok: false,
        providerLabel: label,
        baseUrl: settings.baseUrl,
        latencyMs: Math.round(performance.now() - startedAt),
        models: [],
        message: error.message,
        kind: error.kind,
      }
    }
  }

  let status: GatewayStatus
  try {
    status = await fetchGatewayStatus()
  } catch (cause) {
    const error = toAiError(cause, 'the CodePilot API')
    return {
      ok: false,
      providerLabel: label,
      baseUrl: '',
      latencyMs: Math.round(performance.now() - startedAt),
      models: [],
      message: error.message,
      kind: error.kind,
    }
  }

  const models = modelsForStatus(status)
  const latencyMs = Math.round(performance.now() - startedAt)

  if (models.length === 0) {
    return {
      ok: false,
      providerLabel: status.managed.label,
      baseUrl: '',
      latencyMs,
      models,
      message:
        status.managed.reason ??
        'The API is reachable, but no managed or personal provider is available for this account.',
      kind: 'invalid-settings',
    }
  }

  const managed = status.managed.available
  return {
    ok: true,
    providerLabel: managed ? status.managed.label : (status.connection?.label ?? label),
    baseUrl: managed ? '' : (status.connection?.baseUrl ?? ''),
    latencyMs,
    models,
    message: managed
      ? `Managed AI is available${status.managed.model ? ` (${status.managed.model})` : ''}. ${status.quota.remainingToday ?? '—'} request(s) remaining today.`
      : `Your saved ${status.connection?.providerLabel ?? 'provider'} connection is available.`,
  }
}

export function canSend(settings: AiSettings): boolean {
  return isConfigured(settings)
}

function normalizeKind(value: string): ConnectionReport['kind'] {
  switch (value) {
    case 'aborted':
    case 'auth':
    case 'rate-limit':
    case 'network':
    case 'timeout':
    case 'not-found':
    case 'provider':
    case 'invalid-settings':
      return value
    default:
      return 'provider'
  }
}
