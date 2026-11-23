/**
 * CodePilot Lab — local terminal bridge.
 *
 * A real PTY (node-pty / ConPTY on Windows) hosted by the loopback sidecar and
 * streamed to the SPA over WebSocket. It is genuine local shell access on the
 * machine that runs the service: not a sandbox, not cloud isolation.
 *
 * Guard rails (see docs/security.md):
 *   - the IPC stays bound to loopback by the host process,
 *   - the WebSocket handshake requires an allowed Origin,
 *   - and a per-start pairing token that is only printed on the service console.
 *
 * Protocol (JSON text frames):
 *   server → client  { type: 'ready', shell, cwd, pid, cols, rows }
 *                    { type: 'output', data }
 *                    { type: 'exit', exitCode, signal }
 *                    { type: 'error', message }
 *   client → server  { type: 'input', data }
 *                    { type: 'resize', cols, rows }
 *                    { type: 'cwd', path }
 */

import { spawnSync } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import pty from 'node-pty'
import { WebSocket, WebSocketServer } from 'ws'

const MAX_SESSIONS = 4
const MAX_FRAME_BYTES = 64 * 1024
const COLS = { min: 20, max: 400, initial: 100 }
const ROWS = { min: 5, max: 200, initial: 30 }

export function defaultShellForPlatform(platform = process.platform) {
  if (platform === 'win32') {
    return process.env.CODEPILOT_TERMINAL_SHELL || 'powershell.exe'
  }
  return process.env.CODEPILOT_TERMINAL_SHELL || process.env.SHELL || '/bin/bash'
}

export function shellForPlatform(platform = process.platform, candidate = null) {
  if (candidate && typeof candidate === 'string' && candidate.trim()) {
    const trimmed = candidate.trim()
    if (platform === 'win32') {
      const lower = trimmed.toLowerCase()
      if (lower.includes('powershell') || lower === 'pwsh' || lower === 'powershell.exe') {
        return 'powershell.exe'
      }
      if (lower.includes('cmd') || lower === 'cmd.exe') {
        return process.env.COMSPEC || 'cmd.exe'
      }
    }
    return trimmed
  }
  return defaultShellForPlatform(platform)
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function safeEqual(candidate, expected) {
  if (!candidate || !expected) {
    return false
  }
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    return false
  }
  return timingSafeEqual(a, b)
}

/**
 * Kills the whole process tree. node-pty's own `kill()` relies on a helper
 * process that needs console access, which fails when the service is started
 * without one, so Windows uses taskkill /T and POSIX kills the pty leader.
 */
function killTree(proc) {
  if (!proc) {
    return
  }
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      return
    }
    proc.kill('SIGKILL')
  } catch {
    // The process already ended; nothing to clean up.
  }
}

function initialCwd(requested) {
  if (requested) {
    try {
      if (statSync(requested).isDirectory()) {
        return resolve(requested)
      }
    } catch {
      // Fall through to the service's own directory.
    }
  }
  return process.cwd()
}

