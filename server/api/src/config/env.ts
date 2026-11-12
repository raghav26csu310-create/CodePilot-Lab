import { z } from 'zod'

/**
 * Server configuration. Everything here is process-level and never reaches the
 * browser: provider credentials, the database URL and the cookie/encryption
 * secrets live only in the API process.
 *
 * Production refuses to start with an incomplete security configuration. The
 * development defaults stay usable for a local laptop, and the health endpoint
 * reports exactly which capabilities are actually available.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  })

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().default(''),
  CORS_ORIGINS: csv,
  SESSION_COOKIE_NAME: z.string().min(1).max(64).default('codepilot_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  SESSION_COOKIE_SECURE: booleanish.default(false),
  CREDENTIAL_ENCRYPTION_KEY: z.string().default(''),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(60_000),
  AI_MAX_MESSAGES: z.coerce.number().int().min(1).max(200).default(40),
  AI_MAX_MESSAGE_CHARS: z.coerce.number().int().min(1000).max(500_000).default(120_000),
  ALLOW_PRIVATE_AI_ENDPOINTS: booleanish.default(true),
  MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(16_000_000).default(2_000_000),
  TRUST_PROXY: booleanish.default(false),

  MANAGED_AI_PROVIDER: z.string().default('openai-compatible'),
  MANAGED_AI_LABEL: z.string().default('CodePilot AI'),
  MANAGED_AI_BASE_URL: z.string().default(''),
  MANAGED_AI_API_KEY: z.string().default(''),
  MANAGED_AI_MODEL: z.string().default(''),
  MANAGED_AI_DAILY_REQUESTS: z.coerce.number().int().min(0).max(100_000).default(100),
  MANAGED_AI_MONTHLY_TOKENS: z.coerce.number().int().min(0).max(100_000_000).default(500_000),
  MANAGED_AI_FALLBACK_MODELS: csv,
})

export type ServerEnv = z.infer<typeof EnvSchema>

export type ManagedAiProviderId = 'ollama' | 'deepseek' | 'openai-compatible'

export type ManagedAiConfig = {
  provider: ManagedAiProviderId
  label: string
  baseUrl: string
  apiKey: string
  model: string
  dailyRequests: number
  monthlyTokens: number
  fallbackModels: string[]
}

function parseManagedProvider(value: string): ManagedAiProviderId {
  if (value === 'ollama' || value === 'deepseek' || value === 'openai-compatible') {
    return value
  }
  throw new ConfigurationError(
    'MANAGED_AI_PROVIDER must be "ollama", "deepseek" or "openai-compatible".',
  )
}

export type AppConfig = Omit<
  ServerEnv,
  'MANAGED_AI_PROVIDER' | 'MANAGED_AI_BASE_URL' | 'MANAGED_AI_API_KEY'
> & {
  managedAi: ManagedAiConfig | null
  allowedOrigins: string[]
}

/** Default allowed origins are the two local Vite ports; never a wildcard. */
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:4180',
  'http://127.0.0.1:4180',
]

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export function buildConfig(input: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(input)
  const isProduction = parsed.NODE_ENV === 'production'
  const allowedOrigins =
    parsed.CORS_ORIGINS.length > 0 ? parsed.CORS_ORIGINS : isProduction ? [] : DEV_ORIGINS

  if (allowedOrigins.some((origin) => origin === '*' || !/^https?:\/\//.test(origin))) {
    throw new ConfigurationError(
      'CORS_ORIGINS must list explicit http(s) origins. Wildcards are not accepted.',
    )
  }

  if (isProduction) {
    if (!parsed.DATABASE_URL) {
      throw new ConfigurationError('DATABASE_URL is required in production.')
    }
    if (!parsed.CREDENTIAL_ENCRYPTION_KEY) {
      throw new ConfigurationError(
        'CREDENTIAL_ENCRYPTION_KEY is required in production (base64-encoded 32 bytes).',
      )
    }
    if (allowedOrigins.length === 0) {
      throw new ConfigurationError('CORS_ORIGINS is required in production.')
    }
    if (!parsed.SESSION_COOKIE_SECURE) {
      throw new ConfigurationError('SESSION_COOKIE_SECURE must be enabled in production.')
    }
  }

  const managedConfigured =
    parsed.MANAGED_AI_BASE_URL.trim().length > 0 &&
    parsed.MANAGED_AI_API_KEY.trim().length > 0 &&
    parsed.MANAGED_AI_MODEL.trim().length > 0

  const managedAi: ManagedAiConfig | null = managedConfigured
    ? {
        provider: parseManagedProvider(parsed.MANAGED_AI_PROVIDER),
        label: parsed.MANAGED_AI_LABEL.trim() || 'CodePilot AI',
        baseUrl: parsed.MANAGED_AI_BASE_URL.trim(),
        apiKey: parsed.MANAGED_AI_API_KEY.trim(),
        model: parsed.MANAGED_AI_MODEL.trim(),
        dailyRequests: parsed.MANAGED_AI_DAILY_REQUESTS,
        monthlyTokens: parsed.MANAGED_AI_MONTHLY_TOKENS,
        fallbackModels: parsed.MANAGED_AI_FALLBACK_MODELS,
      }
    : null

  return {
    ...parsed,
    managedAi,
    allowedOrigins,
  }
}

/**
 * Best-effort `.env` loading for local development. Node provides
 * `process.loadEnvFile` (20.12+); an absent file is not an error because the
 * operator may supply variables through the environment instead.
 */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path)
  } catch {
    // No .env file: environment variables are authoritative.
  }
}
