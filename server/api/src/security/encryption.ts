import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * AES-256-GCM envelope for provider API keys. The plaintext key only exists in
 * process memory for the duration of a provider call. The database stores the
 * envelope; no API response, log line or GraphQL-style projection reads it.
 */
export class CredentialCipher {
  readonly ephemeral: boolean
  private readonly key: Buffer

  constructor(key: Buffer, ephemeral: boolean) {
    this.key = key
    this.ephemeral = ephemeral
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return ''
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(
      '.',
    )
  }

  decrypt(envelope: string): string {
    if (!envelope) return ''
    const parts = envelope.split('.')
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('The stored credential envelope is not recognised.')
    }
    const iv = Buffer.from(parts[1]!, 'base64url')
    const tag = Buffer.from(parts[2]!, 'base64url')
    const payload = Buffer.from(parts[3]!, 'base64url')
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('The stored credential envelope is malformed.')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    try {
      return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
    } catch {
      throw new Error(
        'The stored credential could not be decrypted with the current CREDENTIAL_ENCRYPTION_KEY.',
      )
    }
  }
}

/**
 * Parses the base64url/base64 secret. Production requires an explicit key; in
 * development an ephemeral key keeps the server usable but the caller must
 * disclose that saved BYO credentials disappear on restart.
 */
export function createCredentialCipher(secret: string, isProduction: boolean): CredentialCipher {
  const trimmed = secret.trim()
  if (!trimmed) {
    if (isProduction) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY is required in production.')
    }
    return new CredentialCipher(randomBytes(32), true)
  }

  const key = Buffer.from(trimmed, 'base64')
  if (key.length === 32) {
    return new CredentialCipher(key, false)
  }

  // Hosting platforms commonly inject a high-entropy secret instead of a
  // base64 string. Derive a deterministic 32-byte key so generated secrets
  // work without a manual conversion step; the same input always maps to the
  // same key, which is what makes saved credentials survive a restart.
  if (trimmed.length >= 32) {
    return new CredentialCipher(createHash('sha256').update(trimmed, 'utf8').digest(), false)
  }

  throw new Error(
    'CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters, or 32 bytes encoded as base64 (generate one with `openssl rand -base64 32`).',
  )
}

export function lastFour(secret: string): string {
  return secret.length >= 4 ? secret.slice(-4) : ''
}
