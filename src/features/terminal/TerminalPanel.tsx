import {
  ClipboardCopy,
  Maximize,
  Minimize,
  Plus,
  Square,
  Trash2,
  LoaderCircle,
  KeyRound,
  RefreshCw,
  TriangleAlert,
  X,
  Search,
  OctagonX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useWorkspace } from '../workspace/state/useWorkspace'
import { clampBottomHeight } from '../workspace/state/layoutPreference'
import { logActivity } from '../../lib/activityService'
import {
  connectTerminal,
  describeTerminalClose,
  fetchTerminalHealth,
  getTerminalToken,
  setTerminalToken,
  TerminalServiceError,
  type TerminalConnection,
  type TerminalHealth,
} from './client'
import TerminalSurface, { type TerminalSurfaceHandle } from './TerminalSurface'
import type { TerminalStream } from './TerminalSurface'
import styles from './TerminalPanel.module.css'

const CLOUD_REASON =
  'No cloud terminal runtime is configured in this build. Only the local companion is available.'

/** The backend caps concurrent PTY sessions; mirrored here so the UI can disable New. */
const MAX_SESSIONS = 2

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) {
    return path
  }
  return `�/${parts.slice(-2).join('/')}`
}

type SessionStatus = 'connecting' | 'ready' | 'exited' | 'error'

type SessionInfo = {
  shell: string
  cwd: string
  pid: number
}

type ExitInfo = {
  exitCode: number
  signal: string | null
}

type TerminalSession = {
  id: string
  label: string
  shell?: string
}

type SessionState = {
  status: SessionStatus
  info: SessionInfo | null
  exit: ExitInfo | null
  error: string | null
}

type TerminalSessionHandle = TerminalSurfaceHandle & {
  changeCwd: (path: string) => void
  switchShell: (shell: string) => void
  kill: () => void
}

/**
 * A single terminal tab. Each instance owns one WebSocket connection to the
 * terminal bridge and therefore one real PTY shell. It stays mounted when not
 * active so the shell and its scrollback survive tab switches.
 */
function TerminalSession({
  token,
  shell,
  active,
  reconnectKey,
  onStateChange,
  register,
}: {
  token: string
  shell?: string
  active: boolean
  reconnectKey: number
  onStateChange: (state: SessionState) => void
  register: (handle: TerminalSessionHandle | null) => void
}) {
  const handleRef = useRef<TerminalSessionHandle | null>(null)
  const streamRef = useRef<TerminalStream | null>(null)
  const pendingRef = useRef<string[]>([])
  const infoRef = useRef<SessionInfo | null>(null)
  const surfaceHandleRef = useRef<TerminalSurfaceHandle | null>(null)
  const onStateChangeRef = useRef(onStateChange)
  const registerRef = useRef(register)
  const [connection, setConnection] = useState<TerminalConnection | null>(null)

  useEffect(() => {
    onStateChangeRef.current = onStateChange
  })
  useEffect(() => {
    registerRef.current = register
  })

  // Open (or re-open) the WebSocket for this session when the token is present.
  // Reconnects whenever the token or the reconnect key changes. The effect only
  // depends on token/reconnectKey so a stable callback identity never triggers
  // a reconnect; callbacks are read through their refs.
  useEffect(() => {
    let conn: TerminalConnection | null = null
    let active_ = true

    if (token) {
      const connection = connectTerminal({
        token,
        shell,
        onFrame: (frame) => {
          if (!active_) {
            return
          }
          if (frame.type === 'output') {
            const stream = streamRef.current
            if (stream) {
              stream.write(frame.data)
            } else {
              pendingRef.current.push(frame.data)
            }
            return
          }
          if (frame.type === 'ready') {
            const info: SessionInfo = {
              shell: frame.shell,
              cwd: frame.cwd,
              pid: frame.pid,
            }
            infoRef.current = info
            const next: SessionState = {
              status: 'ready',
              info,
              exit: null,
              error: null,
            }
            onStateChangeRef.current(next)
            const stream = streamRef.current
            if (stream) {
              for (const chunk of pendingRef.current) {
                stream.write(chunk)
              }
              pendingRef.current = []
            }
            return
          }
          if (frame.type === 'exit') {
            onStateChangeRef.current({
              status: 'exited',
              info: infoRef.current ?? null,
              exit: { exitCode: frame.exitCode, signal: frame.signal },
              error: null,
            })
            return
          }
          if (frame.type === 'error') {
            onStateChangeRef.current({
              status: 'error',
              info: infoRef.current ?? null,
              exit: null,
              error: frame.message,
            })
            return
          }
        },
        onClose: (info) => {
          if (!active_) {
            return
          }
          setConnection(null)
          onStateChangeRef.current({
            status: 'exited',
            info: infoRef.current ?? null,
            exit: null,
            error:
              info.intentional
                ? null
                : describeTerminalClose(info),
          })
        },
      })
      conn = connection
      setConnection(connection)
    }

    return () => {
      active_ = false
      if (conn) {
        conn.close()
      }
      setConnection(null)
    }
  }, [token, shell, reconnectKey])

  const changeCwd = useCallback(
    (path: string) => {
      connection?.changeCwd(path)
    },
    [connection],
  )

  // Register the surface handle with the panel so clear/copy/cd can target the
  // active session. Runs once the xterm surface mounts and re-registers if the
  // changeCwd binding changes (reconnect).
  useEffect(() => {
    const handle = surfaceHandleRef.current
    const sessionHandle: TerminalSessionHandle | null = handle
      ? {
          write: handle.write,
          clear: handle.clear,
          copy: handle.copy,
          resize: handle.resize,
          focus: handle.focus,
          fit: handle.fit,
          search: handle.search,
          changeCwd,
          switchShell: (targetShell: string) => connection?.switchShell(targetShell),
          kill: () => connection?.kill(),
        }
      : null
    handleRef.current = sessionHandle
    registerRef.current(sessionHandle)
    return () => {
      registerRef.current(null)
    }
  }, [registerRef, changeCwd, connection])

  // When this session becomes active, re-fit the surface so it sizes correctly.
  useEffect(() => {
    if (active && handleRef.current) {
      handleRef.current.fit()
    }
  }, [active])

  const handleStreamReady = useCallback((stream: TerminalStream) => {
    streamRef.current = stream
    for (const chunk of pendingRef.current) {
      stream.write(chunk)
    }
    pendingRef.current = []
  }, [])

  const setSurfaceRef = useCallback((handle: TerminalSurfaceHandle | null) => {
    surfaceHandleRef.current = handle
  }, [])

  return (
    <div className={styles.sessionSurface} data-active={active}>
      {connection ? (
        <TerminalSurface
          connection={connection}
          onReady={handleStreamReady}
          onDispose={() => {
            streamRef.current = null
          }}
          ref={setSurfaceRef}
        />
      ) : null}
    </div>
  )
}

