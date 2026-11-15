import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp, type RunningApp } from '../src/app.ts'
import { buildConfig, type AppConfig } from '../src/config/env.ts'
import { MemoryStore } from '../src/db/memoryStore.ts'

const ORIGIN = 'http://localhost:5173'

type RequestOptions = {
  method?: string
  body?: unknown
  cookie?: string
  origin?: string | null
}

function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return buildConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '8787',
    DATABASE_URL: '',
    CORS_ORIGINS: ORIGIN,
    SESSION_COOKIE_SECURE: 'false',
    CREDENTIAL_ENCRYPTION_KEY: '',
    ALLOW_PRIVATE_AI_ENDPOINTS: 'true',
    ...overrides,
  } as NodeJS.ProcessEnv)
}

async function listen(app: RunningApp): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', () => {
      app.server.off('error', reject)
      resolve()
    })
  })
  const address = app.server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function request(
  base: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers = new Headers()
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (options.cookie) {
    headers.set('Cookie', options.cookie)
  }
  if (options.origin !== null) {
    headers.set('Origin', options.origin ?? ORIGIN)
  }
  return fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

function cookieFrom(response: Response): string {
  const value = response.headers.get('set-cookie')
  if (!value) {
    throw new Error('The response did not set a session cookie.')
  }
  return value.split(';')[0] ?? ''
}

let base = ''
let app: RunningApp

beforeAll(async () => {
  app = await createApp({ config: testConfig(), store: new MemoryStore() })
  base = await listen(app)
})

afterAll(async () => {
  if (app) {
    await app.close()
  }
})

describe('API health and sessions', () => {
  it('reports honest health with the in-memory store', async () => {
    const response = await request(base, '/api/health')
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      ok: boolean
      service: string
      database: { engine: string; durable: boolean }
      managedAi: { available: boolean }
    }
    expect(payload.ok).toBe(true)
    expect(payload.service).toBe('codepilot-api')
    expect(payload.database.engine).toBe('memory')
    expect(payload.database.durable).toBe(false)
    expect(payload.managedAi.available).toBe(false)
  })

  it('returns no user before sign-in', async () => {
    const response = await request(base, '/api/auth/session')
    const payload = (await response.json()) as { user: unknown }
    expect(response.status).toBe(200)
    expect(payload.user).toBeNull()
  })

  it('registers, resolves and deletes an account', async () => {
    const register = await request(base, '/api/auth/register', {
      method: 'POST',
      body: {
        email: 'alice@example.test',
        password: 'correct horse battery staple',
        displayName: 'Alice',
      },
    })
    expect(register.status).toBe(201)
    const cookie = cookieFrom(register)

    const session = await request(base, '/api/auth/session', { cookie })
    const sessionPayload = (await session.json()) as { user: { email: string } | null }
    expect(sessionPayload.user?.email).toBe('alice@example.test')

    const deletion = await request(base, '/api/account', {
      method: 'DELETE',
      cookie,
      body: { password: 'correct horse battery staple' },
    })
    expect(deletion.status).toBe(200)

    const after = await request(base, '/api/account', { cookie })
    expect(after.status).toBe(401)
  })
})

