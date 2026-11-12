import { createHash, randomBytes, randomUUID } from 'node:crypto'

export function newId(): string {
  return randomUUID()
}

/** Raw session tokens exist only in the browser cookie; the database sees a hash. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newTokenIdHash(token: string): string {
  return hashSessionToken(token)
}
