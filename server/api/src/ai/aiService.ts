import type { AppConfig, ManagedAiConfig } from '../config/env.ts'
import type { Store } from '../db/store.ts'
import type {
  AiConnectionRecord,
  AiProviderId,
  AiUsageMode,
  UsageSummary,
} from '../db/types.ts'
import { badRequest, serviceUnavailable, tooManyRequests } from '../http/errors.ts'
import type { CredentialCipher } from '../security/encryption.ts'
import { lastFour } from '../security/encryption.ts'
import { newId } from '../security/ids.ts'
import {
  PROVIDER_LABELS,
  ProviderClient,
  ProviderError,
  assertEndpointAllowed,
  type ChatMessage,
  type ProviderConfig,
  type StreamResult,
} from './providers.ts'

const PROVIDER_IDS: AiProviderId[] = [
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'deepseek',
  'openai-compatible',
]

export type PublicConnection = {
  id: string
  provider: AiProviderId
  providerLabel: string
  label: string
  baseUrl: string
  model: string
  hasKey: boolean
  keyLast4: string
  verifiedAt: number | null
  updatedAt: number
  lastTestAt: number | null
  lastTestOk: boolean | null
  lastTestMessage: string | null
}

export type AiStatus = {
  managed: {
    available: boolean
    label: string
    model: string | null
    models: string[]
    reason: string | null
    limits: { dailyRequests: number; monthlyTokens: number }
  }
  connection: PublicConnection | null
  connections: PublicConnection[]
  defaultProviderId: string | null
  fallbackProviderId: string | null
  usage: UsageSummary
  quota: {
    managedDailyRequests: number
    managedMonthlyTokens: number
    remainingToday: number | null
    remainingTokens: number | null
  }
  preferredMode: AiUsageMode | null
  defaultMode: AiUsageMode | 'none'
  usageNote: string
}

export type ConnectionInput = {
  id?: string
  provider: string
  label?: string
  baseUrl: string
  model: string
  apiKey?: string
}

export type TestInput = {
  connectionId?: string
  mode?: 'managed' | 'byo'
  provider?: string
  label?: string
  baseUrl?: string
  model?: string
  apiKey?: string
}

export type TestResult = {
  ok: boolean
  mode: 'managed' | 'byo'
  label: string
  baseUrl: string
  latencyMs: number
  models: string[]
  message: string
  kind?: string
}

export type ChatInput = {
  mode?: AiUsageMode
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
}

export type ProviderPreferencesInput = {
  defaultProviderId: string | null
  fallbackProviderId: string | null
}

export type ChatStreamEvent =
  | { type: 'meta'; mode: AiUsageMode; provider: string; model: string; label: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      completionChars: number
      promptChars: number
      latencyMs: number
      estimatedTokens: number
      usage: {
        promptTokens: number | null
        completionTokens: number | null
        estimatedTokens: number
        source: 'provider' | 'estimate'
      }
    }

export type ChatHooks = {
  signal: AbortSignal
  onEvent: (event: ChatStreamEvent) => void
}

type AiServiceOptions = {
  config: AppConfig
  store: Store
  cipher: CredentialCipher
  fetchImpl?: typeof fetch
  now?: () => number
}

const DEFAULT_TEMPERATURE = 0.3
const DEFAULT_MAX_TOKENS = 1200

export class AiService {
  private readonly config: AppConfig
  private readonly store: Store
  private readonly cipher: CredentialCipher
  private readonly now: () => number
  private readonly providers: ProviderClient

  constructor(options: AiServiceOptions) {
    this.config = options.config
    this.store = options.store
    this.cipher = options.cipher
    this.now = options.now ?? Date.now
    this.providers = new ProviderClient({
      fetchImpl: options.fetchImpl ?? fetch,
      allowPrivateEndpoints: options.config.ALLOW_PRIVATE_AI_ENDPOINTS,
      timeoutMs: options.config.AI_REQUEST_TIMEOUT_MS,
    })
  }

