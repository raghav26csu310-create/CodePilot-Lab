import type { AiProviderPreset, AiSettings } from './types'

/**
 * Provider presets cover genuinely available options: a local Ollama server,
 * OpenAI-compatible endpoints (DeepSeek, OpenAI, OpenRouter, Groq), and local
 * OpenAI-compatible servers (LM Studio, llama.cpp). Nothing here is a paid
 * requirement — the local options need no account at all.
 */
export const PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: '',
    keyExpected: false,
    note: 'Runs models on this machine. No account, no API key, no data leaves the device.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyExpected: true,
    note: 'OpenAI-compatible cloud API. A key is required and usage is billed by DeepSeek.',
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    keyExpected: true,
    note: 'OpenAI-compatible cloud API. A key is required; usage is billed by OpenAI.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    keyExpected: true,
    note: 'Aggregator with some free models. Rate limits apply; check each model page.',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    keyExpected: true,
    note: 'OpenAI-compatible cloud API with a free tier. Rate limits apply.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: '',
    keyExpected: false,
    note: 'Local OpenAI-compatible server. Start the LM Studio server first.',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp server (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:8080/v1',
    defaultModel: '',
    keyExpected: false,
    note: 'Local llama.cpp server. No account or key required.',
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    kind: 'openai-compatible',
    baseUrl: '',
    defaultModel: '',
    keyExpected: false,
    note: 'Any OpenAI-compatible endpoint, including a local proxy that holds your keys.',
  },
]

export const DEFAULT_AI_SETTINGS: AiSettings = {
  preset: 'ollama',
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: '',
  apiKey: '',
  rememberKey: false,
  temperature: 0.3,
  maxTokens: 1200,
  contextChars: 48000,
  historyDepth: 6,
}

export const SETTINGS_LIMITS = {
  temperature: { min: 0, max: 1.5, step: 0.1 },
  maxTokens: { min: 128, max: 8192, step: 64 },
  contextChars: { min: 8000, max: 160000, step: 4000 },
  historyDepth: { min: 0, max: 12, step: 1 },
} as const

export function presetById(id: string): AiProviderPreset | null {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null
}

export function providerLabel(settings: AiSettings): string {
  return presetById(settings.preset)?.label ?? 'Custom endpoint'
}

export function isConfigured(settings: AiSettings): boolean {
  return settings.baseUrl.trim().length > 0 && settings.model.trim().length > 0
}