/**
 * The Terminal tab.
 *
 * Local mode is a genuine PTY hosted by the loopback execution service: each
 * tab is a real shell on the machine running the service � not a sandbox and
 * not cloud isolation. Cloud mode is rendered as an explicitly disabled option
 * because this build has no cloud runtime � it is never a fake prompt.
 *
 * Multiple sessions are supported up to the backend limit (two concurrent
 * PTYs). Each tab holds its own WebSocket, so switching tabs does not kill a
 * shell; the shell only ends when its session is closed or the service stops.
 */
export function TerminalPanel() {
  const { state: uiState, dispatch } = useWorkspace()
  const [health, setHealth] = useState<TerminalHealth | null>(null)
  const [healthChecked, setHealthChecked] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [token, setToken] = useState(getTerminalToken)
  const [reconnectKey, setReconnectKey] = useState(0)
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sessionStates, setSessionStates] = useState<Record<string, SessionState>>({})
  const [error, setError] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [cwdInput, setCwdInput] = useState('')

  const sessionHandles = useRef<Map<string, TerminalSessionHandle | null>>(new Map())
  const previousHeightRef = useRef<number | null>(null)

  const maxSessions = health?.limits.sessions ?? MAX_SESSIONS
  const active = sessions.find((session) => session.id === activeId) ?? null
  const activeState = activeId ? sessionStates[activeId] ?? null : null
  const canAdd = Boolean(health) && Boolean(token) && sessions.length < maxSessions

  const registerHandle = useCallback(
    (id: string, handle: TerminalSessionHandle | null) => {
      sessionHandles.current.set(id, handle)
    },
    [],
  )

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

  useEffect(() => {
    if (activeId) {
      sessionHandles.current.get(activeId)?.fit()
    }
  }, [activeId])

  const applyToken = useCallback(() => {
    setTerminalToken(token)
    setReconnectKey((key) => key + 1)
    setError(null)
  }, [token])

  const [searchQuery, setSearchQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState<string | null>(null)

  const newSessionId = useCallback(() => `terminal-${Date.now()}`, [])

  const addSession = useCallback(
    (chosenShell?: string) => {
      if (!canAdd) {
        return
      }
      const id = newSessionId()
      const shellTag = chosenShell?.includes('cmd')
        ? 'CMD'
        : chosenShell?.includes('powershell')
          ? 'PowerShell'
          : 'Shell'
      const next: TerminalSession = {
        id,
        label: chosenShell ? `${shellTag} ${sessions.length + 1}` : `Terminal ${sessions.length + 1}`,
        shell: chosenShell,
      }
      setSessions((current) => [...current, next])
      setActiveId(id)
      setError(null)

      void logActivity({
        type: 'terminal:session',
        description: `Started ${next.label} (${chosenShell ?? health?.shell ?? 'default shell'})`,
        status: 'info',
      })
    },
    [canAdd, health?.shell, newSessionId, sessions.length],
  )

  const killActive = useCallback(() => {
    if (!active) {
      return
    }
    sessionHandles.current.get(active.id)?.kill()
    void logActivity({
      type: 'terminal:session',
      description: `Terminated active terminal process (${active.label})`,
      status: 'info',
    })
  }, [active])

  const searchActive = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      if (!active || !searchQuery.trim()) {
        return
      }
      const found = sessionHandles.current.get(active.id)?.search(searchQuery.trim()) ?? false
      setSearchStatus(found ? 'Found & selected in buffer' : 'Not found in buffer')
      setTimeout(() => setSearchStatus(null), 3000)
    },
    [active, searchQuery],
  )

  const closeSession = useCallback(
    (id: string) => {
      sessionHandles.current.delete(id)
      setSessions((current) => current.filter((session) => session.id !== id))
      setSessionStates((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      if (activeId === id) {
        const remaining = sessions.filter((session) => session.id !== id)
        setActiveId(remaining.length > 0 ? remaining[0]!.id : null)
      }
      setError(null)
    },
    [activeId, sessions],
  )

  const setActive = useCallback((id: string | null) => {
    setActiveId(id)
    setError(null)
  }, [])

  const clearActive = useCallback(() => {
    const handle = active ? sessionHandles.current.get(active.id) ?? null : null
    handle?.clear()
    setError(null)
  }, [active])

  const copyActive = useCallback(async () => {
    const handle = active ? sessionHandles.current.get(active.id) ?? null : null
    const selection = handle?.copy()
    if (!selection) {
      return
    }
    try {
      await navigator.clipboard.writeText(selection)
      setError(null)
    } catch {
      setError('The browser refused clipboard access, so nothing was copied.')
    }
  }, [active])

  const submitCwd = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      if (!active) {
        return
      }
      const trimmed = cwdInput.trim()
      if (!trimmed) {
        return
      }
      sessionHandles.current.get(active.id)?.changeCwd(trimmed)
      setCwdInput('')
      setError(null)
    },
    [active, cwdInput],
  )

  const toggleMaximize = useCallback(() => {
    setMaximized((prev) => {
      const next = !prev
      try {
        if (dispatch) {
          if (next) {
            previousHeightRef.current = uiState.ui.bottomHeight
            dispatch({ type: 'ui/set-bottom-height', height: clampBottomHeight(440) })
          } else {
            const restore =
              previousHeightRef.current ?? uiState.ui.bottomHeight ?? 224
            dispatch({
              type: 'ui/set-bottom-height',
              height: clampBottomHeight(restore),
            })
            previousHeightRef.current = null
          }
        }
      } catch {
        // Workspace context unavailable in standalone renders; maximize is
        // still reflected visually by the panel class below.
      }
      return next
    })
  }, [dispatch, uiState.ui.bottomHeight])

  const handleFrameState = useCallback(
    (id: string, state: SessionState) => {
      setSessionStates((current) => ({ ...current, [id]: state }))
    },
    [],
  )

  return (
    <section className={styles.panel} aria-label="Terminal">
      <div className={styles.head}>
        <div className={styles.modes}>
          <span className={styles.modesLabel}>Mode</span>
          <span
            className={styles.mode}
            data-active={Boolean(health && !health?.cloud.available)}
            title="Local"
          >
            Local
          </span>
          <span
            className={styles.mode}
            data-active={Boolean(health && health?.cloud.available)}
            title={health?.cloud.reason ?? CLOUD_REASON}
          >
            Cloud
          </span>
        </div>

        <div className={styles.sessionMeta}>
          <span className={styles.modeLabel}>Sessions</span>
          <span className={styles.sessionCount}>
            {sessions.length}/{maxSessions}
          </span>
          {active && activeState?.info ? (
            <>
              <span className={styles.chip} data-tone="ok">
                pid {activeState.info.pid}
              </span>
              <span className={styles.cwd} title={activeState.info.cwd}>
                {shortPath(activeState.info.cwd)}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {health ? (
        <>
          <div className={styles.toolbar}>
            <div className={styles.toolbarGroup}>
              {!health ? null : (
                <>
                  <label className={styles.label} htmlFor="terminal-token">
                    Pairing token
                  </label>
                  <input
                    id="terminal-token"
                    className={styles.input}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Paste the token printed by npm run exec"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className={`${styles.button} ${styles.primary}`}
                    onClick={applyToken}
                    disabled={!token}
                    title="Save the pairing token and reconnect all sessions"
                  >
                    <KeyRound size={12} aria-hidden="true" />
                    Connect
                  </button>
                </>
              )}
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                disabled={!canAdd}
                onClick={() => addSession()}
                title={canAdd ? 'Open a new terminal tab' : 'Maximum concurrent sessions reached'}
              >
                <Plus size={12} aria-hidden="true" />
                New terminal
              </button>
              {health?.availableShells?.includes('powershell.exe') && (
                <button
                  type="button"
                  className={styles.button}
                  disabled={!canAdd}
                  onClick={() => addSession('powershell.exe')}
                  title="Open PowerShell tab"
                >
                  + PowerShell
                </button>
              )}
              {health?.availableShells?.includes('cmd.exe') && (
                <button
                  type="button"
                  className={styles.button}
                  disabled={!canAdd}
                  onClick={() => addSession('cmd.exe')}
                  title="Open Command Prompt tab"
                >
                  + CMD
                </button>
              )}
              <button
                type="button"
                className={styles.button}
                disabled={!active}
                onClick={() => active && closeSession(active.id)}
                title={active ? 'Close this terminal' : 'No terminal to close'}
              >
                <Trash2 size={12} aria-hidden="true" />
                Close
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={!active || activeState?.status !== 'ready'}
                onClick={killActive}
                title="Terminate active shell process"
              >
                <OctagonX size={12} aria-hidden="true" />
                Terminate
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={!active || activeState?.status !== 'ready'}
                onClick={clearActive}
                title="Clear the active terminal's display"
              >
                <Square size={12} aria-hidden="true" />
                Clear
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={!active || activeState?.status !== 'ready'}
                onClick={copyActive}
                title="Copy the active selection to the clipboard"
              >
                <ClipboardCopy size={12} aria-hidden="true" />
                Copy
              </button>
            </div>

            <div className={styles.toolbarGroup}>
              <form className={styles.cwdForm} onSubmit={searchActive} title="Search terminal output">
                <input
                  className={styles.input}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Find in output..."
                />
                <button
                  type="submit"
                  className={styles.button}
                  disabled={!active || !searchQuery.trim()}
                  title="Search terminal scrollback"
                >
                  <Search size={11} aria-hidden="true" />
                  Find
                </button>
                {searchStatus ? (
                  <span className={styles.chip} data-tone={searchStatus.includes('Found') ? 'ok' : 'warn'}>
                    {searchStatus}
                  </span>
                ) : null}
              </form>

              <span className={styles.divider} aria-hidden="true" />

              <form className={styles.cwdForm} onSubmit={submitCwd}>
                <label className={styles.label} htmlFor="terminal-cwd">
                  Working directory
                </label>
                <input
                  id="terminal-cwd"
                  className={styles.input}
                  value={cwdInput}
                  onChange={(event) => setCwdInput(event.target.value)}
                  placeholder="Absolute directory path (e.g. C:\Users\�)"
                  title="Change the active shell's working directory"
                />
                <button
                  type="submit"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={!active || activeState?.status !== 'ready'}
                >
                  <KeyRound size={12} aria-hidden="true" />
                  cd
                </button>
              </form>
              <span className={styles.divider} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.button} ${maximized ? styles.active : ''}`}
                onClick={toggleMaximize}
                title={maximized ? 'Restore panel height' : 'Maximize terminal panel'}
              >
                {maximized ? (
                  <Minimize size={12} aria-hidden="true" />
                ) : (
                  <Maximize size={12} aria-hidden="true" />
                )}
                {maximized ? ' Restore' : ' Maximize'}
              </button>
            </div>

            <div className={styles.toolbarGroup}>
              <span className={styles.statusChip}>
                {activeState?.status === 'ready'
                  ? 'Connected'
                  : activeState?.status === 'connecting'
                  ? 'Connecting�'
                  : activeState?.status === 'exited'
                  ? 'Exited'
                  : activeState?.status === 'error'
                  ? 'Error'
                  : '�'}
              </span>
              <button
                type="button"
                className={styles.button}
                onClick={() => void refreshHealth()}
                title="Re-check the terminal service"
              >
                <RefreshCw size={12} aria-hidden="true" />
                Re-check service
              </button>
            </div>
          </div>

          {sessions.length > 0 ? (
            <div className={styles.sessionTabs} role="tablist" aria-label="Terminal tabs">
              {sessions.map((session) => {
                const selected = activeId === session.id
                const st = sessionStates[session.id]
                const exited = st?.status === 'exited' || st?.status === 'error'
                return (
                  <button
                    key={session.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={styles.tab}
                    data-active={selected}
                    data-exited={exited}
                    onClick={() => setActive(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault()
                        closeSession(session.id)
                      }
                    }}
                  >
                    <span>{session.label}</span>
                    {exited && st?.exit ? (
                      <span className={styles.tabExit}>
                        exit {st.exit.exitCode ?? '�'}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={styles.tabClose}
                      onClick={(event) => {
                        event.stopPropagation()
                        closeSession(session.id)
                      }}
                      aria-label={`Close ${session.label}`}
                      title="Close terminal"
                    >
                      <X size={10} aria-hidden="true" />
                    </button>
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className={styles.card}>
            {!health && healthChecked ? (
              <p className={styles.offline}>
                <TriangleAlert size={12} aria-hidden="true" />
                <span>
                  {probeError ?? 'The terminal service did not answer.'} Start it with{' '}
                  <code className={styles.code}>npm run exec</code> in the project folder.
                </span>
              </p>
            ) : null}

            {!health && healthChecked && !probeError ? null : null}

            {health && sessions.length === 0 ? (
              <p className={styles.empty}>
                No terminal sessions yet. Paste the pairing token, press <b>Connect</b>, then{' '}
                <b>New terminal</b> to open a real local shell.
              </p>
            ) : null}

            {health && active ? (
              <>
                <p className={styles.hint}>
                  This is a real shell on the machine running the local service � not a sandbox
                  and not cloud isolation. Start the service with{' '}
                  <code className={styles.code}>npm run exec</code>, then paste the pairing token
                  its console prints.
                </p>
                <p className={styles.hint}>
                  Shell{' '}
                  <code className={styles.code}>
                    {activeState?.info?.shell ?? health.shell}
                  </code>{' '}
                  � starts in{' '}
                  <code className={styles.code}>
                    {activeState?.info?.cwd ?? health.cwd}
                  </code>
                </p>
                <p className={styles.note}>
                  Cloud terminal: {health.cloud.reason ?? CLOUD_REASON}
                </p>
                <p className={styles.note}>
                  {health.note ??
                    'The terminal bridge reports whether it is sandboxed instead of implying safety.'}
                </p>

                {(activeState?.error || error) && (
                  <p className={styles.error} role="alert">
                    <TriangleAlert size={12} aria-hidden="true" />
                    {activeState?.error ?? error}
                  </p>
                )}

                <div className={styles.sessionViewport} data-maximized={maximized}>
                  {sessions.map((session) => {
                    const selected = activeId === session.id
                    return (
                      <div
                        key={session.id}
                        className={styles.sessionCard}
                        data-active={selected}
                      >
                        <TerminalSession
                          token={token}
                          shell={session.shell}
                          active={selected}
                          reconnectKey={reconnectKey}
                          onStateChange={(state) =>
                            handleFrameState(session.id, state)
                          }
                          register={(handle) =>
                            registerHandle(session.id, handle)
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </>
            ) : null}

            {activeState?.exit && active && (
              <p className={styles.hint}>
                Session exited with code{' '}
                <span className={styles.code}>{activeState.exit.exitCode}</span>{' '}
                {activeState.exit.signal ? ` (signal ${activeState.exit.signal})` : ''}.{' '}
                Open a new terminal to start another shell.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className={styles.card}>
          <div className={styles.loading}>
            <LoaderCircle size={12} className={styles.spin} aria-hidden="true" />
            Checking terminal service�
          </div>
        </div>
      )}

      {!health && healthChecked ? (
        <p className={styles.offline}>
          <TriangleAlert size={12} aria-hidden="true" />
          <span>
            {probeError ?? 'The terminal service did not answer.'} Start it with{' '}
            <code className={styles.code}>npm run exec</code> in the project folder.
          </span>
        </p>
      ) : null}

      {(!health || sessions.length === 0) && error ? (
        <p className={styles.error} role="alert">
          <TriangleAlert size={12} aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </section>
  )
}