  async getStatus(userId: string): Promise<AiStatus> {
    const [connections, usage, settingsRecord] = await Promise.all([
      this.store.listAiConnections(userId),
      this.usageSummary(userId),
      this.store.getSettings(userId),
    ])

    const preferred = settingsRecord?.settings.aiMode
    const preferredMode: AiUsageMode | null =
      preferred === 'managed' || preferred === 'byo' ? preferred : null

    const managed = this.config.managedAi
    const managedAvailable = managed !== null
    const publicConnections = connections.map(toPublicConnection)
    const preferences = resolvedPreferences(
      settingsRecord?.settings ?? {},
      connections,
    )
    const defaultConnection = preferences.defaultProviderId
      ? connections.find((connection) => connection.id === preferences.defaultProviderId) ?? null
      : null
    const byoAvailable = connections.length > 0

    const defaultMode: AiUsageMode | 'none' = preferences.defaultProviderId
      ? 'byo'
      : preferredMode
      ? this.modeAvailable(preferredMode, managedAvailable, byoAvailable)
        ? preferredMode
        : managedAvailable
          ? 'managed'
          : byoAvailable
            ? 'byo'
            : 'none'
      : managedAvailable
        ? 'managed'
        : byoAvailable
          ? 'byo'
          : 'none'

    const limits = managed
      ? { dailyRequests: managed.dailyRequests, monthlyTokens: managed.monthlyTokens }
      : { dailyRequests: 0, monthlyTokens: 0 }

    return {
      managed: {
        available: managedAvailable,
        label: managed?.label ?? this.config.MANAGED_AI_LABEL,
        model: managed?.model ?? null,
        models: managed ? [managed.model, ...managed.fallbackModels].filter(unique) : [],
        reason: managed
          ? null
          : 'Managed CodePilot AI is not configured on this server. Connect a personal provider to use AI features.',
        limits,
      },
      connection: defaultConnection ? toPublicConnection(defaultConnection) : null,
      connections: publicConnections,
      defaultProviderId: preferences.defaultProviderId,
      fallbackProviderId: preferences.fallbackProviderId,
      usage,
      quota: {
        managedDailyRequests: limits.dailyRequests,
        managedMonthlyTokens: limits.monthlyTokens,
        remainingToday:
          managedAvailable && managed
            ? Math.max(0, managed.dailyRequests - usage.today.requests)
            : null,
        remainingTokens:
          managedAvailable && managed
            ? Math.max(0, managed.monthlyTokens - usage.month.estimatedTokens)
            : null,
      },
      preferredMode: byoAvailable || managedAvailable ? preferredMode : null,
      defaultMode,
      usageNote:
        'Token counts are estimates derived from character counts unless the provider returned real usage. No usage is fabricated.',
    }
  }

  async setPreferredMode(userId: string, mode: AiUsageMode): Promise<void> {
    if (mode !== 'managed' && mode !== 'byo') {
      throw badRequest('Mode must be "managed" or "byo".')
    }
    const existing = await this.store.getSettings(userId)
    const settings = { ...(existing?.settings ?? {}), aiMode: mode }
    await this.store.putSettings(userId, settings)
  }

  async saveConnection(userId: string, input: ConnectionInput): Promise<PublicConnection> {
    const provider = parseProvider(input.provider)
    const baseUrl = await assertEndpointAllowed(
      input.baseUrl,
      this.config.ALLOW_PRIVATE_AI_ENDPOINTS,
    )
    const model = input.model.trim()
    if (!model || model.length > 200) {
      throw badRequest('Choose a model name between 1 and 200 characters.')
    }
    const label = (input.label?.trim() || PROVIDER_LABELS[provider]).slice(0, 80)
    const [existingConnections, previousSettings] = await Promise.all([
      this.store.listAiConnections(userId),
      this.store.getSettings(userId),
    ])
    const previousPreferences = resolvedPreferences(
      previousSettings?.settings ?? {},
      existingConnections,
    )
    const existing = input.id ? await this.store.getAiConnection(userId, input.id) : null
    if (input.id && !existing) {
      throw badRequest('That provider configuration was not found for this account.')
    }

    let apiKey = (input.apiKey ?? '').trim()
    if (!apiKey && existing) {
      // Keep an existing secret only when the provider and endpoint are unchanged,
      // so switching endpoints never silently reuses a key for a new host.
      if (existing.provider === provider && existing.baseUrl === baseUrl) {
        apiKey = this.cipher.decrypt(existing.encryptedApiKey)
      }
    }

    if (requiresApiKey(provider) && !apiKey) {
      throw badRequest(`${PROVIDER_LABELS[provider]} requires an API key. The key is stored encrypted, never returned.`)
    }

    const updatedAt = this.now()
    const record = await this.store.upsertAiConnection(userId, {
      id: existing?.id ?? newId(),
      provider,
      label,
      baseUrl,
      model,
      encryptedApiKey: this.cipher.encrypt(apiKey),
      keyLast4: lastFour(apiKey),
      createdAt: updatedAt,
    })

    // Connecting a personal provider is an explicit choice to use it.
    await this.setPreferredMode(userId, 'byo')
    await this.setProviderPreferences(userId, {
      defaultProviderId: previousPreferences.defaultProviderId ?? record.id,
      fallbackProviderId: previousPreferences.fallbackProviderId,
    })
    return toPublicConnection(record)
  }