export function createTerminalHub({
  origins,
  requestedCwd = process.env.CODEPILOT_TERMINAL_CWD || '',
  token = (process.env.CODEPILOT_TERMINAL_TOKEN || '').trim() || randomBytes(9).toString('base64url'),
  log = console,
} = {}) {
  const allowedOrigins = origins instanceof Set ? origins : new Set(origins ?? [])
  const generated = !(process.env.CODEPILOT_TERMINAL_TOKEN || '').trim()
  let cwd = initialCwd(requestedCwd)
  const sessions = new Set()
  let wss = null

  const health = () => ({
    ok: true,
    service: 'codepilot-terminal',
    platform: process.platform,
    shell: shellForPlatform(),
    availableShells:
      process.platform === 'win32'
        ? ['powershell.exe', 'cmd.exe']
        : ['/bin/bash', '/bin/sh'],
    cwd,
    pairingRequired: true,
    sandboxed: false,
    note: 'A real shell on the machine hosting this service. Not a sandbox and not cloud isolation.',
    limits: {
      sessions: MAX_SESSIONS,
      cols: [COLS.min, COLS.max],
      rows: [ROWS.min, ROWS.max],
    },
    cloud: {
      available: false,
      reason:
        'No cloud terminal runtime is configured in this build. Only the local companion is available.',
    },
  })

  function attach(server) {
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })

    server.on('upgrade', (request, socket, head) => {
      let url
      try {
        url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      } catch {
        socket.destroy()
        return
      }

      if (url.pathname !== '/terminal') {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }

      const origin = request.headers.origin
      if (!origin || !allowedOrigins.has(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }

      if (!safeEqual(url.searchParams.get('token') ?? '', token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }

      if (sessions.size >= MAX_SESSIONS) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }

      const requestedShell = url.searchParams.get('shell')
      wss.handleUpgrade(request, socket, head, (ws) => startSession(ws, requestedShell))
    })

    return wss
  }

  function startSession(ws, initialShell = null) {
    const session = { proc: null, closed: false, ws }
    sessions.add(session)
    let currentShell = shellForPlatform(process.platform, initialShell)

    const send = (payload) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload))
      }
    }

    const stop = () => {
      if (session.closed) {
        return
      }
      session.closed = true
      const proc = session.proc
      session.proc = null
      killTree(proc)
      sessions.delete(session)
    }

    const spawnShell = (shellOverride = null) => {
      if (shellOverride) {
        currentShell = shellForPlatform(process.platform, shellOverride)
      }
      const proc = pty.spawn(currentShell, [], {
        name: 'xterm-256color',
        cols: COLS.initial,
        rows: ROWS.initial,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      })
      session.proc = proc
      send({
        type: 'ready',
        shell: currentShell,
        cwd,
        pid: proc.pid,
        cols: COLS.initial,
        rows: ROWS.initial,
      })

      proc.onData((data) => send({ type: 'output', data }))
      proc.onExit(({ exitCode, signal }) => {
        // A cwd change replaces the process; the old shell's exit is not the
        // session's exit and must not be reported as one.
        if (session.proc !== proc) {
          return
        }
        session.proc = null
        send({ type: 'exit', exitCode, signal: signal ?? null })
      })
    }

    try {
      spawnShell()
    } catch (error) {
      send({
        type: 'error',
        message: `The shell could not start: ${error instanceof Error ? error.message : 'unknown error'}`,
      })
      stop()
      ws.close()
      return
    }

    ws.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        send({ type: 'error', message: 'The terminal received a frame that is not JSON.' })
        return
      }

      if (!message || typeof message.type !== 'string') {
        return
      }

      if (message.type === 'input') {
        if (typeof message.data === 'string' && session.proc) {
          session.proc.write(message.data)
        }
        return
      }

      if (message.type === 'resize') {
        if (!session.proc) {
          return
        }
        const cols = clamp(message.cols, COLS.min, COLS.max, COLS.initial)
        const rows = clamp(message.rows, ROWS.min, ROWS.max, ROWS.initial)
        try {
          session.proc.resize(cols, rows)
        } catch {
          // ConPTY rejects resizes on a dead process; the exit event follows.
        }
        return
      }

      if (message.type === 'cwd') {
        if (typeof message.path !== 'string' || !message.path.trim()) {
          send({ type: 'error', message: 'A working directory path is required.' })
          return
        }
        const next = resolve(message.path.trim())
        try {
          if (!statSync(next).isDirectory()) {
            send({ type: 'error', message: `${next} is not a directory.` })
            return
          }
        } catch {
          send({ type: 'error', message: `${next} does not exist on this machine.` })
          return
        }

        // The shell owns its directory, so a new folder means a new session.
        const proc = session.proc
        session.proc = null
        killTree(proc)
        cwd = next
        try {
          spawnShell()
        } catch (error) {
          send({
            type: 'error',
            message: `The shell could not start in ${cwd}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          })
        }
      }

      if (message.type === 'shell') {
        if (typeof message.shell === 'string' && message.shell.trim()) {
          const proc = session.proc
          session.proc = null
          killTree(proc)
          try {
            spawnShell(message.shell.trim())
          } catch (error) {
            send({
              type: 'error',
              message: `The shell could not switch to ${message.shell}: ${
                error instanceof Error ? error.message : 'unknown error'
              }`,
            })
          }
        }
        return
      }
    })

    ws.on('close', stop)
    ws.on('error', stop)
  }

  function closeAll() {
    for (const session of [...sessions]) {
      const proc = session.proc
      session.proc = null
      session.closed = true
      killTree(proc)
      sessions.delete(session)
    }
    // Close the upgraded sockets too, otherwise `server.close()` never settles.
    if (wss) {
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close()
      wss = null
    }
  }

  function describe() {
    return {
      shell: shellForPlatform(),
      cwd,
      token,
      generated,
    }
  }

  return { attach, closeAll, describe, health, sessions: () => sessions.size, log }
}
