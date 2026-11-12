import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Cpu,
  Gauge,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  Waves,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Select } from '../../design-system/primitives/Select'
import { PROJECT_LANGUAGES, projectLanguage } from '../editor/projectLanguages'
import {
  cancelExecution,
  ExecutionServiceError,
  fetchExecutionHealth,
  newJobId,
  runCode,
  traceCode,
  type ExecutionStatus,
  type HealthResponse,
  type RunResponse,
  type TraceEvent,
  type TraceResponse,
} from '../execution/api'
import { readLabDraft, writeLabDraft } from '../execution/drafts'
import { StandaloneEditor } from '../execution/StandaloneEditor'
import { QuickAiPanel } from '../copilot/QuickAiPanel'
import styles from './ExecutionLabPage.module.css'

const EXECUTABLE = PROJECT_LANGUAGES.filter((language) => language.runtime !== null)

const STATUS_LABEL: Record<ExecutionStatus | 'cancelled', string> = {
  ok: 'Completed',
  compile_error: 'Compilation failed',
  runtime_error: 'Runtime error',
  timeout: 'Time limit exceeded',
  unsupported: 'Runtime unavailable',
  cancelled: 'Stopped',
}

function statusTone(status: ExecutionStatus | undefined): 'ok' | 'warn' | 'danger' | 'muted' {
  if (status === 'ok') return 'ok'
  if (status === 'unsupported' || status === 'cancelled') return 'muted'
  if (status === 'compile_error') return 'danger'
  return status ? 'warn' : 'muted'
}

function normalizedInitialDrafts(): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (const language of EXECUTABLE) {
    drafts[language.id] = readLabDraft(language.id) ?? language.starter
  }
  return drafts
}