  async deleteConnection(userId: string, connectionId: string): Promise<void> {
    const deleted = await this.store.deleteAiConnection(userId, connectionId)
    if (!deleted) throw badRequest('That provider configuration was not found for this account.')
    const [settings, connections] = await Promise.all([
      this.store.getSettings(userId),
      this.store.listAiConnections(userId),
    ])
    const current = settings?.settings ?? {}
    const ids = new Set(connections.map((connection) => connection.id))
    const oldDefault =
      typeof current.aiDefaultProviderId === 'string' ? current.aiDefaultProviderId : null
    const oldFallback =
      typeof current.aiFallbackProviderId === 'string' ? current.aiFallbackProviderId : null
    const defaultProviderId =
      oldDefault && ids.has(oldDefault)
        ? oldDefault
        : oldFallback && ids.has(oldFallback)
          ? oldFallback
          : (connections[0]?.id ?? null)
    const fallbackProviderId =
      oldFallback && oldFallback !== defaultProviderId && ids.has(oldFallback)
        ? oldFallback
        : null
    await this.store.putSettings(userId, {
      ...current,
      aiDefaultProviderId: defaultProviderId,
      aiFallbackProviderId: fallbackProviderId,
      ...(!defaultProviderId && current.aiMode === 'byo'
        ? { aiMode: 'managed' }
        : {}),
    })
  }

  async setProviderPreferences(
    userId: string,
    input: ProviderPreferencesInput,
  ): Promise<void> {
    const connections = await this.store.listAiConnections(userId)
    const ids = new Set(connections.map((connection) => connection.id))
    if (input.defaultProviderId && !ids.has(input.defaultProviderId)) {
      throw badRequest('The selected default provider does not belong to this account.')
    }
    if (input.fallbackProviderId && !ids.has(input.fallbackProviderId)) {
      throw badRequest('The selected fallback provider does not belong to this account.')
    }
    if (!input.defaultProviderId && input.fallbackProviderId) {
      throw badRequest('A fallback provider requires a default provider.')
    }
    if (input.defaultProviderId && input.defaultProviderId === input.fallbackProviderId) {
      throw badRequest('The fallback provider must be different from the default provider.')
    }
    const existing = await this.store.getSettings(userId)
    await this.store.putSettings(userId, {
      ...(existing?.settings ?? {}),
      aiMode: input.defaultProviderId ? 'byo' : 'managed',
      aiDefaultProviderId: input.defaultProviderId,
      aiFallbackProviderId: input.fallbackProviderId,
    })
  }

