import {
  fetchGatewayStatus,
  streamGatewayChat,
  type GatewayStatus,
} from '../gateway/client'
import type { AiSettings, ChatRequest, ProviderAdapter } from '../types'

/**
 * Managed adapter. It is deliberately thin: the CodePilot API owns the provider
 * key, the managed/BYO decision, quotas, usage metering and provider retries.
 * The browser only streams ordinary chat turns and applies the deltas.
 */
export const gatewayProvider: ProviderAdapter = {
  id: 'gateway',
  label: 'CodePilot AI',
  requiresKey: false,
  requiresSession: true,

  async listModels(_settings: AiSettings, signal?: AbortSignal): Promise<string[]> {
    const status = await fetchGatewayStatus(signal)
    return modelsForStatus(status)
  },

  async stream(request: ChatRequest): Promise<void> {
    await streamGatewayChat({
      turns: request.turns,
      temperature: request.settings.temperature,
      maxTokens: request.settings.maxTokens,
      signal: request.signal,
      onDelta: request.onDelta,
      onMeta: request.onMeta,
      onUsage: request.onUsage,
    })
  },
}

export function modelsForStatus(status: GatewayStatus): string[] {
  if (status.managed.available && status.managed.model) {
    return status.managed.models.length > 0 ? status.managed.models : [status.managed.model]
  }
  if (status.connection?.model) {
    return [status.connection.model]
  }
  return []
}

/**
 * Turns gateway status into an honest availability sentence. It never claims
 * that AI is ready when neither managed mode nor a saved connection exists.
 */
export function describeGatewayAvailability(status: GatewayStatus): {
  available: boolean
  label: string
  detail: string
} {
  if (status.managed.available) {
    const model = status.managed.model ? ` using ${status.managed.model}` : ''
    return {
      available: true,
      label: `${status.managed.label} is available`,
      detail: `Managed mode${model}. Daily limit ${status.managed.limits.dailyRequests || 'unlimited'} requests.`,
    }
  }
  if (status.connection) {
    return {
      available: true,
      label: `${status.connection.label} is connected`,
      detail: `${status.connection.providerLabel} · ${status.connection.model}. Your key is stored encrypted on the API.`,
    }
  }
  return {
    available: false,
    label: 'No AI provider is available',
    detail:
      status.managed.reason ??
      'Managed CodePilot AI is not configured on this server and no personal provider is connected.',
  }
}
