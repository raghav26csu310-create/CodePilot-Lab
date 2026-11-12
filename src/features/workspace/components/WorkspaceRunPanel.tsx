import {
  ArrowLeftRight,
  ExternalLink,
  LoaderCircle,
  Play,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useEditorCommands } from '../../editor/EditorCommandsContext'
import { languageForPath } from '../../editor/languageRegistry'
import {
  PROJECT_LANGUAGES,
  projectLanguage,
  projectLanguageForMonaco,
} from '../../editor/projectLanguages'
import {
  cancelExecution,
  ExecutionServiceError,
  fetchExecutionHealth,
  newJobId,
  runCode,
  type HealthResponse,
  type RunResponse,
} from '../../execution/api'
import { stageConversionSource } from '../../converter/staging'
import { useWorkspace } from '../state/useWorkspace'
import styles from './WorkspaceRunPanel.module.css'

const STATUS_LABEL: Record<string, string> = {
  ok: 'Completed',
  compile_error: 'Compilation failed',
  runtime_error: 'Runtime error',
  timeout: 'Time limit exceeded',
  unsupported: 'Runtime unavailable',
  cancelled: 'Stopped',
}

/**
 * Real execution for the file that is open in the workspace.
 *
 * The code sent to the service is the live Monaco draft, not the last saved
 * snapshot, so what runs is exactly what is on screen. HTML, CSS and JSON have
 * no runtime here and say so instead of pretending to run.
 */