describe('project isolation and CSRF', () => {
  let aliceCookie = ''
  let bobCookie = ''
  let aliceProjectId = ''

  it('creates two independent accounts', async () => {
    const alice = await request(base, '/api/auth/register', {
      method: 'POST',
      body: {
        email: 'owner@example.test',
        password: 'correct horse battery staple',
        displayName: 'Owner',
      },
    })
    const bob = await request(base, '/api/auth/register', {
      method: 'POST',
      body: {
        email: 'other@example.test',
        password: 'correct horse battery staple',
        displayName: 'Other',
      },
    })
    expect(alice.status).toBe(201)
    expect(bob.status).toBe(201)
    aliceCookie = cookieFrom(alice)
    bobCookie = cookieFrom(bob)
  })

  it('creates a project owned by the first account', async () => {
    const response = await request(base, '/api/projects', {
      method: 'POST',
      cookie: aliceCookie,
      body: { name: 'Owner project', language: 'python' },
    })
    expect(response.status).toBe(201)
    const payload = (await response.json()) as { project: { id: string } }
    aliceProjectId = payload.project.id
  })

  it('returns 404 when another user requests the project', async () => {
    const response = await request(base, `/api/projects/${aliceProjectId}`, {
      cookie: bobCookie,
    })
    expect(response.status).toBe(404)
  })

  it('rejects a state-changing request without an Origin header', async () => {
    const response = await request(base, '/api/projects', {
      method: 'POST',
      cookie: aliceCookie,
      origin: null,
      body: { name: 'No origin', language: 'python' },
    })
    expect(response.status).toBe(403)
  })

  it('rejects a disallowed origin', async () => {
    const response = await request(base, '/api/projects', {
      method: 'POST',
      cookie: aliceCookie,
      origin: 'https://attacker.example',
      body: { name: 'Bad origin', language: 'python' },
    })
    expect(response.status).toBe(403)
  })

  it('exposes AI status without leaking a credential', async () => {
    const response = await request(base, '/api/ai/status', { cookie: aliceCookie })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('"connection":null')
    expect(text).toContain('"available":false')
    expect(text.toLowerCase()).not.toContain('apikey')
    expect(text.toLowerCase()).not.toContain('encryptedapikey')
  })

  it('rejects an empty chat request before starting a stream', async () => {
    const response = await request(base, '/api/ai/chat', {
      method: 'POST',
      cookie: aliceCookie,
      body: { messages: [] },
    })
    expect(response.status).toBe(400)
  })

  it('stores a file for the first account only', async () => {
    const save = await request(base, `/api/projects/${aliceProjectId}/files`, {
      method: 'POST',
      cookie: aliceCookie,
      body: { path: 'main.py', content: 'print("owner")\n' },
    })
    expect(save.status).toBe(200)

    const bobRead = await request(base, `/api/projects/${aliceProjectId}/files`, {
      cookie: bobCookie,
    })
    expect(bobRead.status).toBe(404)
  })

  it('stores a BYO credential for the first account only', async () => {
    const secret = 'sk-fixture-secret-do-not-export'
    const save = await request(base, '/api/ai/connection', {
      method: 'PUT',
      cookie: aliceCookie,
      body: {
        provider: 'openai-compatible',
        label: 'Fixture provider',
        baseUrl: 'https://provider.example/v1',
        model: 'fixture-model',
        apiKey: secret,
      },
    })
    expect(save.status).toBe(200)

    const bobStatus = await request(base, '/api/ai/status', { cookie: bobCookie })
    expect(bobStatus.status).toBe(200)
    const bobText = await bobStatus.text()
    expect(bobText).toContain('"connection":null')
    expect(bobText).not.toContain(secret)
  })

  it('exports the authenticated account without credentials or other users', async () => {
    const response = await request(base, '/api/account/export', { cookie: aliceCookie })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain(
      'attachment; filename="codepilot-account-',
    )

    const text = await response.text()
    const payload = JSON.parse(text) as {
      user: { email: string }
      projects: Array<{ name: string; files: Array<{ path: string; content: string }> }>
      ai: { connection: { keyLast4: string; hasKey: boolean } | null }
      notIncluded: string[]
    }

    expect(payload.user.email).toBe('owner@example.test')
    expect(payload.projects).toHaveLength(1)
    expect(payload.projects[0]?.name).toBe('Owner project')
    expect(payload.projects[0]?.files).toEqual([
      expect.objectContaining({ path: 'main.py', content: 'print("owner")\n' }),
    ])
    expect(payload.ai.connection?.hasKey).toBe(true)
    expect(payload.ai.connection?.keyLast4).toBe('port')

    expect(text).not.toContain('sk-fixture-secret-do-not-export')
    expect(text).not.toContain('encryptedApiKey')
    expect(text).not.toContain('passwordHash')
    expect(text).not.toContain('tokenHash')
    expect(text).not.toContain('other@example.test')

    const bobExport = await request(base, '/api/account/export', { cookie: bobCookie })
    const bobText = await bobExport.text()
    expect(bobText).toContain('"projects":[]')
    expect(bobText).not.toContain('Owner project')
    expect(bobText).not.toContain('main.py')
  })

  it('deletes the account and revokes its session', async () => {
    const deletion = await request(base, '/api/account', {
      method: 'DELETE',
      cookie: aliceCookie,
      body: { password: 'correct horse battery staple' },
    })
    expect(deletion.status).toBe(200)

    const after = await request(base, '/api/account/export', { cookie: aliceCookie })
    expect(after.status).toBe(401)

    const bobProjects = await request(base, '/api/projects', { cookie: bobCookie })
    const bobPayload = (await bobProjects.json()) as { projects: unknown[] }
    expect(bobPayload.projects).toEqual([])
  })
})

