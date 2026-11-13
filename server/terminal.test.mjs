import { createServer } from 'node:http'

import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { createTerminalHub, shellForPlatform } from './terminal.mjs'

const ORIGIN = 'http://localhost:5173'
const TOKEN = 'test-pairing-token'

/** Starts a hub on an ephemeral port and returns its base URL plus helpers. */
async function startHub(options = {}) {
  const hub = createTerminalHub({ origins: new Set([ORIGIN]), token: TOKEN, log: { log() {}, error() {} }, ...options })
  const server = createServer((request, response) => {
    if (request.url === '/terminal/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(hub.health()))
      return
    }
    response.writeHead(404)
    response.end()
  })
  hub.attach(server)

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    hub,
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        hub.closeAll()
        server.close(() => resolve())
      }),
  }
}

function openSocket(base, { origin = ORIGIN, token = TOKEN } = {}) {
  const url = `${base.replace('http', 'ws')}/terminal?token=${encodeURIComponent(token)}`
  return new WebSocket(url, { origin })
}

/** Waits for the first frame that satisfies `match`, with a hard timeout. */
function waitForFrame(socket, match, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for a terminal frame.'))
    }, timeoutMs)

    const onMessage = (raw) => {
      const frame = JSON.parse(raw.toString())
      if (match(frame)) {
        cleanup()
        resolve(frame)
      }
    }

    const onClose = () => {
      cleanup()
      reject(new Error('Socket closed before the expected frame arrived.'))
    }

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      socket.off('close', onClose)
    }

    socket.on('message', onMessage)
    socket.on('close', onClose)
  })
}

/** Collects every frame until `done` returns true (or the socket closes). */
function collectUntil(socket, done, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const frames = []
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out. Saw: ${frames.map((f) => f.type).join(', ')}`))
    }, timeoutMs)

    const onMessage = (raw) => {
      const frame = JSON.parse(raw.toString())
      frames.push(frame)
      if (done(frames)) {
        cleanup()
        resolve(frames)
      }
    }

    const onClose = () => {
      cleanup()
      resolve(frames)
    }

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      socket.off('close', onClose)
    }

    socket.on('message', onMessage)
    socket.on('close', onClose)
  })
}

describe('terminal hub health', () => {
  it('reports the shell, cwd, pairing requirement and unavailable cloud mode', async () => {
    const ctx = await startHub()
    try {
      const response = await fetch(`${ctx.base}/terminal/health`)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.service).toBe('codepilot-terminal')
      expect(body.shell).toBe(shellForPlatform())
      expect(body.pairingRequired).toBe(true)
      expect(body.sandboxed).toBe(false)
      expect(body.cloud.available).toBe(false)
      expect(body.cloud.reason).toMatch(/no cloud terminal runtime/i)
      expect(body.note).toMatch(/not a sandbox/i)
      // The pairing token is never exposed over HTTP.
      expect(JSON.stringify(body)).not.toContain(TOKEN)
    } finally {
      await ctx.close()
    }
  })

  it('starts in the requested directory when it exists, and ignores a missing one', async () => {
    const ctx = await startHub({ requestedCwd: process.cwd() })
    try {
      const body = await (await fetch(`${ctx.base}/terminal/health`)).json()
      expect(body.cwd.toLowerCase()).toContain(process.cwd().split(/[\\/]/).pop().toLowerCase())
    } finally {
      await ctx.close()
    }
  })
})

describe('terminal hub handshake', () => {
  it('rejects a disallowed origin', async () => {
    const ctx = await startHub()
    try {
      const socket = openSocket(ctx.base, { origin: 'http://evil.example' })
      const error = await new Promise((resolve) => socket.on('error', resolve))
      expect(String(error.message)).toMatch(/403/)
    } finally {
      await ctx.close()
    }
  })

  it('rejects a wrong or missing pairing token', async () => {
    const ctx = await startHub()
    try {
      const socket = openSocket(ctx.base, { token: 'not-the-token' })
      const error = await new Promise((resolve) => socket.on('error', resolve))
      expect(String(error.message)).toMatch(/401/)
    } finally {
      await ctx.close()
    }
  })
})

describe('terminal session', () => {
  it('spawns a real shell, streams output, accepts resize and reports exit', async () => {
    const ctx = await startHub()
    try {
      const socket = openSocket(ctx.base)
      const ready = await waitForFrame(socket, (frame) => frame.type === 'ready')
      expect(ready.shell).toBe(shellForPlatform())
      expect(ready.pid).toBeGreaterThan(0)
      expect(ready.cols).toBeGreaterThan(0)

      socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
      socket.send(JSON.stringify({ type: 'input', data: 'echo code-pilot-marker\r' }))

      const frames = await collectUntil(socket, (seen) =>
        seen.some((frame) => frame.type === 'output' && frame.data.includes('code-pilot-marker')),
      )
      expect(frames.some((frame) => frame.type === 'output')).toBe(true)

      socket.send(JSON.stringify({ type: 'input', data: 'exit\r' }))
      const after = await collectUntil(socket, (seen) => seen.some((frame) => frame.type === 'exit'))
      expect(after.some((frame) => frame.type === 'exit')).toBe(true)
    } finally {
      await ctx.close()
    }
  }, 30_000)

  it('changes the working directory by restarting the shell there', async () => {
    const ctx = await startHub()
    try {
      const socket = openSocket(ctx.base)
      await waitForFrame(socket, (frame) => frame.type === 'ready')

      const target = process.cwd()
      socket.send(JSON.stringify({ type: 'cwd', path: target }))
      const second = await waitForFrame(socket, (frame) => frame.type === 'ready')
      expect(second.cwd.toLowerCase()).toBe(target.toLowerCase())

      socket.send(JSON.stringify({ type: 'cwd', path: 'definitely-not-a-real-directory-xyz' }))
      const error = await waitForFrame(socket, (frame) => frame.type === 'error')
      expect(error.message).toMatch(/does not exist/i)
    } finally {
      await ctx.close()
    }
  }, 30_000)

  it('closes every session and its process on shutdown', async () => {
    const ctx = await startHub()
    const socket = openSocket(ctx.base)
    await waitForFrame(socket, (frame) => frame.type === 'ready')
    expect(ctx.hub.sessions()).toBe(1)

    const closed = new Promise((resolve) => socket.on('close', resolve))
    await ctx.close()
    await closed
    expect(ctx.hub.sessions()).toBe(0)
  }, 30_000)
})
