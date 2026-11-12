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
