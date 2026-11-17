import type { AiProviderId } from '../db/types.ts'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ProviderConfig = {
  provider: AiProviderId
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
}

export type ProviderUsage = {
  promptTokens: number | null
  completionTokens: number | null
}

export type StreamResult = {
  completionChars: number
  usage: ProviderUsage
}

export type ProviderFailure = {
  code:
    | 'aborted'
    | 'auth'
    | 'rate-limit'
    | 'network'
    | 'timeout'
    | 'not-found'
    | 'provider'
    | 'invalid-endpoint'
    | 'invalid-settings'
  status: number | null
  message: string
}

export class ProviderError extends Error {
  code: ProviderFailure['code']
  status: number | null

  constructor(code: ProviderFailure['code'], message: string, status: number | null = null) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}

export type ProviderStreamOptions = {
  signal: AbortSignal
  onDelta: (text: string) => void
}

export type ProviderTransport = {
  request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response>
  httpError(response: Response): Promise<ProviderError>
}

export type ProviderAdapter = {
  requiresApiKey: boolean
  listModels(
    baseUrl: string,
    config: ProviderConfig,
    transport: ProviderTransport,
    signal?: AbortSignal,
  ): Promise<string[]>
  streamChat(
    baseUrl: string,
    config: ProviderConfig,
    messages: ChatMessage[],
    options: ProviderStreamOptions,
    transport: ProviderTransport,
  ): Promise<StreamResult>
}
