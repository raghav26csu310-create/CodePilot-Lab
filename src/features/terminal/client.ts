/**
 * Client for the local terminal bridge (server/terminal.mjs).
 *
 * The browser never starts a shell itself: it opens a WebSocket to the
 * loopback sidecar, which owns the real PTY. The socket is only opened after a
 * health probe succeeds, and the pairing token is kept in sessionStorage so it
 * dies with the tab instead of being written to disk.
 */

import { getExecEndpoint } from '../execution/api'

const TOKEN_KEY = 'codepilot.terminal.token.v1'

export type TerminalFrame =
  | {
      type: 'ready'
      shell: string
      cwd: string
      pid: number
      cols: number
      rows: number
    }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number; signal: string | null }
  | { type: 'error'; message: string }

export type TerminalLimits = {
  sessions: number
  cols: [number, number]
  rows: [number, number]
}

export type TerminalHealth = {
  ok: boolean
  service: string
  platform: string
  shell: string
  availableShells?: string[]
  cwd: string
  pairingRequired: boolean
  sandboxed: boolean
  note: string
  limits: TerminalLimits
  cloud: { available: boolean; reason: string }
}

export type TerminalErrorKind = 'unreachable' | 'rejected' | 'invalid-response'

export class TerminalServiceError extends Error {
  kind: TerminalErrorKind

  constructor(kind: TerminalErrorKind, message: string) {
    super(message)
    this.name = 'TerminalServiceError'
    this.kind = kind
  }
}

let memoryToken = ''

export function getTerminalToken(): string {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(TOKEN_KEY)?.trim() ?? ''
    }
  } catch {
    // SessionStorage inaccessible
  }
  return memoryToken
}

export function setTerminalToken(token: string): void {
  const cleaned = token.trim()
  memoryToken = cleaned
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (cleaned) {
        window.sessionStorage.setItem(TOKEN_KEY, cleaned)
      } else {
        window.sessionStorage.removeItem(TOKEN_KEY)
      }
    }
  } catch {
    // The token only lives for this tab; losing the preference is honest.
  }
}

function terminalBase(): string {
  return getExecEndpoint()
}

export function terminalSocketUrl(token: string, shell?: string): string {
  const base = terminalBase().replace(/^http/, 'ws')
  const params = new URLSearchParams()
  params.set('token', token)
  if (shell) {
    params.set('shell', shell)
  }
  return `${base}/terminal?${params.toString()}`
}

/** Probes the sidecar. Never resolves a fabricated health object. */
export async function fetchTerminalHealth(timeoutMs = 4_000): Promise<TerminalHealth> {
  const endpoint = terminalBase()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${endpoint}/terminal/health`, {
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new TerminalServiceError(
        response.status === 404 ? 'unreachable' : 'invalid-response',
        response.status === 404
          ? `The service at ${endpoint} has no terminal endpoint. Restart it with "npm run exec" so the current build is loaded.`
          : `The terminal service answered ${response.status}.`,
      )
    }
    const body = (await response.json()) as Partial<TerminalHealth>
    if (body.service !== 'codepilot-terminal' || body.ok !== true) {
      throw new TerminalServiceError(
        'invalid-response',
        `The service at ${endpoint} answered, but not as the terminal bridge.`,
      )
    }
    return body as TerminalHealth
  } catch (error) {
    if (error instanceof TerminalServiceError) {
      throw error
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TerminalServiceError(
        'unreachable',
        `The terminal service at ${endpoint} did not answer within ${timeoutMs} ms.`,
      )
    }
    throw new TerminalServiceError(
      'unreachable',
      `The terminal service at ${endpoint} is offline. Start the local companion with "npm run exec" in the project folder.`,
    )
  } finally {
    window.clearTimeout(timer)
  }
}

export type TerminalConnection = {
  sendInput: (data: string) => void
  resize: (cols: number, rows: number) => void
  changeCwd: (path: string) => void
  switchShell: (shell: string) => void
  kill: () => void
  close: () => void
}

export type TerminalCloseInfo = {
  code: number
  /** True when the browser itself closed the socket (user pressed Disconnect). */
  intentional: boolean
}

/**
 * Opens the WebSocket. The caller must have probed health first; a handshake
 * failure here usually means a wrong pairing token or a disallowed Origin, and
 * the message says exactly that instead of guessing.
 */
export function connectTerminal({
  token,
  shell,
  onFrame,
  onClose,
}: {
  token: string
  shell?: string
  onFrame: (frame: TerminalFrame) => void
  onClose: (info: TerminalCloseInfo) => void
}): TerminalConnection {
  const socket = new WebSocket(terminalSocketUrl(token, shell))
  let intentional = false

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      return
    }
    let frame: TerminalFrame
    try {
      frame = JSON.parse(event.data) as TerminalFrame
    } catch {
      return
    }
    if (frame && typeof frame.type === 'string') {
      onFrame(frame)
    }
  })

  socket.addEventListener('close', (event) => {
    onClose({ code: event.code, intentional })
  })

  socket.addEventListener('error', () => {
    // The close event carries the code; browsers hide handshake details here.
  })

  const send = (payload: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
    }
  }

  return {
    sendInput(data) {
      send({ type: 'input', data })
    },
    resize(cols, rows) {
      send({ type: 'resize', cols, rows })
    },
    changeCwd(path) {
      send({ type: 'cwd', path })
    },
    switchShell(targetShell) {
      send({ type: 'shell', shell: targetShell })
    },
    kill() {
      send({ type: 'kill' })
    },
    close() {
      intentional = true
      socket.close()
    },
  }
}

/** True for errors that came from the terminal bridge rather than user code. */
export function describeTerminalClose(info: TerminalCloseInfo): string {
  if (info.intentional) {
    return 'Disconnected.'
  }
  if (info.code === 1006) {
    return 'The terminal connection closed without a handshake. The pairing token may not match the one printed by "npm run exec", or the service was stopped.'
  }
  if (info.code === 1001) {
    return 'The terminal service is shutting down.'
  }
  return `The terminal connection closed (code ${info.code}).`
}