  async testConnection(userId: string, input: TestInput): Promise<TestResult> {
    const mode = input.mode ?? 'byo'
    if (mode === 'managed') {
      return this.testManaged()
    }

    const existing = input.connectionId
      ? await this.store.getAiConnection(userId, input.connectionId)
      : null
    if (input.connectionId && !existing) {
      throw badRequest('That provider configuration was not found for this account.')
    }
    const draft =
      !existing ||
      (input.provider !== undefined && input.provider !== existing.provider) ||
      (input.label !== undefined && input.label.trim() !== existing.label) ||
      (input.baseUrl !== undefined && input.baseUrl.trim() !== existing.baseUrl) ||
      (input.model !== undefined && input.model.trim() !== existing.model) ||
      Boolean(input.apiKey?.trim())
    const provider = parseProvider(input.provider ?? existing?.provider ?? 'openai-compatible')
    const baseUrlRaw = input.baseUrl ?? existing?.baseUrl ?? ''
    const model = (input.model ?? existing?.model ?? '').trim()
    if (!baseUrlRaw.trim()) {
      throw badRequest('Enter a base URL before testing the connection.')
    }
    let apiKey = (input.apiKey ?? '').trim()
    const startedAt = this.now()
    let baseUrl = baseUrlRaw
    try {
      baseUrl = await assertEndpointAllowed(
        baseUrlRaw,
        this.config.ALLOW_PRIVATE_AI_ENDPOINTS,
      )
      if (!apiKey && existing && existing.provider === provider && existing.baseUrl === baseUrl) {
        apiKey = this.cipher.decrypt(existing.encryptedApiKey)
      }
      if (requiresApiKey(provider) && !apiKey) {
        throw new ProviderError(
          'invalid-settings',
          `${PROVIDER_LABELS[provider]} requires an API key.`,
        )
      }
      const models = await this.providers.listModels({
        provider,
        baseUrl,
        apiKey,
        model,
      })
      if (model && models.length > 0 && !models.includes(model)) {
        throw new ProviderError(
          'not-found',
          `The provider responded, but the selected model "${model}" is not available.`,
        )
      }
      const result: TestResult = {
        ok: true,
        mode: 'byo',
        label: input.label?.trim() || existing?.label || PROVIDER_LABELS[provider],
        baseUrl,
        latencyMs: this.now() - startedAt,
        models,
        message:
          models.length > 0
            ? `The endpoint answered with ${models.length} model${models.length === 1 ? '' : 's'}.`
            : 'The endpoint answered, but advertised no models.',
      }
      if (!draft && existing) {
        await this.store.markAiConnectionTest(userId, {
          id: existing.id,
          testedAt: this.now(),
          ok: true,
          message: result.message,
        })
      }
      return result
    } catch (error) {
      const result = providerFailure(error, {
        mode: 'byo',
        label: input.label?.trim() || existing?.label || PROVIDER_LABELS[provider],
        baseUrl,
        latencyMs: this.now() - startedAt,
      })
      if (!draft && existing) {
        await this.store.markAiConnectionTest(userId, {
          id: existing.id,
          testedAt: this.now(),
          ok: false,
          message: redactSecret(result.message, apiKey),
        })
      }
      return { ...result, message: redactSecret(result.message, apiKey) }
    }
  }

  private async testManaged(): Promise<TestResult> {
    const managed = this.requireManaged()
    const startedAt = this.now()
    try {
      const models = await this.providers.listModels({
        provider: managed.provider,
        baseUrl: managed.baseUrl,
        apiKey: managed.apiKey,
        model: managed.model,
      })
      return {
        ok: true,
        mode: 'managed',
        label: managed.label,
        baseUrl: managed.baseUrl,
        latencyMs: this.now() - startedAt,
        models,
        message:
          models.length > 0
            ? `${managed.label} answered with ${models.length} model${models.length === 1 ? '' : 's'}.`
            : `${managed.label} answered, but advertised no models.`,
      }
    } catch (error) {
      const result = providerFailure(error, {
        mode: 'managed',
        label: managed.label,
        baseUrl: managed.baseUrl,
        latencyMs: this.now() - startedAt,
      })
      return { ...result, message: redactSecret(result.message, managed.apiKey) }
    }
  }

