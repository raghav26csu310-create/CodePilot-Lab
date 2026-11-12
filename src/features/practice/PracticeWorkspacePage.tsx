import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleSlash,
  Clock,
  ListChecks,
  LoaderCircle,
  Lock,
  NotebookPen,
  Play,
  RotateCcw,
  Square,
  Terminal,
  TriangleAlert,
  Trophy,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { QuickAiPanel } from '../copilot/QuickAiPanel'
import { Select } from '../../design-system/primitives/Select'
import type {
  PracticeProgress,
  PracticeSubmission,
} from '../../lib/db'
import { formatDate } from '../../lib/format'
import { projectLanguage } from '../editor/projectLanguages'
import {
  cancelExecution,
  ExecutionServiceError,
  fetchExecutionHealth,
  gradeSubmission,
  newJobId,
  runCode,
  type GradeResponse,
  type HealthResponse,
  type RunResponse,
} from '../execution/api'
import { StandaloneEditor } from '../execution/StandaloneEditor'
import {
  DIFFICULTY_LABEL,
  EXECUTABLE_PRACTICE_LANGUAGES,
  PRACTICE_PROBLEMS,
  getPracticeProblem,
  type PracticeProblem,
} from './catalog'
import {
  emptyProgress,
  getPracticeProgress,
  listProblemSubmissions,
  recordPracticeAttempt,
  savePracticeDraft,
  savePracticeNotes,
  setPracticeBookmark,
} from './progressStorage'
import styles from './PracticeWorkspacePage.module.css'

type VisibleOutcome = {
  index: number
  passed: boolean
  stdin: string
  expected: string
  stdout: string
  stderr: string
  status: string
  durationMs: number
}

function normalize(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
}

const LANGUAGE_LABELS = EXECUTABLE_PRACTICE_LANGUAGES.map((id) => ({
  value: id,
  label: projectLanguage(id).label,
  description: projectLanguage(id).note,
}))

function languageAllowed(problem: PracticeProblem, language: string): boolean {
  return problem.starter[language as keyof PracticeProblem['starter']] !== undefined
}

