import {
  CloudOff,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Square,
  Terminal as TerminalIcon,
  TriangleAlert,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import {
  connectTerminal,
  describeTerminalClose,
  fetchTerminalHealth,
  getTerminalToken,
  setTerminalToken,
  TerminalServiceError,
  type TerminalConnection,
  type TerminalFrame,
  type TerminalHealth,
} from './client'
import type { TerminalStream } from './TerminalSurface'
import styles from './TerminalPanel.module.css'

const TerminalSurface = lazy(() => import('./TerminalSurface'))

type Status = 'idle' | 'connecting' | 'ready' | 'exited'

type SessionInfo = {
  shell: string
  cwd: string
  pid: number
}

type ExitInfo = {
  exitCode: number
  signal: string | null
}

const CLOUD_REASON =
  'No cloud terminal runtime is configured in this build. Only the local companion is available.'

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) {
    return path
  }
  return `…/${parts.slice(-2).join('/')}`
}

/**
 * The Terminal tab.
 *
 * Local mode is a genuine PTY hosted by the loopback execution service: the
 * shell, its output and its exit code are real. Cloud mode is rendered as an
 * explicitly disabled option because this build has no cloud runtime — it is
 * never a fake prompt.
 */
export function TerminalPanel() {
  const [health, setHealth] = useState<TerminalHealth | null>(null)
  const [healthChecked, setHealthChecked] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [token, setToken] = useState(getTerminalToken)
  const [connection, setConnection] = useState<TerminalConnection | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [exitInfo, setExitInfo] = useState<ExitInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const connectionRef = useRef<TerminalConnection | null>(null)
  const streamRef = useRef<TerminalStream | null>(null)
  const pendingRef = useRef<string[]>([])

  const refreshHealth = useCallback(async () => {
    try {
      const next = await fetchTerminalHealth()
      setHealth(next)
      setProbeError(null)
    } catch (cause) {
      setHealth(null)
      setProbeError(
        cause instanceof TerminalServiceError
          ? cause.message
          : 'The terminal service did not answer.',
      )
    } finally {
      setHealthChecked(true)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshHealth()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshHealth])

  useEffect(
    () => () => {
      connectionRef.current?.close()
      connectionRef.current = null
    },
    [],
  )

  const handleFrame = useCallback((frame: TerminalFrame) => {
    if (frame.type === 'output') {
      const stream = streamRef.current
      if (stream) {
        stream.write(frame.data)
      } else {
        // The lazy renderer may still be loading; keep real output in order.
        pendingRef.current.push(frame.data)
      }
      return
    }
    if (frame.type === 'ready') {
      setSession({ shell: frame.shell, cwd: frame.cwd, pid: frame.pid })
      setStatus('ready')
      setExitInfo(null)
      return
    }
    if (frame.type === 'exit') {
      setStatus('exited')
      setExitInfo({ exitCode: frame.exitCode, signal: frame.signal })
      return
    }
    setError(frame.message)
  }, [])

  const connect = async () => {
    const cleaned = token.trim()
    if (!cleaned) {
      setError('Paste the pairing token printed on the service console by "npm run exec".')
      return
    }

    setStatus('connecting')
    setError(null)
    setExitInfo(null)
    setTerminalToken(cleaned)

    try {
      const nextHealth = await fetchTerminalHealth()
      setHealth(nextHealth)
      setProbeError(null)
      setHealthChecked(true)
      pendingRef.current = []

      const conn = connectTerminal({
        token: cleaned,
        onFrame: handleFrame,
        onClose: (info) => {
          if (connectionRef.current !== conn) {
            return
          }
          connectionRef.current = null
          streamRef.current = null
          pendingRef.current = []
          setConnection(null)
          setSession(null)
          setStatus('idle')
          if (!info.intentional) {
            setError(describeTerminalClose(info))
          }
        },
      })

      connectionRef.current = conn
      setConnection(conn)
    } catch (cause) {
      setHealth(null)
      setHealthChecked(true)
      setStatus('idle')
      setProbeError(
        cause instanceof TerminalServiceError
          ? cause.message
          : 'The terminal could not be opened.',
      )
    }
  }

  const disconnect = () => {
    const conn = connectionRef.current
    connectionRef.current = null
    streamRef.current = null
    pendingRef.current = []
    setConnection(null)
    setSession(null)
    setStatus('idle')
    setExitInfo(null)
    conn?.close()
  }

  const handleStreamReady = useCallback((stream: TerminalStream) => {
    streamRef.current = stream
    const pending = pendingRef.current
    pendingRef.current = []
    for (const chunk of pending) {
      stream.write(chunk)
    }
  }, [])

  const handleStreamDispose = useCallback(() => {
    streamRef.current = null
  }, [])

  const statusLabel =
    status === 'ready' && session
      ? `Live · pid ${session.pid}`
      : status === 'exited' && exitInfo
        ? `Shell exited · code ${exitInfo.exitCode}${
            exitInfo.signal ? ` · ${exitInfo.signal}` : ''
          }`
        : status === 'connecting'
          ? 'Connecting…'
          : 'Not connected'

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.modes}>
          <span className={styles.modesLabel}>Runtime</span>
          <span className={styles.mode} data-active="true">
            <TerminalIcon size={11} aria-hidden="true" />
            Local companion
          </span>
          <button
            type="button"
            className={styles.mode}
            disabled
            title={health?.cloud.reason ?? CLOUD_REASON}
          >
            <CloudOff size={11} aria-hidden="true" />
            Cloud · unavailable
          </button>
        </div>

        <div className={styles.sessionMeta}>
          <span
            className={styles.chip}
            data-tone={status === 'ready' ? 'ok' : status === 'exited' ? 'warn' : 'muted'}
          >
            {statusLabel}
          </span>
          {session ? (
            <span className={styles.cwd} title={session.cwd}>
              {shortPath(session.cwd)}
            </span>
          ) : null}
          {connection ? (
            <button type="button" className={styles.button} onClick={disconnect}>
              <Square size={10} aria-hidden="true" />
              Disconnect
            </button>
          ) : null}
        </div>
      </div>

      {connection ? (
        <div className={styles.session}>
          <div className={styles.viewport}>
            <Suspense
              fallback={
                <p className={styles.loading}>
                  <LoaderCircle size={13} className={styles.spin} aria-hidden="true" />
                  Loading the terminal renderer…
                </p>
              }
            >
              <TerminalSurface
                connection={connection}
                onReady={handleStreamReady}
                onDispose={handleStreamDispose}
              />
            </Suspense>
          </div>
          {status === 'exited' ? (
            <p className={styles.hint}>
              The shell exited. The output above is its real session log — start a new
              session to run anything else.
            </p>
          ) : null}
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardKicker}>Local companion · loopback WebSocket</span>
            <span
              className={styles.chip}
              data-tone={health ? 'ok' : healthChecked ? 'danger' : 'muted'}
            >
              {health ? 'Service online' : healthChecked ? 'Service offline' : 'Checking…'}
            </span>
          </div>

          <p className={styles.hint}>
            This is a real shell on the machine running the local service — not a sandbox and
            not cloud isolation. Start the service with{' '}
            <code className={styles.code}>npm run exec</code>, then paste the pairing token
            its console prints.
          </p>

          {health ? (
            <p className={styles.hint}>
              Shell <code className={styles.code}>{health.shell}</code> · starts in{' '}
              <code className={styles.code}>{health.cwd}</code>
            </p>
          ) : null}

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              void connect()
            }}
          >
            <label className={styles.label} htmlFor="terminal-pairing-token">
              Pairing token
            </label>
            <div className={styles.inputRow}>
              <input
                id="terminal-pairing-token"
                className={styles.input}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste the token printed by npm run exec"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                className={`${styles.button} ${styles.primary}`}
                disabled={!health || status === 'connecting'}
                title={
                  health
                    ? 'Open a real local shell'
                    : 'The terminal service must be online before a session can open'
                }
              >
                {status === 'connecting' ? (
                  <LoaderCircle size={12} className={styles.spin} aria-hidden="true" />
                ) : (
                  <KeyRound size={12} aria-hidden="true" />
                )}
                {status === 'connecting' ? 'Connecting…' : 'Connect'}
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => void refreshHealth()}
              >
                <RefreshCw size={12} aria-hidden="true" />
                Re-check service
              </button>
            </div>
          </form>

          {!health && healthChecked ? (
            <p className={styles.offline}>
              <TriangleAlert size={12} aria-hidden="true" />
              <span>
                {probeError ?? 'The terminal service did not answer.'} Start it with{' '}
                <code className={styles.code}>npm run exec</code> in the project folder.
              </span>
            </p>
          ) : null}

          <p className={styles.note}>Cloud terminal: {health?.cloud.reason ?? CLOUD_REASON}</p>
          <p className={styles.note}>
            {health?.note ??
              'The terminal bridge reports whether it is sandboxed instead of implying safety.'}
          </p>
        </div>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          <TriangleAlert size={12} aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}