  async chat(userId: string, input: ChatInput, hooks: ChatHooks): Promise<void> {
    const messages = validateMessages(input, this.config)
    const [connections, settingsRecord] = await Promise.all([
      this.store.listAiConnections(userId),
      this.store.getSettings(userId),
    ])
    const managed = this.config.managedAi
    const mode = await this.resolveMode(userId, input.mode, managed !== null, connections.length > 0)

    if (mode === 'managed') {
      if (!managed) {
        throw serviceUnavailable(
          'Managed CodePilot AI is not configured on this server. Connect a personal provider in Settings.',
        )
      }
      await this.enforceManagedQuota(userId, managed)
      const model = input.model?.trim() || managed.model
      if (!this.managedModelAllowed(managed, model)) {
        throw badRequest('That model is not served by the managed CodePilot AI.')
      }
      try {
        await this.runProvider({
          userId,
          mode,
          config: {
            provider: managed.provider,
            baseUrl: managed.baseUrl,
            apiKey: managed.apiKey,
            model,
            temperature: clamp(input.temperature, 0, 1.5, DEFAULT_TEMPERATURE),
            maxTokens: Math.round(clamp(input.maxTokens, 64, 16_384, DEFAULT_MAX_TOKENS)),
          },
          label: managed.label,
          messages,
          hooks,
        })
      } catch (error) {
        throw sanitizeProviderError(error, managed.apiKey)
      }
      return
    }

    if (connections.length === 0) {
      throw serviceUnavailable(
        'No AI provider is connected. Sign in and connect CodePilot AI or a personal provider in Settings.',
      )
    }
    const preferences = resolvedPreferences(settingsRecord?.settings ?? {}, connections)
    const primary =
      connections.find((connection) => connection.id === preferences.defaultProviderId) ??
      connections[0]
    if (!primary) {
      throw serviceUnavailable('No personal provider is connected for this account.')
    }
    const fallback = connections.find(
      (connection) => connection.id === preferences.fallbackProviderId,
    )
    let primaryDeltas = 0
    try {
      await this.runSavedProvider({
        userId,
        connection: primary,
        messages,
        input,
        hooks,
        onDelta: (text) => {
          primaryDeltas += text.length
          hooks.onEvent({ type: 'delta', text })
        },
      })
    } catch (error) {
      if (!fallback || primaryDeltas > 0 || !shouldFallback(error) || hooks.signal.aborted) {
        throw sanitizeProviderError(error, this.cipher.decrypt(primary.encryptedApiKey))
      }
      try {
        await this.runSavedProvider({
          userId,
          connection: fallback,
          messages,
          input,
          hooks,
          onDelta: (text) => hooks.onEvent({ type: 'delta', text }),
        })
      } catch (fallbackError) {
        const first = sanitizeProviderError(error, this.cipher.decrypt(primary.encryptedApiKey))
        const second = sanitizeProviderError(
          fallbackError,
          this.cipher.decrypt(fallback.encryptedApiKey),
        )
        if (first instanceof ProviderError && second instanceof ProviderError) {
          throw new ProviderError(
            second.code,
            `Default provider ${primary.label} failed: ${first.message} Fallback provider ${fallback.label} failed: ${second.message}`,
            second.status,
          )
        }
        throw second
      }
    }
  }

  private async runSavedProvider(args: {
    userId: string
    connection: AiConnectionRecord
    messages: ChatMessage[]
    input: ChatInput
    hooks: ChatHooks
    onDelta: (text: string) => void
  }): Promise<void> {
    const { userId, connection, messages, input, hooks, onDelta } = args
    const apiKey = this.cipher.decrypt(connection.encryptedApiKey)
    const model = connection.model
    if (!model) {
      throw badRequest(`The ${connection.label} provider has no model selected.`)
    }
    await this.runProvider({
      userId,
      mode: 'byo',
      config: {
        provider: connection.provider,
        baseUrl: connection.baseUrl,
        apiKey,
        model,
        temperature: clamp(input.temperature, 0, 1.5, DEFAULT_TEMPERATURE),
        maxTokens: Math.round(clamp(input.maxTokens, 64, 16_384, DEFAULT_MAX_TOKENS)),
      },
      label: connection.label,
      messages,
      hooks: { ...hooks, onEvent: (event) => {
        if (event.type === 'delta') {
          onDelta(event.text)
        } else {
          hooks.onEvent(event)
        }
      } },
    })
  }

