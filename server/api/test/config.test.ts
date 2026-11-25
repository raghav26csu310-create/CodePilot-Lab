import { describe, expect, it } from 'vitest'

import { buildConfig, ConfigurationError } from '../src/config/env.ts'

function config(overrides: Record<string, string> = {}) {
  return buildConfig({
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:5173',
    ...overrides,
  } as NodeJS.ProcessEnv)
}

describe('API environment validation', () => {
  it('rejects unknown boolean values instead of silently treating them as false', () => {
    expect(() => config({ TRUST_PROXY: 'sometimes' })).toThrow()
  })

  it('requires managed AI credentials to be configured as a complete set', () => {
    expect(() =>
      config({
        MANAGED_AI_BASE_URL: 'https://provider.example/v1',
        MANAGED_AI_API_KEY: 'test-key',
      }),
    ).toThrow(ConfigurationError)
  })

  it('uses the server-only Groq key and configured model as the managed primary', () => {
    const parsed = config({
      GROQ_API_KEY: 'groq-server-secret',
      GROQ_MODEL: 'openai/gpt-oss-20b',
      MANAGED_AI_BASE_URL: 'https://legacy.example/v1',
      MANAGED_AI_API_KEY: 'legacy-secret',
      MANAGED_AI_MODEL: 'legacy-model',
    })

    expect(parsed.managedAi).toMatchObject({
      provider: 'openai-compatible',
      label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'groq-server-secret',
      model: 'openai/gpt-oss-20b',
    })
  })

  it('does not enable managed AI from a model name without a Groq key', () => {
    expect(config({ GROQ_MODEL: 'openai/gpt-oss-20b' }).managedAi).toBeNull()
  })

  it('rejects non-origin CORS entries', () => {
    expect(() => config({ CORS_ORIGINS: 'https://example.test/api' })).toThrow(ConfigurationError)
  })

  it('keeps development and test API listeners loopback-only', () => {
    expect(() => config({ API_HOST: '0.0.0.0' })).toThrow(ConfigurationError)
  })

  it('rejects malformed encryption keys before services are constructed', () => {
    expect(() => config({ CREDENTIAL_ENCRYPTION_KEY: 'not-a-key' })).toThrow(ConfigurationError)
  })

  it('rejects cookie names that are not safe HTTP token characters', () => {
    expect(() => config({ SESSION_COOKIE_NAME: 'session; HttpOnly' })).toThrow()
  })

  it('accepts explicit false boolean values and canonical origins', () => {
    expect(config({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false)
  })
})