export function WorkspaceRunPanel({ activePath }: { activePath: string | null }) {
  const { project, state } = useWorkspace()
  const commands = useEditorCommands()
  const navigate = useNavigate()

  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthChecked, setHealthChecked] = useState(false)
  const [stdin, setStdin] = useState('')
  const [running, setRunning] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [result, setResult] = useState<RunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [codeNote, setCodeNote] = useState<string | null>(null)

  const language = activePath
    ? projectLanguageForMonaco(languageForPath(activePath).id) ??
      PROJECT_LANGUAGES.find((entry) => entry.label === project.language) ??
      projectLanguage('python')
    : null
  const runtime = language?.runtime ?? null
  const support = runtime ? health?.languages.find((entry) => entry.id === runtime) : null
  const online = Boolean(health?.ok)
  const runnable = Boolean(runtime) && online && support?.executable !== false

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await fetchExecutionHealth())
    } catch {
      setHealth(null)
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

  const readDraft = (): string | null => {
    if (!activePath) {
      return null
    }
    const draft = commands.current?.getDraft(activePath)
    if (draft !== null && draft !== undefined) {
      setCodeNote('Using the live editor buffer')
      return draft
    }
    const tab = state.tree.tabs.find((entry) => entry.path === activePath)
    if (tab && tab.status === 'ready') {
      setCodeNote('Using the last saved snapshot — the live buffer is not mounted')
      return tab.content
    }
    setCodeNote(null)
    return null
  }

  const run = async () => {
    if (!activePath || !language || !runtime || running) {
      return
    }
    const code = readDraft()
    if (code === null) {
      setError('This file has no loaded content to run. Open it in the editor first.')
      return
    }
    if (!code.trim()) {
      setError('The buffer is empty, so there is nothing to execute.')
      return
    }
    const job = newJobId()
    setJobId(job)
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      setResult(
        await runCode({
          language: runtime,
          code,
          stdin,
          timeoutMs: 5000,
          jobId: job,
        }),
      )
    } catch (cause) {
      setError(
        cause instanceof ExecutionServiceError
          ? cause.message
          : 'The run request failed before a result was returned.',
      )
    } finally {
      setRunning(false)
      setJobId(null)
    }
  }

  const stop = async () => {
    if (!jobId) {
      return
    }
    try {
      const response = await cancelExecution(jobId)
      if (!response.cancelled) {
        setError(response.message)
      }
    } catch (cause) {
      setError(
        cause instanceof ExecutionServiceError
          ? cause.message
          : 'The stop request could not be delivered.',
      )
    }
  }

  if (!activePath) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon} aria-hidden="true">
          <Terminal size={20} />
        </span>
        <p className={styles.emptyKicker}>Run · no active file</p>
        <h3 className={styles.emptyTitle}>Open a file to run it</h3>
        <p className={styles.emptyCopy}>
          This panel runs the file that is active in the editor through the loopback execution
          service. Nothing is simulated; when the service is offline the exact start command is
          shown instead of output.
        </p>
        <Link className={styles.link} to="/lab">
          <ExternalLink size={12} aria-hidden="true" />
          Open the Execution Lab
        </Link>
      </div>
    )
  }

  const stage = () => {
    const code = readDraft()
    if (code === null || !language) {
      setError('This file has no loaded content to stage for conversion.')
      return
    }
    stageConversionSource({
      projectId: project.id,
      path: activePath,
      code,
      language: language.id,
    })
    navigate('/convert')
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <span className={styles.fileName}>{activePath}</span>
          <span className={styles.languageChip}>
            {language?.label ?? 'Unknown language'}
            {runtime ? ' · runnable' : ' · editor only'}
          </span>
          <span className={styles.sizeChip}>
            {(
              state.tree.tabs.find((entry) => entry.path === activePath)?.content.length ?? 0
            ).toLocaleString()}{' '}
            chars
          </span>
        </div>
        <div className={styles.headActions}>
          <span className={styles.chip} data-ok={online}>
            {online ? 'Service online' : healthChecked ? 'Service offline' : 'Checking service…'}
          </span>
          <button type="button" className={styles.ghostButton} onClick={() => void refreshHealth()}>
            Re-check
          </button>
          <Link className={styles.ghostLink} to="/lab">
            <ExternalLink size={11} aria-hidden="true" />
            Lab
          </Link>
          <button type="button" className={styles.ghostButton} onClick={stage}>
            <ArrowLeftRight size={11} aria-hidden="true" />
            Convert
          </button>
        </div>
      </div>

      {!runtime ? (
        <div className={styles.notice}>
          <TriangleAlert size={13} aria-hidden="true" />
          <p>
            {language?.label ?? 'This language'} has no runtime in this build, so it cannot be run
            or traced here. {language?.note ?? ''} Use the editor and its language service instead.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.controls}>
            <label className={styles.stdinField}>
              <span className={styles.fieldLabel}>stdin</span>
              <textarea
                className={styles.stdinArea}
                value={stdin}
                onChange={(event) => setStdin(event.target.value)}
                rows={2}
                spellCheck={false}
                placeholder="Input passed to the program's standard input"
              />
            </label>
            <div className={styles.buttons}>
              {running ? (
                <button type="button" className={styles.stopButton} onClick={() => void stop()}>
                  <Square size={12} aria-hidden="true" />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.runButton}
                  onClick={() => void run()}
                  disabled={!runnable}
                  title={
                    online
                      ? 'Run the live editor buffer'
                      : 'Start the local execution service with npm run exec'
                  }
                >
                  <Play size={12} aria-hidden="true" />
                  Run file
                </button>
              )}
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setResult(null)
                  setError(null)
                  setCodeNote(null)
                }}
                disabled={!result && !error}
              >
                <Trash2 size={11} aria-hidden="true" />
                Clear
              </button>
            </div>
          </div>

          <p className={styles.meta}>
            {codeNote ?? 'The buffer is read when you press Run.'}
            {!online && healthChecked
              ? ' · Start the service with “npm run exec” in the project folder.'
              : ''}
          </p>

          {error ? (
            <p className={styles.error} role="alert">
              <TriangleAlert size={12} aria-hidden="true" />
              {error}
            </p>
          ) : null}

          {running && !result ? (
            <p className={styles.pending}>
              <LoaderCircle size={12} className={styles.spin} aria-hidden="true" />
              Waiting for the local process…
            </p>
          ) : null}

          {result ? (
            <div className={styles.result}>
              <div className={styles.resultHead}>
                <span className={styles.status} data-status={result.status}>
                  {STATUS_LABEL[result.status] ?? result.status}
                </span>
                <span className={styles.duration}>
                  {result.results[0]?.durationMs ?? 0} ms measured
                  {result.compile ? ` · ${result.compile.durationMs} ms compile` : ''}
                </span>
                <span className={styles.duration}>
                  exit {result.results[0]?.exitCode ?? '—'}
                </span>
              </div>
              {result.status === 'compile_error' ? (
                <pre className={styles.stream} data-stream="stderr">
                  {result.message ?? 'Compilation failed.'}
                </pre>
              ) : (
                <>
                  <div className={styles.streamBlock}>
                    <span className={styles.streamLabel}>stdout</span>
                    <pre className={styles.stream} data-stream="stdout">
                      {result.results[0]?.stdout || '(no stdout)'}
                    </pre>
                  </div>
                  <div className={styles.streamBlock}>
                    <span className={styles.streamLabel}>stderr</span>
                    <pre className={styles.stream} data-stream="stderr">
                      {result.results[0]?.stderr || '(no stderr)'}
                    </pre>
                  </div>
                  {result.results[0]?.message ? (
                    <p className={styles.error}>{result.results[0].message}</p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