  private async runProvider(args: {
    userId: string
    mode: AiUsageMode
    config: ProviderConfig
    label: string
    messages: ChatMessage[]
    hooks: ChatHooks
  }): Promise<void> {
    const { userId, mode, config, label, messages, hooks } = args
    const promptChars = messages.reduce((total, message) => total + message.content.length, 0)
    const startedAt = this.now()
    let completionChars = 0

    hooks.onEvent({
      type: 'meta',
      mode,
      provider: config.provider,
      model: config.model,
      label,
    })

    let result: StreamResult
    try {
      result = await this.providers.streamChat(config, messages, {
        signal: hooks.signal,
        onDelta: (text) => {
          completionChars += text.length
          hooks.onEvent({ type: 'delta', text })
        },
      })
    } catch (error) {
      const latencyMs = this.now() - startedAt
      await this.recordUsage({
        userId,
        mode,
        provider: config.provider,
        model: config.model,
        status: isAbort(error) ? 'aborted' : 'error',
        promptChars,
        completionChars,
        latencyMs,
      })
      throw error
    }

    const latencyMs = this.now() - startedAt
    const promptTokens = result.usage.promptTokens ?? Math.round(promptChars / 4)
    const completionTokens = result.usage.completionTokens ?? Math.round(completionChars / 4)
    const estimatedTokens = promptTokens + completionTokens

    await this.recordUsage({
      userId,
      mode,
      provider: config.provider,
      model: config.model,
      status: 'complete',
      promptChars,
      completionChars,
      latencyMs,
      estimatedTokens,
    })

    hooks.onEvent({
      type: 'done',
      completionChars,
      promptChars,
      latencyMs,
      estimatedTokens,
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        estimatedTokens,
        source:
          result.usage.promptTokens !== null && result.usage.completionTokens !== null
            ? 'provider'
            : 'estimate',
      },
    })
  }

  private async recordUsage(args: {
    userId: string
    mode: AiUsageMode
    provider: string
    model: string
    status: 'complete' | 'error' | 'aborted'
    promptChars: number
    completionChars: number
    latencyMs: number
    estimatedTokens?: number
  }): Promise<void> {
    const estimated =
      args.estimatedTokens ??
      Math.round(args.promptChars / 4) + Math.round(args.completionChars / 4)
    try {
      await this.store.recordUsage({
        id: newId(),
        userId: args.userId,
        mode: args.mode,
        provider: args.provider,
        model: args.model,
        status: args.status,
        promptChars: args.promptChars,
        completionChars: args.completionChars,
        estimatedTokens: estimated,
        latencyMs: args.latencyMs,
        createdAt: this.now(),
      })
    } catch (error) {
      // A usage write failure must not turn a successful answer into an error,
      // but it must be visible to the operator.
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'ai.usage.record.failure',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      )
    }
  }

  private async enforceManagedQuota(userId: string, managed: ManagedAiConfig): Promise<void> {
    const usage = await this.usageSummary(userId)
    if (managed.dailyRequests > 0 && usage.today.requests >= managed.dailyRequests) {
      throw tooManyRequests(
        `The managed AI daily request limit (${managed.dailyRequests}) is reached. It resets at 00:00 UTC.`,
        { scope: 'managed-daily-requests', limit: managed.dailyRequests, used: usage.today.requests },
      )
    }
    if (managed.monthlyTokens > 0 && usage.month.estimatedTokens >= managed.monthlyTokens) {
      throw tooManyRequests(
        `The managed AI monthly token budget (${managed.monthlyTokens.toLocaleString()} estimated tokens) is exhausted.`,
        {
          scope: 'managed-monthly-tokens',
          limit: managed.monthlyTokens,
          used: usage.month.estimatedTokens,
        },
      )
    }
  }

  private async resolveMode(
    userId: string,
    requested: AiUsageMode | undefined,
    managedAvailable: boolean,
    byoAvailable: boolean,
  ): Promise<AiUsageMode> {
    if (requested) {
      if (requested === 'managed' && !managedAvailable) {
        throw serviceUnavailable('Managed CodePilot AI is not configured on this server.')
      }
      if (requested === 'byo' && !byoAvailable) {
        throw serviceUnavailable('No personal provider is connected for this account.')
      }
      return requested
    }
    const settings = await this.store.getSettings(userId)
    const preferred = settings?.settings.aiMode
    if (preferred === 'managed' && managedAvailable) return 'managed'
    if (preferred === 'byo' && byoAvailable) return 'byo'
    if (managedAvailable) return 'managed'
    if (byoAvailable) return 'byo'
    throw serviceUnavailable(
      'No AI provider is available. Managed CodePilot AI is not configured, and no personal provider is connected.',
    )
  }

  private modeAvailable(
    mode: AiUsageMode,
    managedAvailable: boolean,
    byoAvailable: boolean,
  ): boolean {
    return mode === 'managed' ? managedAvailable : byoAvailable
  }

  private managedModelAllowed(managed: ManagedAiConfig, model: string): boolean {
    return model === managed.model || managed.fallbackModels.includes(model)
  }

  private requireManaged(): ManagedAiConfig {
    if (!this.config.managedAi) {
      throw serviceUnavailable('Managed CodePilot AI is not configured on this server.')
    }
    return this.config.managedAi
  }

  private usageSummary(userId: string): Promise<UsageSummary> {
    const now = new Date(this.now())
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    return this.store.getUsageSummary(userId, dayStart, monthStart)
  }
}