export function ExecutionLabPage() {
  const [params] = useSearchParams()
  const requested = params.get('language')
  const initialLanguage =
    requested && EXECUTABLE.some((language) => language.id === requested)
      ? requested
      : 'python'

  const [language, setLanguage] = useState(initialLanguage)
  const [drafts, setDrafts] = useState<Record<string, string>>(normalizedInitialDrafts)
  const [stdin, setStdin] = useState('')
  const [stdinOpen, setStdinOpen] = useState(false)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)

  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<RunResponse | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const [trace, setTrace] = useState<TraceResponse | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)

  const stepRef = useRef(0)
  const code = drafts[language] ?? projectLanguage(language).starter
  const languageInfo = projectLanguage(language)
  const isPython = language === 'python'
  const support = health?.languages.find((entry) => entry.id === language)
  const online = Boolean(health?.ok)
  const runnable = online && support?.executable !== false
  const activeEvent: TraceEvent | null = trace?.events[stepIndex] ?? null
  const lastStep = Math.max(0, (trace?.events.length ?? 1) - 1)

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true)
    setHealthError(null)
    try {
      const report = await fetchExecutionHealth()
      setHealth(report)
    } catch (error) {
      setHealth(null)
      setHealthError(
        error instanceof ExecutionServiceError
          ? error.message
          : 'The execution service could not be reached.',
      )
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshHealth()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshHealth])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeLabDraft(language, code)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [language, code])

  useEffect(() => {
    stepRef.current = stepIndex
  }, [stepIndex])

  useEffect(() => {
    if (!playing || !trace || trace.events.length === 0) {
      return
    }
    const interval = Math.max(120, Math.round(1000 / speed))
    const timer = window.setInterval(() => {
      const next = Math.min(stepRef.current + 1, trace.events.length - 1)
      stepRef.current = next
      setStepIndex(next)
      if (next >= trace.events.length - 1) {
        setPlaying(false)
      }
    }, interval)
    return () => window.clearInterval(timer)
  }, [playing, speed, trace])

  const setCode = (next: string) => {
    setDrafts((current) => ({ ...current, [language]: next }))
  }

  const switchLanguage = (next: string) => {
    setLanguage(next)
    setRunResult(null)
    setRunError(null)
    setTrace(null)
    setTraceError(null)
    setPlaying(false)
    setStepIndex(0)
  }

  const run = async () => {
    if (running || !code.trim()) {
      return
    }
    const nextJob = newJobId()
    setJobId(nextJob)
    setRunning(true)
    setStopping(false)
    setRunError(null)
    setPlaying(false)
    try {
      const response = await runCode({
        language,
        code,
        stdin,
        timeoutMs: 5000,
        jobId: nextJob,
      })
      setRunResult(response)
    } catch (error) {
      setRunError(
        error instanceof ExecutionServiceError
          ? error.message
          : 'The execution request failed before a result was returned.',
      )
    } finally {
      setRunning(false)
      setJobId(null)
      setStopping(false)
    }
  }

  const stop = async () => {
    if (!jobId || stopping) {
      return
    }
    setStopping(true)
    try {
      const result = await cancelExecution(jobId)
      if (!result.cancelled) {
        setRunError(result.message)
      }
    } catch (error) {
      setRunError(
        error instanceof ExecutionServiceError
          ? error.message
          : 'The stop request could not be delivered.',
      )
    }
  }

  const clearOutput = () => {
    setRunResult(null)
    setRunError(null)
    setTrace(null)
    setTraceError(null)
    setPlaying(false)
    setStepIndex(0)
  }

  const startTrace = async () => {
    if (traceLoading || !isPython) {
      return
    }
    setTraceLoading(true)
    setTraceError(null)
    setPlaying(false)
    setStepIndex(0)
    try {
      const response = await traceCode({
        language,
        code,
        stdin,
        timeoutMs: 8000,
        jobId: newJobId(),
      })
      setTrace(response)
      if (response.status === 'unsupported' || response.status === 'error') {
        setTraceError(response.message ?? 'The trace could not be recorded.')
      }
    } catch (error) {
      setTraceError(
        error instanceof ExecutionServiceError
          ? error.message
          : 'The trace request failed before a result was returned.',
      )
    } finally {
      setTraceLoading(false)
    }
  }

  const restartTrace = () => {
    setStepIndex(0)
    stepRef.current = 0
    setPlaying(false)
  }

  const stepBy = (delta: number) => {
    setPlaying(false)
    setStepIndex((current) => Math.min(lastStep, Math.max(0, current + delta)))
  }

  const togglePlay = () => {
    if (!trace || trace.events.length === 0) {
      return
    }
    if (playing) {
      setPlaying(false)
      return
    }
    if (stepRef.current >= lastStep) {
      stepRef.current = 0
      setStepIndex(0)
    }
    setPlaying(true)
  }

  const observed = useMemo(() => describeEvent(trace, stepIndex, code), [trace, stepIndex, code])

  const traceAiContext = useMemo(() => {
    if (!trace || !activeEvent) {
      return ''
    }
    const variables = activeEvent.variables
      .map(
        (variable) =>
          `${variable.name}: ${variable.type} = ${variable.value}${
            variable.changed && variable.previousValue !== null
              ? ` (previous ${variable.previousValue})`
              : ''
          } [scope ${variable.scope}, declared ${variable.declaredAt}]`,
      )
      .join('\n')
    const stack = activeEvent.stack.map((frame) => `${frame.function} (line ${frame.line})`).join(' → ')
    return [
      `Python trace, event ${stepIndex + 1} of ${trace.events.length}`,
      `Program:\n${code.slice(0, 10000)}`,
      `Event kind: ${activeEvent.event} at line ${activeEvent.line} in ${activeEvent.function}`,
      `Call stack: ${stack || '(empty)'}`,
      `Locals:\n${variables || '(none)'}`,
      `Output at this step: ${JSON.stringify(activeEvent.output.slice(-1500))}`,
      observed ? `App observation: ${observed.title}. ${observed.detail}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }, [activeEvent, code, observed, stepIndex, trace])

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Phase 06 · Execution Lab</p>
          <h1 className={styles.title}>
            Real processes.
            <span className={styles.titleAccent}> Real traces.</span>
          </h1>
          <p className={styles.lede}>
            Compile and run code through the loopback execution service, then step through a
            genuine Python interpreter trace. Nothing is executed inside the browser and no output
            is invented.
          </p>
        </div>

        <div className={styles.serviceCard} data-online={online}>
          <div className={styles.serviceHead}>
            <span className={styles.serviceIcon} aria-hidden="true">
              <Cpu size={16} />
            </span>
            <div>
              <p className={styles.serviceKicker}>Execution service</p>
              <p className={styles.serviceValue}>
                {healthLoading
                  ? 'Probing…'
                  : online
                    ? 'Listening on 127.0.0.1:5310'
                    : 'Not connected'}
              </p>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void refreshHealth()}
              aria-label="Re-check execution service"
              title="Re-check execution service"
            >
              <RefreshCw size={13} aria-hidden="true" data-spinning={healthLoading} />
            </button>
          </div>

          {healthError ? (
            <div className={styles.serviceOffline} role="status">
              <p>{healthError}</p>
              <code>npm run exec</code>
            </div>
          ) : (
            <dl className={styles.runtimeGrid}>
              {health
                ? Object.entries(health.runtimes)
                  .filter(([key]) => key !== 'java')
                  .map(([key, runtime]) => (
                    <div key={key}>
                      <dt>{runtime.label ?? key}</dt>
                      <dd data-ok={runtime.ok} title={runtime.version ?? 'Not available'}>
                        {runtime.ok ? 'Ready' : 'Missing'}
                      </dd>
                    </div>
                  ))
                : null}
            </dl>
          )}
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.editorPane} aria-label="Run code">
          <div className={styles.paneHead}>
            <div className={styles.paneHeading}>
              <p className={styles.paneKicker}>Shared editor</p>
              <h2 className={styles.paneTitle}>Run</h2>
            </div>

            <div className={styles.paneControls}>
              <Select
                value={language}
                onChange={switchLanguage}
                options={EXECUTABLE.map((option) => ({
                  value: option.id,
                  label: option.label,
                  description: option.runtime ? `Runs as ${option.runtime}` : 'No runtime',
                }))}
                ariaLabel="Execution language"
                compact
                className={styles.languageSelect}
              />
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setStdinOpen((current) => !current)}
                aria-expanded={stdinOpen}
              >
                <Terminal size={13} aria-hidden="true" />
                stdin
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={clearOutput}
                disabled={!runResult && !runError && !trace}
              >
                <Trash2 size={13} aria-hidden="true" />
                Clear
              </button>
            </div>
          </div>

          <p className={styles.runtimeNote}>{languageInfo.note}</p>

          <div className={styles.editorFrame}>
            <StandaloneEditor
              value={code}
              language={languageInfo.monaco}
              onChange={setCode}
              ariaLabel={`${languageInfo.label} source code`}
              currentLine={activeEvent && activeEvent.line > 0 ? activeEvent.line : null}
            />
          </div>

          {stdinOpen ? (
            <label className={styles.stdinField}>
              <span className={styles.stdinLabel}>
                Standard input
                <span>delivered to the process unchanged</span>
              </span>
              <textarea
                className={styles.stdin}
                value={stdin}
                onChange={(event) => setStdin(event.target.value)}
                rows={4}
                spellCheck={false}
                placeholder="Input passed to the program on stdin"
              />
            </label>
          ) : null}

          <div className={styles.runBar}>
            <div className={styles.runActions}>
              {running ? (
                <button type="button" className={styles.stopButton} onClick={() => void stop()} disabled={stopping}>
                  <Square size={13} aria-hidden="true" />
                  {stopping ? 'Stopping…' : 'Stop'}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.runButton}
                  onClick={() => void run()}
                  disabled={!runnable || !code.trim()}
                  title={
                    !online
                      ? 'Start the local execution service with npm run exec'
                      : !runnable
                        ? `${languageInfo.label} is not available for execution`
                        : 'Run the current editor buffer'
                  }
                >
                  <Play size={13} aria-hidden="true" />
                  Run
                </button>
              )}

              <button
                type="button"
                className={styles.traceButton}
                onClick={() => void startTrace()}
                disabled={traceLoading || !isPython || !online}
                title={
                  isPython
                    ? 'Record a real sys.settrace execution trace'
                    : 'This build only records real traces for Python'
                }
              >
                <Waves size={13} aria-hidden="true" />
                {traceLoading ? 'Tracing…' : 'Trace execution'}
              </button>
            </div>

            <span className={styles.runMeta}>
              {runResult ? (
                <>
                  <span className={styles.statusPill} data-tone={statusTone(runResult.status)}>
                    {STATUS_LABEL[runResult.status] ?? runResult.status}
                  </span>
                  <span>{runResult.results[0]?.durationMs ?? 0} ms measured</span>
                </>
              ) : (
                <>
                  <span className={styles.statusPill} data-tone="muted">
                    Idle
                  </span>
                  <span>No process has run in this session</span>
                </>
              )}
            </span>
          </div>

          <OutputConsole result={runResult} error={runError} />

          <div className={styles.limitsNote}>
            <Gauge size={12} aria-hidden="true" />
            <span>
              Loopback-only local runner: {health?.limits.runTimeoutMs ?? 8000} ms run limit,{' '}
              {health?.limits.compileTimeoutMs ?? 20000} ms compile limit, real process-tree stop.
              It is resource-limited infrastructure, not a hardened security sandbox.
            </span>
          </div>
        </section>

        <aside className={styles.tracePane} aria-label="Variable and execution tracer">
          <div className={styles.paneHead}>
            <div className={styles.paneHeading}>
              <p className={styles.paneKicker}>Instrumented runtime</p>
              <h2 className={styles.paneTitle}>Variable Tracer</h2>
            </div>
            <span className={styles.traceChip} data-active={Boolean(trace) && !traceError}>
              <span className={styles.traceDot} aria-hidden="true" />
              {isPython ? 'sys.settrace' : 'Unavailable'}
            </span>
          </div>

          {!isPython ? (
            <div className={styles.unsupported}>
              <span className={styles.unsupportedIcon} aria-hidden="true">
                <CircleSlash size={18} />
              </span>
              <h3>No real trace for {languageInfo.label}</h3>
              <p>
                This build instruments Python through <code>sys.settrace</code>, which exposes
                actual frame locals, call stacks and line events. {languageInfo.label} has no
                equivalent hook wired into this runner, so the tracer refuses to guess values.
              </p>
              <button type="button" className={styles.ghostButton} onClick={() => switchLanguage('python')}>
                Switch the editor to Python
              </button>
            </div>
          ) : (
            <>
              <div className={styles.traceControls}>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={restartTrace}
                  disabled={!trace}
                  aria-label="Restart trace"
                  title="Restart trace at the first event"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => stepBy(-1)}
                  disabled={!trace || stepIndex === 0}
                  aria-label="Step backward"
                  title="Step backward"
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.playButton}
                  onClick={togglePlay}
                  disabled={!trace || trace.events.length === 0}
                  aria-label={playing ? 'Pause trace' : 'Play trace'}
                >
                  {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => stepBy(1)}
                  disabled={!trace || stepIndex >= lastStep}
                  aria-label="Step forward"
                  title="Step forward"
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
                <label className={styles.speedField}>
                  <span>Speed</span>
                  <select
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                    aria-label="Trace speed"
                  >
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                  </select>
                </label>
              </div>

              {traceError ? (
                <p className={styles.traceError} role="alert">
                  <TriangleAlert size={13} aria-hidden="true" />
                  {traceError}
                </p>
              ) : null}

              {!trace ? (
                <div className={styles.traceEmpty}>
                  <span aria-hidden="true">
                    <Activity size={18} />
                  </span>
                  <p>
                    Record the current Python buffer to inspect real line events, frame locals,
                    call stacks and printed output. The trace is capped at{' '}
                    {health?.limits.maxTraceEvents ?? 2500} events.
                  </p>
                </div>
              ) : (
                <>
                  <div className={styles.timelineBlock}>
                    <div className={styles.timelineHead}>
                      <span>
                        Event {trace.events.length === 0 ? 0 : stepIndex + 1} / {trace.events.length}
                      </span>
                      <span>
                        line {activeEvent?.line ?? '—'} · {activeEvent?.function ?? '—'}
                      </span>
                    </div>
                    <input
                      className={styles.timeline}
                      type="range"
                      min={0}
                      max={lastStep}
                      step={1}
                      value={stepIndex}
                      onChange={(event) => {
                        setPlaying(false)
                        setStepIndex(Number(event.target.value))
                      }}
                      aria-label="Execution timeline"
                    />
                    {trace.truncated ? (
                      <p className={styles.truncatedNote}>
                        The trace stopped recording at the event cap; the program continued.
                      </p>
                    ) : null}
                  </div>

                  <div className={styles.observed}>
                    <p className={styles.observedKicker}>Observed event</p>
                    <p className={styles.observedText}>{observed.title}</p>
                    <p className={styles.observedDetail}>{observed.detail}</p>
                    {observed.source ? (
                      <pre className={styles.observedSource}>{observed.source}</pre>
                    ) : null}
                  </div>

                  <section className={styles.traceSection} aria-labelledby="tracer-variables">
                    <div className={styles.sectionHead}>
                      <h3 id="tracer-variables">Variables</h3>
                      <span>{activeEvent?.variables.length ?? 0} in scope</span>
                    </div>
                    <div className={styles.variableTableWrap}>
                      <table className={styles.variableTable}>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Value</th>
                            <th>Previous</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeEvent?.variables.length ?? 0) === 0 ? (
                            <tr>
                              <td colSpan={4} className={styles.emptyCell}>
                                No local variables at this event.
                              </td>
                            </tr>
                          ) : (
                            activeEvent?.variables.map((variable) => (
                              <tr key={`${variable.frameId}-${variable.name}`} data-changed={variable.changed}>
                                <td className={styles.varName}>{variable.name}</td>
                                <td className={styles.varType}>{variable.type}</td>
                                <td className={styles.varValue} title={variable.value}>
                                  {variable.value}
                                </td>
                                <td className={styles.varPrevious}>
                                  {variable.changed && variable.previousValue !== null
                                    ? variable.previousValue
                                    : '—'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className={styles.scopeNote}>
                      Scope: <code>{activeEvent?.variables[0]?.scope ?? '—'}</code>
                      {activeEvent?.variables[0]
                        ? ` · declared line ${activeEvent.variables[0].declaredAt}`
                        : ''}
                    </p>
                  </section>

                  <section className={styles.traceSection} aria-labelledby="tracer-stack">
                    <div className={styles.sectionHead}>
                      <h3 id="tracer-stack">Call stack</h3>
                      <span>{activeEvent?.stack.length ?? 0} frames</span>
                    </div>
                    <ol className={styles.stackList}>
                      {[...(activeEvent?.stack ?? [])].reverse().map((frame, index) => (
                        <li key={`${frame.function}-${frame.line}-${index}`}>
                          <span className={styles.stackFunction}>{frame.function}</span>
                          <span className={styles.stackLine}>line {frame.line}</span>
                        </li>
                      ))}
                    </ol>
                  </section>

                  {activeEvent?.output ? (
                    <section className={styles.traceSection} aria-labelledby="tracer-output">
                      <div className={styles.sectionHead}>
                        <h3 id="tracer-output">Output at this step</h3>
                      </div>
                      <pre className={styles.stepOutput}>{activeEvent.output}</pre>
                    </section>
                  ) : null}

                  <section className={styles.traceSection} aria-label="AI explanation of this trace step">
                    <QuickAiPanel
                      context={traceAiContext}
                      scope={`Python trace at line ${activeEvent?.line ?? '—'}`}
                      suggestions={[
                        'Explain what happened at this exact step',
                        'Why did this variable change?',
                        'What will execute next and why?',
                      ]}
                    />
                  </section>

                  <p className={styles.instrumentation}>
                    Instrumentation: {trace.instrumentation ?? 'Python sys.settrace'}.
                    {trace.meta ? ` Python ${trace.meta.python}.` : ''} Values are bounded repr
                    snapshots of real frame locals; conditions are not inferred.
                  </p>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </main>
  )
}

function describeEvent(
  trace: TraceResponse | null,
  index: number,
  code: string,
): { title: string; detail: string; source: string | null } {
  if (!trace || trace.events.length === 0) {
    return {
      title: 'No trace loaded',
      detail: 'Record a trace to inspect real interpreter events.',
      source: null,
    }
  }
  const event = trace.events[index]
  if (!event) {
    return { title: 'Event unavailable', detail: 'The selected event is outside the trace.', source: null }
  }
  const previous = index > 0 ? trace.events[index - 1] : null
  const lineText = code.split('\n')[event.line - 1]?.trim() ?? ''
  const revisits = trace.events
    .slice(0, index)
    .filter((candidate) => candidate.event === 'line' && candidate.line === event.line).length

  if (event.event === 'call') {
    return {
      title: `Call entered · ${event.function}`,
      detail: 'The interpreter emitted a real call event for this frame.',
      source: lineText || null,
    }
  }
  if (event.event === 'return') {
    return {
      title: `Return from ${event.function}`,
      detail: `Observed return value: ${event.returnValue ?? '—'}.`,
      source: lineText || null,
    }
  }
  if (event.event === 'exception') {
    return {
      title: 'Exception raised',
      detail: event.exception ?? 'The interpreter reported an exception event.',
      source: lineText || null,
    }
  }

  const move =
    previous && previous.event === 'line'
      ? previous.line === event.line
        ? `Line ${event.line} executed again`
        : `Line ${previous.line} → line ${event.line}`
      : `Line ${event.line}`

  return {
    title: `${move} · ${event.function}`,
    detail:
      revisits > 0
        ? `This line has already been executed ${revisits} time${revisits === 1 ? '' : 's'} earlier in the trace, so a loop or repeated call is observed here.`
        : 'First observed execution of this line in the trace.',
    source: lineText || null,
  }
}

function OutputConsole({ result, error }: { result: RunResponse | null; error: string | null }) {
  const first = result?.results[0]
  const compileError = result?.status === 'compile_error' ? result.message : null

  return (
    <section className={styles.output} aria-label="Execution output" aria-live="polite">
      <div className={styles.outputHead}>
        <span>
          <Terminal size={12} aria-hidden="true" /> Process output
        </span>
        {result?.compile ? (
          <span className={styles.outputMeta}>
            {result.compile.command} · {result.compile.durationMs} ms compile
          </span>
        ) : null}
      </div>

      {error ? (
        <div className={styles.outputError} role="alert">
          {error}
        </div>
      ) : null}

      {!result && !error ? (
        <p className={styles.outputEmpty}>Nothing has run. Output appears only after a real process exits.</p>
      ) : null}

      {compileError ? (
        <div className={styles.stream} data-stream="stderr">
          <span className={styles.streamLabel}>Compilation error</span>
          <pre>{compileError}</pre>
        </div>
      ) : null}

      {result && !compileError ? (
        <>
          <div className={styles.stream} data-stream="stdout">
            <span className={styles.streamLabel}>stdout</span>
            <pre>{first?.stdout || '(no stdout)'}</pre>
          </div>
          <div className={styles.stream} data-stream="stderr">
            <span className={styles.streamLabel}>stderr</span>
            <pre>{first?.stderr || '(no stderr)'}</pre>
          </div>
          {first?.message ? <p className={styles.streamMessage}>{first.message}</p> : null}
          {first?.note ? <p className={styles.streamNote}>{first.note}</p> : null}
        </>
      ) : null}
    </section>
  )
}

// The lab intentionally exposes no grading UI; hidden suites belong to Practice.
