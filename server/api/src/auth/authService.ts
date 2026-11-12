import { createHash } from 'node:crypto'

import type { Store } from '../db/store.ts'
import type { SessionRecord, UserRecord } from '../db/types.ts'
import { ApiError, badRequest, conflict, unauthorized } from '../http/errors.ts'
import { hashSessionToken, newId, newSessionToken } from '../security/ids.ts'
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from './passwords.ts'

export type PublicUser = {
  id: string
  email: string
  displayName: string
  createdAt: number
}

export type AuthResult = {
  user: PublicUser
  token: string
  expiresAt: number
}

export type RegisterInput = {
  email: string
  password: string
  displayName: string
}

export type AuthServiceOptions = {
  store: Store
  sessionTtlDays: number
  now?: () => number
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  }
}

export class AuthService {
  private readonly store: Store
  private readonly sessionTtlMs: number
  private readonly now: () => number

  constructor(options: AuthServiceOptions) {
    this.store = options.store
    this.sessionTtlMs = options.sessionTtlDays * 24 * 60 * 60 * 1000
    this.now = options.now ?? Date.now
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = normalizeEmail(input.email)
    const displayName = input.displayName.trim()
    const passwordProblemMessage = passwordProblem(input.password)

    if (!EMAIL_PATTERN.test(email)) {
      throw badRequest('Enter a valid email address.')
    }
    if (displayName.length === 0 || displayName.length > 80) {
      throw badRequest('Display name must be between 1 and 80 characters.')
    }
    if (passwordProblemMessage) {
      throw badRequest(passwordProblemMessage)
    }

    const existing = await this.store.findUserByEmail(email)
    if (existing) {
      throw conflict('An account with that email already exists.')
    }

    const at = this.now()
    let user: UserRecord
    try {
      user = await this.store.createUser({
        id: newId(),
        email,
        displayName,
        passwordHash: await hashPassword(input.password),
        createdAt: at,
      })
    } catch (error) {
      if (isDuplicate(error)) {
        throw conflict('An account with that email already exists.')
      }
      throw error
    }

    return this.issueSession(user)
  }

  async login(emailInput: string, password: string): Promise<AuthResult> {
    const email = normalizeEmail(emailInput)
    const user = await this.store.findUserByEmail(email)
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH
    const valid = await verifyPassword(password, hash)
    if (!user || !valid) {
      throw unauthorized('The email or password is incorrect.')
    }
    return this.issueSession(user)
  }

  async resolveSession(token: string): Promise<SessionRecord | null> {
    const tokenHash = hashSessionToken(token)
    const session = await this.store.findSessionByTokenHash(tokenHash)
    if (!session) return null

    const at = this.now()
    if (session.expiresAt <= at) {
      await this.store.deleteSession(session.id)
      return null
    }

    // Avoid a write on every request while still recording real activity.
    if (at - session.lastSeenAt > 5 * 60 * 1000) {
      await this.store.touchSession(session.id, at)
      return { ...session, lastSeenAt: at }
    }
    return session
  }

  async logout(token: string): Promise<void> {
    const session = await this.store.findSessionByTokenHash(hashSessionToken(token))
    if (session) {
      await this.store.deleteSession(session.id)
    }
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
    const user = await this.store.findUserById(userId)
    if (!user) throw unauthorized()
    const valid = await verifyPassword(currentPassword, user.passwordHash)
    if (!valid) throw unauthorized('The current password is incorrect.')
    const problem = passwordProblem(nextPassword)
    if (problem) throw badRequest(problem)
    await this.store.updateUser(userId, {
      passwordHash: await hashPassword(nextPassword),
      updatedAt: this.now(),
    })
  }

  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.store.findUserById(userId)
    if (!user) throw unauthorized()
    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) throw unauthorized('The password is incorrect.')
    await this.store.deleteUser(userId)
  }

  async updateProfile(userId: string, displayNameInput: string): Promise<PublicUser> {
    const displayName = displayNameInput.trim()
    if (displayName.length === 0 || displayName.length > 80) {
      throw badRequest('Display name must be between 1 and 80 characters.')
    }
    const updated = await this.store.updateUser(userId, {
      displayName,
      updatedAt: this.now(),
    })
    if (!updated) throw new ApiError(404, 'not_found', 'That account no longer exists.')
    return toPublicUser(updated)
  }

  private async issueSession(user: UserRecord): Promise<AuthResult> {
    const token = newSessionToken()
    const at = this.now()
    const expiresAt = at + this.sessionTtlMs
    await this.store.createSession({
      id: newId(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      createdAt: at,
      expiresAt,
    })
    return {
      user: toPublicUser(user),
      token,
      expiresAt,
    }
  }
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isDuplicate(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'duplicate_email',
  )
}

/** Stable per-email key for login rate limiting without storing the address. */
export function emailRateKey(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 24)
}