export function toPublicConnection(record: AiConnectionRecord): PublicConnection {
  return {
    id: record.id,
    provider: record.provider,
    providerLabel: PROVIDER_LABELS[record.provider],
    label: record.label,
    baseUrl: record.baseUrl,
    model: record.model,
    hasKey: record.encryptedApiKey.length > 0,
    keyLast4: record.keyLast4,
    verifiedAt: record.verifiedAt,
    updatedAt: record.updatedAt,
    lastTestAt: record.lastTestAt,
    lastTestOk: record.lastTestOk,
    lastTestMessage: record.lastTestMessage,
  }
}

function parseProvider(value: string): AiProviderId {
  if (PROVIDER_IDS.includes(value as AiProviderId)) {
    return value as AiProviderId
  }
  throw badRequest(
    'Provider must be OpenAI, Anthropic, Google Gemini, Ollama, DeepSeek or OpenAI-compatible.',
  )
}

function requiresApiKey(provider: AiProviderId): boolean {
  return provider === 'openai' || provider === 'anthropic' || provider === 'gemini' || provider === 'deepseek'
}

function resolvedPreferences(
  settings: Record<string, unknown>,
  connections: AiConnectionRecord[],
): ProviderPreferencesInput {
  const ids = new Set(connections.map((connection) => connection.id))
  const requestedDefault =
    typeof settings.aiDefaultProviderId === 'string' ? settings.aiDefaultProviderId : null
  const requestedFallback =
    typeof settings.aiFallbackProviderId === 'string' ? settings.aiFallbackProviderId : null
  const defaultWasSet = Object.prototype.hasOwnProperty.call(settings, 'aiDefaultProviderId')
  const defaultProviderId = defaultWasSet
    ? requestedDefault && ids.has(requestedDefault)
      ? requestedDefault
      : null
    : (connections[0]?.id ?? null)
  const fallbackProviderId =
    requestedFallback &&
    requestedFallback !== defaultProviderId &&
    ids.has(requestedFallback)
      ? requestedFallback
      : null
  return { defaultProviderId, fallbackProviderId }
}

function shouldFallback(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    ['auth', 'rate-limit', 'network', 'timeout', 'not-found', 'provider'].includes(error.code)
  )
}

function redactSecret(message: string, secret: string): string {
  return secret ? message.replaceAll(secret, '[redacted]') : message
}

function sanitizeProviderError(error: unknown, secret: string): unknown {
  if (!(error instanceof ProviderError)) return error
  return new ProviderError(error.code, redactSecret(error.message, secret), error.status)
}

function validateMessages(input: ChatInput, config: AppConfig): ChatMessage[] {
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw badRequest('At least one chat message is required.')
  }
  if (input.messages.length > config.AI_MAX_MESSAGES) {
    throw badRequest(`At most ${config.AI_MAX_MESSAGES} messages can be sent per request.`)
  }
  return input.messages.map((message, index) => {
    if (
      !message ||
      typeof message.content !== 'string' ||
      !['system', 'user', 'assistant'].includes(message.role)
    ) {
      throw badRequest(`Message ${index + 1} has an invalid role or content.`)
    }
    const content = message.content
    if (content.length > config.AI_MAX_MESSAGE_CHARS) {
      throw badRequest(
        `Message ${index + 1} exceeds the ${config.AI_MAX_MESSAGE_CHARS.toLocaleString()}-character limit.`,
      )
    }
    return { role: message.role, content }
  })
}

function providerFailure(
  error: unknown,
  base: { mode: 'managed' | 'byo'; label: string; baseUrl: string; latencyMs: number },
): TestResult {
  if (error instanceof ProviderError) {
    return {
      ok: false,
      ...base,
      models: [],
      message: error.message,
      kind: error.code,
    }
  }
  return {
    ok: false,
    ...base,
    models: [],
    message: error instanceof Error ? error.message : 'The connection test failed.',
    kind: 'provider',
  }
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof ProviderError && error.code === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function unique(value: string, index: number, all: string[]): boolean {
  return all.indexOf(value) === index
}