describe('managed AI streaming and quota', () => {
  let managedApp: RunningApp
  let managedBase = ''
  let managedCookie = ''

  beforeAll(async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/chat/completions')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
                  'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
                  'data: [DONE]\n\n',
              ),
            )
            controller.close()
          },
        })
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    managedApp = await createApp({
      config: testConfig({
        MANAGED_AI_BASE_URL: 'https://provider.example/v1',
        MANAGED_AI_API_KEY: 'test-key-not-real',
        MANAGED_AI_MODEL: 'test-model',
        MANAGED_AI_DAILY_REQUESTS: '1',
      }),
      store: new MemoryStore(),
      fetchImpl: fakeFetch,
    })
    managedBase = await listen(managedApp)

    const register = await request(managedBase, '/api/auth/register', {
      method: 'POST',
      body: {
        email: 'managed@example.test',
        password: 'correct horse battery staple',
        displayName: 'Managed',
      },
    })
    expect(register.status).toBe(201)
    managedCookie = cookieFrom(register)
  })

  afterAll(async () => {
    if (managedApp) {
      await managedApp.close()
    }
  })

  it('streams a real provider response as SSE events', async () => {
    const response = await request(managedBase, '/api/ai/chat', {
      method: 'POST',
      cookie: managedCookie,
      body: { messages: [{ role: 'user', content: 'Say hello.' }] },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('"type":"meta"')
    expect(text).toContain('"mode":"managed"')
    expect(text).toContain('"text":"Hello"')
    expect(text).toContain('"text":" world"')
    expect(text).toContain('"type":"done"')
  })

  it('reports the daily quota instead of calling the provider again', async () => {
    const response = await request(managedBase, '/api/ai/chat', {
      method: 'POST',
      cookie: managedCookie,
      body: { messages: [{ role: 'user', content: 'Again.' }] },
    })
    const text = await response.text()
    expect(text).toContain('"type":"error"')
    expect(text).toContain('"code":"rate_limited"')
    expect(text).toContain('daily request limit')
  })
})

describe('GitHub configuration gate', () => {
  type GithubPayload = {
    configured: boolean
    missing: string[]
    present: Record<string, boolean>
    actionsAvailable: boolean
    note: string
  }

  it('requires a signed-in session', async () => {
    const response = await request(base, '/api/github/status')
    expect(response.status).toBe(401)
  })

  it('reports every missing variable without inventing a connection', async () => {
    const register = await request(base, '/api/auth/register', {
      method: 'POST',
      body: {
        email: 'github-unconfigured@example.test',
        password: 'correct horse battery staple',
        displayName: 'GitHub unconfigured',
      },
    })
    expect(register.status).toBe(201)
    const cookie = cookieFrom(register)

    const response = await request(base, '/api/github/status', { cookie })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as GithubPayload

    expect(payload.configured).toBe(false)
    expect(payload.missing).toEqual([
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GITHUB_CALLBACK_URL',
    ])
    expect(payload.present).toEqual({
      appId: false,
      privateKey: false,
      clientId: false,
      clientSecret: false,
      callbackUrl: false,
    })
    expect(payload.actionsAvailable).toBe(false)
    expect(payload.note).toContain('not configured')
  })

  it('reports present credentials without returning their values', async () => {
    const clientSecret = 'fixture-client-secret-do-not-leak'
    const privateKey = 'fixture-private-key-do-not-leak'
    const configured = await createApp({
      config: testConfig({
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: privateKey,
        GITHUB_CLIENT_ID: 'Iv1.test',
        GITHUB_CLIENT_SECRET: clientSecret,
        GITHUB_CALLBACK_URL: 'https://example.test/api/github/callback',
      }),
      store: new MemoryStore(),
    })
    const configuredBase = await listen(configured)

    try {
      const register = await request(configuredBase, '/api/auth/register', {
        method: 'POST',
        body: {
          email: 'github-configured@example.test',
          password: 'correct horse battery staple',
          displayName: 'GitHub configured',
        },
      })
      expect(register.status).toBe(201)
      const cookie = cookieFrom(register)

      const response = await request(configuredBase, '/api/github/status', { cookie })
      expect(response.status).toBe(200)
      const text = await response.text()
      const payload = JSON.parse(text) as GithubPayload

      expect(payload.configured).toBe(true)
      expect(payload.missing).toEqual([])
      expect(payload.present).toEqual({
        appId: true,
        privateKey: true,
        clientId: true,
        clientSecret: true,
        callbackUrl: true,
      })
      expect(payload.actionsAvailable).toBe(false)
      expect(text).not.toContain(clientSecret)
      expect(text).not.toContain('do-not-leak')
      expect(text).not.toContain('fixture-')
    } finally {
      await configured.close()
    }
  })
})

