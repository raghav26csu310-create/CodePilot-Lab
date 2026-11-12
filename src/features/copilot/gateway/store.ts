import { useSyncExternalStore } from 'react'

import { AiError } from '../errors'
import {
  fetchGatewayStatus,
  probeGateway,
  registerWithGateway,
  signInWithGateway,
  signOutOfGateway,
  type GatewayStatus,
  type GatewayUser,
} from './client'

/**
 * External store for the CodePilot API gateway state. It holds only what a real
 * request returned: reachability from `/api/health`, the signed-in user from
 * `/api/auth/session`, and AI availability from `/api/ai/status`. Nothing here
 * is seeded or assumed.
 */
export type GatewaySnapshot = {
  /** null until the first probe finishes. */
  reachable: boolean | null
  version: string | null
  user: GatewayUser | null
  status: GatewayStatus | null
  /** Human-readable reason for the last probe failure. */
  error: string | null
  checking: boolean
  checkedAt: number | null
}

const EMPTY: GatewaySnapshot = {
  reachable: null,
  version: null,
  user: null,
  status: null,
  error: null,
  checking: false,
  checkedAt: null,
}

let snapshot: GatewaySnapshot = EMPTY
const listeners = new Set<() => void>()
let started = false
let refreshPromise: Promise<void> | null = null

function emit(next: GatewaySnapshot): void {
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // The first subscriber starts a single real probe for the page.
  ensureGatewayLoaded()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): GatewaySnapshot {
  return snapshot
}

export function useGateway(): GatewaySnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getGatewaySnapshot(): GatewaySnapshot {
  return snapshot
}

/**
 * Probes the gateway once per page load, then on demand. A failed probe is a
 * real state, never an assumed "offline" placeholder.
 */
export function ensureGatewayLoaded(): void {
  if (started) {
    return
  }
  started = true
  void refreshGateway()
}

export function refreshGateway(): Promise<void> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    emit({ ...snapshot, checking: true })
    const probe = await probeGateway()

    if (!probe.reachable) {
      emit({
        reachable: false,
        version: probe.version,
        user: null,
        status: null,
        error: probe.message,
        checking: false,
        checkedAt: Date.now(),
      })
      return
    }

    if (!probe.user) {
      emit({
        reachable: true,
        version: probe.version,
        user: null,
        status: null,
        error: null,
        checking: false,
        checkedAt: Date.now(),
      })
      return
    }

    try {
      const status = await fetchGatewayStatus()
      emit({
        reachable: true,
        version: probe.version,
        user: probe.user,
        status,
        error: null,
        checking: false,
        checkedAt: Date.now(),
      })
    } catch (cause) {
      emit({
        reachable: true,
        version: probe.version,
        user: probe.user,
        status: null,
        error:
          cause instanceof AiError
            ? cause.message
            : 'The API answered, but AI status could not be read.',
        checking: false,
        checkedAt: Date.now(),
      })
    }
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export async function gatewaySignIn(email: string, password: string): Promise<void> {
  await signInWithGateway({ email: email.trim(), password })
  await refreshGateway()
}

export async function gatewayRegister(
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  await registerWithGateway({
    email: email.trim(),
    password,
    displayName: displayName.trim(),
  })
  await refreshGateway()
}

export async function gatewaySignOut(): Promise<void> {
  try {
    await signOutOfGateway()
  } finally {
    await refreshGateway()
  }
}

export function applyGatewayStatus(status: GatewayStatus): void {
  emit({ ...snapshot, status, reachable: true, error: null })
}