export function PracticeWorkspacePage() {
  const params = useParams<{ problemId: string }>()
  const problemId = params.problemId ?? ''
  const problem = getPracticeProblem(problemId)

  const [progress, setProgress] = useState<PracticeProgress>(() => emptyProgress(problemId))
  const [submissions, setSubmissions] = useState<PracticeSubmission[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [language, setLanguage] = useState('python')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [hintsShown, setHintsShown] = useState(0)
  const [showExplanation, setShowExplanation] = useState(false)
  const [pendingSolution, setPendingSolution] = useState(false)
  const [showSolution, setShowSolution] = useState(false)
  const [pendingReset, setPendingReset] = useState(false)

  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<RunResponse | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [grade, setGrade] = useState<GradeResponse | null>(null)
  const [gradeError, setGradeError] = useState<string | null>(null)
  const [attemptError, setAttemptError] = useState<string | null>(null)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  const saveTimer = useRef<number | null>(null)
  const notesTimer = useRef<number | null>(null)

  const code = drafts[language] ?? (problem ? problem.starter[language as keyof PracticeProblem['starter']] : '') ?? ''
  const languageInfo = projectLanguage(language)
  const support = health?.languages.find((entry) => entry.id === language)
  const online = Boolean(health?.ok)
  const runnable = online && support?.executable !== false
  const index = PRACTICE_PROBLEMS.findIndex((entry) => entry.id === problemId)
  const previous = index > 0 ? PRACTICE_PROBLEMS[index - 1] : null
  const next = index >= 0 && index < PRACTICE_PROBLEMS.length - 1 ? PRACTICE_PROBLEMS[index + 1] : null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const report = await fetchExecutionHealth()
        if (!cancelled) {
          setHealth(report)
        }
      } catch {
        if (!cancelled) {
          setHealth(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [stored, rows] = await Promise.all([
          getPracticeProgress(problemId),
          listProblemSubmissions(problemId),
        ])
        if (cancelled) {
          return
        }
        setProgress(stored)
        setSubmissions(rows)
        setNotes(stored.notes)
        const preferred = languageAllowed(problem ?? PRACTICE_PROBLEMS[0]!, stored.lastLanguage)
          ? stored.lastLanguage
          : 'python'
        setLanguage(preferred)
        setDrafts(stored.codeByLanguage)
        setLoadError(null)
      } catch {
        if (!cancelled) {
          setLoadError('Stored progress for this problem could not be read from IndexedDB.')
        }
      } finally {
        if (!cancelled) {
          setLoaded(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [problemId, problem])

  useEffect(() => {
    if (!loaded || !problem) {
      return
    }
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
    }
    saveTimer.current = window.setTimeout(() => {
      setSaveState('saving')
      void savePracticeDraft(problem.id, language, code)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('idle'))
    }, 550)
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current)
      }
    }
  }, [code, language, loaded, problem])

  useEffect(() => {
    if (!loaded || !problem) {
      return
    }
    if (notesTimer.current !== null) {
      window.clearTimeout(notesTimer.current)
    }
    notesTimer.current = window.setTimeout(() => {
      void savePracticeNotes(problem.id, notes).catch(() => {})
    }, 600)
    return () => {
      if (notesTimer.current !== null) {
        window.clearTimeout(notesTimer.current)
      }
    }
  }, [notes, loaded, problem])

  const visibleOutcomes = useMemo<VisibleOutcome[]>(() => {
    if (!problem || !runResult) {
      return []
    }
    return problem.visibleTests.map((test, testIndex) => {
      const result = runResult.results[testIndex]
      const stdout = result?.stdout ?? ''
      const status = result?.status ?? 'unsupported'
      return {
        index: testIndex,
        passed: status === 'ok' && normalize(stdout) === normalize(test.expected),
        stdin: test.stdin,
        expected: test.expected,
        stdout,
        stderr: result?.stderr ?? '',
        status,
        durationMs: result?.durationMs ?? 0,
      }
    })
  }, [problem, runResult])

  const visiblePassed = visibleOutcomes.filter((entry) => entry.passed).length
  const hiddenCount = grade ? grade.cases.filter((entry) => entry.hidden).length : 0

  const aiContext = useMemo(() => {
    if (!problem) {
      return ''
    }
    const lastGrade = grade
      ? `Last submit verdict: ${grade.verdict} (${grade.passed}/${grade.total}); hidden cases are not shown to the page.`
      : 'No submit has run for this problem in this session.'
    const lastRun = runResult
      ? `Last Run checked ${visibleOutcomes.length} visible cases with ${visiblePassed} passing.`
      : 'No Run has been executed in this session.'
    const failing = visibleOutcomes
      .filter((entry) => !entry.passed)
      .slice(0, 3)
      .map(
        (entry) =>
          `Visible case ${entry.index + 1}: status ${entry.status}, stdout ${JSON.stringify(
            entry.stdout.slice(0, 400),
          )}, stderr ${JSON.stringify(entry.stderr.slice(0, 400))}`,
      )
      .join('\n')

    return [
      `Problem: ${problem.title} (${problem.difficulty})`,
      problem.description,
      `Input: ${problem.inputFormat}`,
      `Output: ${problem.outputFormat}`,
      `Constraints: ${problem.constraints.join(' ')}`,
      `Language: ${languageInfo.label}`,
      `Current code:\n${code.slice(0, 12000)}`,
      lastRun,
      lastGrade,
      failing,
      notes ? `Learner notes: ${notes.slice(0, 1200)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }, [code, grade, languageInfo.label, notes, problem, runResult, visibleOutcomes, visiblePassed])

  const setCurrentCode = (value: string) => {
    setDrafts((current) => ({ ...current, [language]: value }))
  }

  const switchLanguage = (value: string) => {
    setLanguage(value)
    setRunResult(null)
    setRunError(null)
    setGrade(null)
    setGradeError(null)
    setAttemptError(null)
  }

  const resetDraft = () => {
    if (!problem) {
      return
    }
    setDrafts((current) => ({
      ...current,
      [language]: problem.starter[language as keyof PracticeProblem['starter']] ?? '',
    }))
    setPendingReset(false)
    setRunResult(null)
    setRunError(null)
  }

  const runVisible = async () => {
    if (!problem || running || submitting || !code.trim()) {
      return
    }
    const job = newJobId()
    setJobId(job)
    setRunning(true)
    setRunError(null)
    setRunResult(null)
    try {
      const response = await runCode({
        language,
        code,
        tests: problem.visibleTests.map((test) => ({ stdin: test.stdin })),
        timeoutMs: 5000,
        jobId: job,
      })
      setRunResult(response)
      if (response.status === 'compile_error') {
        setRunError(response.message ?? 'Compilation failed.')
      } else if (response.status === 'unsupported') {
        setRunError(response.message ?? 'This runtime is unavailable.')
      }
    } catch (error) {
      setRunError(
        error instanceof ExecutionServiceError
          ? error.message
          : 'The run request failed before a result was returned.',
      )
    } finally {
      setRunning(false)
      setJobId(null)
    }
  }

  const submit = async () => {
    if (!problem || submitting || running || !code.trim()) {
      return
    }
    const job = newJobId()
    setJobId(job)
    setSubmitting(true)
    setGradeError(null)
    setGrade(null)
    setAttemptError(null)
    try {
      const response = await gradeSubmission({
        problemId: problem.id,
        language,
        code,
        timeoutMs: 5000,
        jobId: job,
      })
      setGrade(response)
      if (response.verdict === 'cancelled') {
        return
      }
      try {
        const updated = await recordPracticeAttempt({
          problemId: problem.id,
          language,
          verdict: response.verdict,
          passed: response.passed,
          total: response.total,
          hiddenCases: response.cases.filter((entry) => entry.hidden).length,
          durationMs: response.cases.reduce((sum, entry) => sum + entry.durationMs, 0),
        })
        setProgress(updated)
        setSubmissions(await listProblemSubmissions(problem.id))
      } catch {
        setAttemptError(
          'The verdict was returned but could not be saved to IndexedDB. The result above is real; the stored history was not updated.',
        )
      }
    } catch (error) {
      setGradeError(
        error instanceof ExecutionServiceError
          ? error.message
          : 'The grading request failed before a verdict was returned.',
      )
    } finally {
      setSubmitting(false)
      setJobId(null)
    }
  }

  const stop = async () => {
    if (!jobId) {
      return
    }
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

  const toggleBookmark = async () => {
    if (!problem || bookmarkBusy) {
      return
    }
    setBookmarkBusy(true)
    try {
      await setPracticeBookmark(problem.id, !progress.bookmarked)
      setProgress((current) => ({ ...current, bookmarked: !current.bookmarked }))
    } catch {
      setLoadError('The bookmark could not be saved to IndexedDB.')
    } finally {
      setBookmarkBusy(false)
    }
  }

  if (!problem) {
    return (
      <main className={styles.page}>
        <div className={styles.missing}>
          <CircleSlash size={22} aria-hidden="true" />
          <h1>Problem not found</h1>
          <p>
            There is no practice problem with the id <code>{problemId || '(empty)'}</code>. The
            catalog contains {PRACTICE_PROBLEMS.length} problems.
          </p>
          <Link className={styles.primaryLink} to="/practice">
            Back to the Practice Arena
          </Link>
        </div>
      </main>
    )
  }

  const answerState = grade
    ? grade.verdict === 'accepted'
      ? 'accepted'
      : grade.verdict === 'wrong_answer'
        ? 'wrong'
        : 'error'
    : 'idle'

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link className={styles.backLink} to="/practice">
            <ArrowLeft size={13} aria-hidden="true" />
            Arena
          </Link>
          <span className={styles.crumb}>/</span>
          <span className={styles.crumbCurrent}>{problem.title}</span>
        </div>
        <div className={styles.topbarRight}>
          {previous ? (
            <Link className={styles.navLink} to={`/practice/${previous.id}`} title={previous.title}>
              <ArrowLeft size={12} aria-hidden="true" />
              Previous
            </Link>
          ) : null}
          {next ? (
            <Link className={styles.navLink} to={`/practice/${next.id}`} title={next.title}>
              Next
              <ArrowRight size={12} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </header>

      <div className={styles.heading}>
        <div>
          <div className={styles.badgeRow}>
            <span className={styles.difficulty} data-level={problem.difficulty}>
              {DIFFICULTY_LABEL[problem.difficulty]}
            </span>
            {progress.solved ? (
              <span className={styles.solvedChip}>
                <CheckCircle2 size={11} aria-hidden="true" />
                Solved {progress.solvedAt ? formatDate(progress.solvedAt) : ''}
              </span>
            ) : null}
            {progress.attempted > 0 ? (
              <span className={styles.attemptChip}>
                {progress.attempted} submission{progress.attempted === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          <h1 className={styles.title}>{problem.title}</h1>
          <p className={styles.summary}>{problem.summary}</p>
          <div className={styles.topics}>
            {problem.topics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
        </div>
        <button
          type="button"
          className={styles.bookmarkButton}
          data-active={progress.bookmarked}
          onClick={() => void toggleBookmark()}
          disabled={bookmarkBusy}
        >
          {progress.bookmarked ? (
            <BookmarkCheck size={14} aria-hidden="true" />
          ) : (
            <Bookmark size={14} aria-hidden="true" />
          )}
          {progress.bookmarked ? 'Bookmarked' : 'Bookmark'}
        </button>
      </div>

      {loadError ? <p className={styles.errorNote}>{loadError}</p> : null}

      <div className={styles.workspace}>
        <section className={styles.statement} aria-label="Problem statement">
          <div className={styles.panelHead}>
            <p className={styles.panelKicker}>Problem</p>
            <h2 className={styles.panelTitle}>Statement</h2>
          </div>

          <p className={styles.bodyText}>{problem.description}</p>

          <div className={styles.ioGrid}>
            <div>
              <h3 className={styles.sectionTitle}>Input</h3>
              <p className={styles.bodyText}>{problem.inputFormat}</p>
            </div>
            <div>
              <h3 className={styles.sectionTitle}>Output</h3>
              <p className={styles.bodyText}>{problem.outputFormat}</p>
            </div>
          </div>

          <h3 className={styles.sectionTitle}>Constraints</h3>
          <ul className={styles.constraintList}>
            {problem.constraints.map((constraint) => (
              <li key={constraint}>{constraint}</li>
            ))}
          </ul>

          <h3 className={styles.sectionTitle}>Visible examples</h3>
          <div className={styles.examples}>
            {problem.examples.map((example, exampleIndex) => (
              <div key={`${example.input}-${exampleIndex}`} className={styles.example}>
                <div className={styles.exampleHead}>
                  <span>Example {exampleIndex + 1}</span>
                  {example.note ? <span className={styles.exampleNote}>{example.note}</span> : null}
                </div>
                <div className={styles.exampleGrid}>
                  <div>
                    <span className={styles.streamLabel}>Input</span>
                    <pre>{example.input || '(empty)'}</pre>
                  </div>
                  <div>
                    <span className={styles.streamLabel}>Output</span>
                    <pre>{example.output || '(empty)'}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className={styles.hiddenNote}>
            <Lock size={11} aria-hidden="true" />
            The grader also runs private cases. Their inputs and expected outputs are never sent to
            this page — only pass/fail statuses are returned.
          </p>

          <section className={styles.hints} aria-label="Progressive hints">
            <div className={styles.hintsHead}>
              <h3 className={styles.sectionTitle}>
                <ListChecks size={12} aria-hidden="true" />
                Hints
                <span>
                  {hintsShown}/{problem.hints.length}
                </span>
              </h3>
              <div className={styles.hintButtons}>
                {hintsShown < problem.hints.length ? (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setHintsShown((count) => Math.min(problem.hints.length, count + 1))}
                  >
                    Reveal hint {hintsShown + 1}
                  </button>
                ) : null}
                {hintsShown > 0 ? (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setHintsShown(0)}
                  >
                    Hide hints
                  </button>
                ) : null}
              </div>
            </div>
            {hintsShown === 0 ? (
              <p className={styles.hintEmpty}>
                Hints unlock one at a time, from a nudge to a direct technique. Nothing is revealed
                until you ask.
              </p>
            ) : (
              <ol className={styles.hintList}>
                {problem.hints.slice(0, hintsShown).map((hint, hintIndex) => (
                  <li key={hint}>
                    <span>Hint {hintIndex + 1}</span>
                    {hint}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={styles.explain} aria-label="Explanation and solution">
            <div className={styles.explainHead}>
              <h3 className={styles.sectionTitle}>Explanation</h3>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setShowExplanation((value) => !value)}
                aria-expanded={showExplanation}
              >
                {showExplanation ? 'Hide' : 'Show explanation'}
                <ChevronDown size={12} aria-hidden="true" data-open={showExplanation} />
              </button>
            </div>
            {showExplanation ? (
              <p className={styles.bodyText}>{problem.explanation}</p>
            ) : null}

            <div className={styles.solutionHead}>
              <h3 className={styles.sectionTitle}>Reference solution</h3>
              {!showSolution ? (
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setPendingSolution(true)}
                >
                  Reveal solution
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setShowSolution(false)}
                >
                  Hide solution
                </button>
              )}
            </div>

            {pendingSolution ? (
              <div className={styles.confirmBox} role="alertdialog" aria-label="Confirm solution reveal">
                <p>
                  Reveal the full reference solution before you have solved the problem? It is shown
                  in Python with its approach and complexity.
                </p>
                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => {
                      setShowSolution(true)
                      setPendingSolution(false)
                    }}
                  >
                    Reveal anyway
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setPendingSolution(false)}
                  >
                    Keep it hidden
                  </button>
                </div>
              </div>
            ) : null}

            {showSolution ? (
              <div className={styles.solution}>
                <p className={styles.bodyText}>
                  <strong>Approach.</strong> {problem.solution.approach}
                </p>
                <p className={styles.complexity}>{problem.solution.complexity}</p>
                <pre className={styles.solutionCode}>{problem.solution.code}</pre>
                <p className={styles.solutionNote}>
                  The reference solution is written in Python and is not submitted automatically.
                  Adapt it to {languageInfo.label} to run it in this workspace.
                </p>
              </div>
            ) : null}
          </section>
        </section>

        <section className={styles.workbench} aria-label="Practice workspace">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelKicker}>Workspace</p>
              <h2 className={styles.panelTitle}>{languageInfo.label}</h2>
            </div>
            <div className={styles.workbenchControls}>
              <div className={styles.languageSelect}>
                <Select
                  value={language}
                  onChange={switchLanguage}
                  options={LANGUAGE_LABELS}
                  ariaLabel="Practice language"
                  compact
                />
              </div>
              <span className={styles.saveState} data-state={saveState}>
                {saveState === 'saving' ? (
                  <>
                    <LoaderCircle size={10} className={styles.spin} aria-hidden="true" /> Saving draft
                  </>
                ) : saveState === 'saved' ? (
                  <>
                    <Check size={10} aria-hidden="true" /> Draft saved
                  </>
                ) : (
                  'Draft not stored yet'
                )}
              </span>
            </div>
          </div>

          <div className={styles.toolbar}>
            {running || submitting ? (
              <button type="button" className={styles.stopButton} onClick={() => void stop()}>
                <Square size={12} aria-hidden="true" />
                Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.runButton}
                  onClick={() => void runVisible()}
                  disabled={!runnable || !code.trim()}
                  title={
                    online
                      ? 'Run only the visible example cases'
                      : 'Start the local execution service with npm run exec'
                  }
                >
                  <Play size={12} aria-hidden="true" />
                  Run visible
                </button>
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={() => void submit()}
                  disabled={!runnable || !code.trim()}
                  title="Submit against the full private suite"
                >
                  <Trophy size={12} aria-hidden="true" />
                  Submit
                </button>
              </>
            )}
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPendingReset(true)}
              disabled={running || submitting}
            >
              <RotateCcw size={12} aria-hidden="true" />
              Reset to starter
            </button>
            <span className={styles.runtimeChip} data-ok={online && runnable}>
              <Terminal size={11} aria-hidden="true" />
              {online
                ? runnable
                  ? `${languageInfo.label} runtime ready`
                  : `${languageInfo.label} unavailable`
                : 'Execution service offline'}
            </span>
          </div>

          {pendingReset ? (
            <div className={styles.confirmBox} role="alertdialog" aria-label="Confirm reset">
              <p>
                Replace the current {languageInfo.label} draft with the starter template? Your stored
                draft for this language is overwritten when the debounce saves again.
              </p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.ghostButton} onClick={resetDraft}>
                  Reset draft
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setPendingReset(false)}
                >
                  Keep draft
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.editor}>
            <StandaloneEditor
              value={code}
              language={languageInfo.monaco}
              onChange={setCurrentCode}
              ariaLabel={`${problem.title} solution in ${languageInfo.label}`}
            />
          </div>

          <p className={styles.editorNote}>
            {problem.visibleTests.length} visible cases · private hidden cases · drafts persist per
            language in IndexedDB.
          </p>

          {runError ? (
            <p className={styles.errorNote} role="alert">
              <TriangleAlert size={12} aria-hidden="true" />
              {runError}
            </p>
          ) : null}

          {runResult ? (
            <div className={styles.resultBlock} aria-live="polite">
              <div className={styles.resultHead}>
                <span className={styles.resultTitle}>
                  <ListChecks size={12} aria-hidden="true" />
                  Visible case results
                </span>
                <span className={styles.resultMeta}>
                  {visiblePassed}/{visibleOutcomes.length} passed ·{' '}
                  {runResult.results.reduce((sum, entry) => sum + entry.durationMs, 0)} ms measured
                </span>
              </div>
              {runResult.status === 'compile_error' ? (
                <pre className={styles.stream} data-stream="stderr">
                  {runResult.message ?? 'Compilation failed.'}
                </pre>
              ) : (
                <ul className={styles.caseList}>
                  {visibleOutcomes.map((outcome) => (
                    <li key={outcome.index} data-passed={outcome.passed}>
                      <div className={styles.caseHead}>
                        <span className={styles.caseName}>
                          {outcome.passed ? (
                            <Check size={11} aria-hidden="true" />
                          ) : (
                            <X size={11} aria-hidden="true" />
                          )}
                          Visible case {outcome.index + 1}
                        </span>
                        <span className={styles.caseMeta}>
                          {outcome.status} · {outcome.durationMs} ms
                        </span>
                      </div>
                      {!outcome.passed ? (
                        <div className={styles.caseDetail}>
                          <div>
                            <span className={styles.streamLabel}>stdin</span>
                            <pre>{outcome.stdin || '(empty)'}</pre>
                          </div>
                          <div>
                            <span className={styles.streamLabel}>expected</span>
                            <pre>{outcome.expected || '(empty)'}</pre>
                          </div>
                          <div>
                            <span className={styles.streamLabel}>your stdout</span>
                            <pre>{outcome.stdout || '(empty)'}</pre>
                          </div>
                          {outcome.stderr ? (
                            <div>
                              <span className={styles.streamLabel}>stderr</span>
                              <pre>{outcome.stderr.slice(0, 1200)}</pre>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {gradeError ? (
            <p className={styles.errorNote} role="alert">
              <TriangleAlert size={12} aria-hidden="true" />
              {gradeError}
            </p>
          ) : null}

          {grade ? (
            <div className={styles.verdict} data-state={answerState} aria-live="polite">
              <div className={styles.verdictHead}>
                <span className={styles.verdictLabel}>
                  {grade.verdict === 'accepted' ? (
                    <>
                      <CheckCircle2 size={16} aria-hidden="true" /> Accepted
                    </>
                  ) : grade.verdict === 'wrong_answer' ? (
                    <>
                      <X size={16} aria-hidden="true" /> Wrong answer
                    </>
                  ) : grade.verdict === 'compile_error' ? (
                    <>
                      <TriangleAlert size={16} aria-hidden="true" /> Compilation failed
                    </>
                  ) : grade.verdict === 'time_limit_exceeded' ? (
                    <>
                      <Clock size={16} aria-hidden="true" /> Time limit exceeded
                    </>
                  ) : grade.verdict === 'runtime_error' ? (
                    <>
                      <CircleSlash size={16} aria-hidden="true" /> Runtime error
                    </>
                  ) : grade.verdict === 'unsupported_language' ? (
                    <>
                      <CircleSlash size={16} aria-hidden="true" /> Language unsupported
                    </>
                  ) : (
                    <>
                      <Circle size={16} aria-hidden="true" /> {grade.verdict}
                    </>
                  )}
                </span>
                <span className={styles.verdictScore}>
                  {grade.passed}/{grade.total} cases
                  {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}
                </span>
              </div>
              {grade.message ? <p className={styles.verdictMessage}>{grade.message}</p> : null}
              {grade.verdict === 'compile_error' && grade.compile ? (
                <pre className={styles.stream} data-stream="stderr">
                  {grade.compile.stderr || grade.compile.stdout || 'Compilation failed.'}
                </pre>
              ) : (
                <ul className={styles.caseList}>
                  {grade.cases.map((entry) => (
                    <li key={entry.index} data-passed={entry.status === 'passed'}>
                      <div className={styles.caseHead}>
                        <span className={styles.caseName}>
                          {entry.hidden ? (
                            <Lock size={11} aria-hidden="true" />
                          ) : entry.status === 'passed' ? (
                            <Check size={11} aria-hidden="true" />
                          ) : (
                            <X size={11} aria-hidden="true" />
                          )}
                          {entry.hidden ? `Hidden case ${entry.index + 1}` : `Visible case ${entry.index + 1}`}
                        </span>
                        <span className={styles.caseMeta}>
                          {entry.status} · {entry.durationMs} ms
                        </span>
                      </div>
                      {entry.hidden ? (
                        <p className={styles.hiddenCaseNote}>
                          Input and expected output stay on the grading service. Only the status is
                          returned.
                        </p>
                      ) : entry.stderr ? (
                        <pre className={styles.stream} data-stream="stderr">
                          {entry.stderr}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {attemptError ? <p className={styles.errorNote}>{attemptError}</p> : null}
            </div>
          ) : null}

          <section className={styles.submissions} aria-label="Submission history">
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Recent submissions</h3>
              <span>{submissions.length} stored</span>
            </div>
            {submissions.length === 0 ? (
              <p className={styles.hintEmpty}>
                No submissions stored for this problem yet. Each real grading response is appended
                here with its verdict language and timing.
              </p>
            ) : (
              <ul className={styles.submissionList}>
                {submissions.slice(0, 6).map((entry) => (
                  <li key={entry.id}>
                    <span data-verdict={entry.verdict}>{entry.verdict}</span>
                    <span>{projectLanguage(entry.language).label}</span>
                    <span>
                      {entry.passed}/{entry.total}
                    </span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.notes} aria-label="Personal notes">
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>
                <NotebookPen size={12} aria-hidden="true" />
                Notes
              </h3>
              <span>Saves automatically</span>
            </div>
            <textarea
              className={styles.notesArea}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Approach, edge cases, mistakes to remember"
            />
          </section>

          <QuickAiPanel
            key={problem.id}
            context={aiContext}
            scope={`${problem.title} in ${languageInfo.label}`}
            suggestions={[
              'Explain why my current code fails the visible cases',
              'Give me a hint without telling me the solution',
              'Review my approach for edge cases',
            ]}
          />
        </section>
      </div>
    </main>
  )
}