describe('session management', () => {
  let sessionApp: RunningApp
  let sessionBase = ''
  const password = 'correct horse battery staple'

  beforeAll(async () => {
    sessionApp = await createApp({ config: testConfig(), store: new MemoryStore() })
    sessionBase = await listen(sessionApp)
  })

  afterAll(async () => {
    if (sessionApp) {
      await sessionApp.close()
    }
  })

  async function register(email: string): Promise<string> {
    const response = await request(sessionBase, '/api/auth/register', {
      method: 'POST',
      body: { email, password, displayName: email.split('@')[0] },
    })
    expect(response.status).toBe(201)
    return cookieFrom(response)
  }

  async function login(email: string): Promise<string> {
    const response = await request(sessionBase, '/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    expect(response.status).toBe(200)
    return cookieFrom(response)
  }

  type SessionsPayload = {
    currentSessionId: string | null
    sessions: Array<{ id: string; createdAt: number; lastSeenAt: number; expiresAt: number }>
  }

  it('lists only this account sessions without token hashes', async () => {
    const first = await register('sessions-a@example.test')
    const second = await login('sessions-a@example.test')

    const response = await request(sessionBase, '/api/account/sessions', { cookie: second })
    expect(response.status).toBe(200)
    const text = await response.text()
    const payload = JSON.parse(text) as SessionsPayload

    expect(payload.sessions).toHaveLength(2)
    expect(payload.currentSessionId).not.toBeNull()
    expect(payload.sessions.map((session) => session.id)).toContain(payload.currentSessionId)
    expect(text).not.toContain('tokenHash')
    expect(text).not.toContain('token_hash')
    for (const session of payload.sessions) {
      expect(typeof session.createdAt).toBe('number')
      expect(typeof session.lastSeenAt).toBe('number')
      expect(typeof session.expiresAt).toBe('number')
    }

    // Another account can neither see nor revoke these sessions.
    const bobCookie = await register('sessions-b@example.test')
    const bobSessions = await request(sessionBase, '/api/account/sessions', { cookie: bobCookie })
    const bobPayload = (await bobSessions.json()) as SessionsPayload
    expect(bobPayload.sessions).toHaveLength(1)

    const foreignRevoke = await request(
      sessionBase,
      `/api/account/sessions/${payload.sessions[0]?.id ?? 'missing'}`,
      { method: 'DELETE', cookie: bobCookie },
    )
    expect(foreignRevoke.status).toBe(404)

    const firstStillValid = await request(sessionBase, '/api/auth/session', { cookie: first })
    const firstPayload = (await firstStillValid.json()) as { user: { email: string } | null }
    expect(firstPayload.user?.email).toBe('sessions-a@example.test')
  })

  it('revokes one named session and revokes every other session', async () => {
    const owner = await login('sessions-a@example.test')
    const listed = await request(sessionBase, '/api/account/sessions', { cookie: owner })
    const before = (await listed.json()) as SessionsPayload
    const other = before.sessions.find((session) => session.id !== before.currentSessionId)
    expect(other).toBeDefined()

    const revoke = await request(sessionBase, `/api/account/sessions/${other?.id}`, {
      method: 'DELETE',
      cookie: owner,
    })
    expect(revoke.status).toBe(200)

    const afterRevoke = await request(sessionBase, '/api/account/sessions', { cookie: owner })
    const afterRevokePayload = (await afterRevoke.json()) as SessionsPayload
    expect(afterRevokePayload.sessions.map((session) => session.id)).not.toContain(other?.id)

    // A second live session, then revoke-others keeps the caller signed in.
    await login('sessions-a@example.test')
    const revokeOthers = await request(sessionBase, '/api/account/sessions/revoke-others', {
      method: 'POST',
      cookie: owner,
    })
    expect(revokeOthers.status).toBe(200)
    const revokeOthersPayload = (await revokeOthers.json()) as { revoked: number }
    expect(revokeOthersPayload.revoked).toBeGreaterThan(0)

    const remaining = await request(sessionBase, '/api/account/sessions', { cookie: owner })
    const remainingPayload = (await remaining.json()) as SessionsPayload
    expect(remainingPayload.sessions).toHaveLength(1)
    expect(remainingPayload.sessions[0]?.id).toBe(remainingPayload.currentSessionId)
  })

  it('includes session metadata in the account export without secrets', async () => {
    const cookie = await login('sessions-a@example.test')
    const response = await request(sessionBase, '/api/account/export', { cookie })
    expect(response.status).toBe(200)
    const text = await response.text()
    const payload = JSON.parse(text) as {
      sessions: Array<{ id: string; createdAt: number }>
    }
    expect(Array.isArray(payload.sessions)).toBe(true)
    expect(payload.sessions.length).toBeGreaterThan(0)
    expect(text).not.toContain('tokenHash')
    expect(text).not.toContain('passwordHash')
  })
})