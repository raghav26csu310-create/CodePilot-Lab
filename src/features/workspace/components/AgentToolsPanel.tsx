import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FileCode2,
  FolderTree,
  Loader2,
  PackageSearch,
  Play,
  Search,
  Square,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'

import { buildProjectExecutionSnapshot } from '../../copilot/agent/projectTools'
import { useCopilot } from '../../copilot/CopilotContext'
import { languageForPath } from '../../editor/languageRegistry'
import { useWorkspace } from '../state/useWorkspace'
import { findTestEntryPaths } from '../../copilot/agent/projectTools'
import styles from './AgentToolsPanel.module.css'

const PROJECT_RUN_LANGUAGES = new Set(['python', 'javascript', 'typescript'])

export function AgentToolsPanel() {
  const { project, state } = useWorkspace()
  const {
    agentReport,
    agentActivity,
    agentRun,
    inspectProject,
    runProjectTest,
    cancelProjectTest,
    toggleContextPath,
    send,
  } = useCopilot()
  const [query, setQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [working, setWorking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const testPaths = useMemo(
    () => findTestEntryPaths(state.tree.nodes),
    [state.tree.nodes],
  )
  const activeTestPath =
    testPaths.includes(selectedPath) ? selectedPath : testPaths[0] ?? ''
  const testLanguage = activeTestPath ? languageForPath(activeTestPath).id : ''
  const canRunTest = PROJECT_RUN_LANGUAGES.has(testLanguage)
  const isRunning = agentActivity.some(
    (activity) => activity.tool === 'run-test' && activity.status === 'running',
  )

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setActionError(null)
    await inspectProject(query)
  }

  const approveAndRun = async () => {
    if (!activeTestPath || !canRunTest || working || isRunning) {
      return
    }

    setWorking(true)
    setActionError(null)
    try {
      const report = await inspectProject(activeTestPath)
      if (!report) {
        setActionError('Project inspection failed. Review the activity details before retrying.')
        return
      }
      const snapshot = buildProjectExecutionSnapshot(report, activeTestPath, testLanguage)
      const paths = snapshot.includedPaths.map((path) => `  • ${path}`).join('\n')
      const external = snapshot.externalImports.length
        ? `\nImports not copied or installed (external packages may fail):\n  ${snapshot.externalImports.join(', ')}`
        : ''
      const approved = window.confirm(
        `Run this project test using the local execution service?\n\nEntry: ${activeTestPath}\nFiles staged in a temporary directory (${snapshot.files.length}):\n${paths}${external}\n\nThis runs real project code with your OS permissions. The runner is resource-limited, not a security sandbox. No shell command or package install will be run.\n\nContinue?`,
      )
      if (!approved) {
        return
      }
      await runProjectTest(activeTestPath, testLanguage, snapshot)
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The project test snapshot could not be prepared.',
      )
    } finally {
      setWorking(false)
    }
  }

  const analyzeFailure = () => {
    if (!agentRun || agentRun.response.status === 'ok') {
      return
    }
    const response = agentRun.response
    const evidence = [
      `Entry: ${agentRun.entryPath}`,
      `Language: ${agentRun.language}`,
      `Actual execution status: ${response.status}`,
      `Service message: ${response.message ?? '(none)'}`,
      ...response.results.flatMap((result, index) => [
        `Result ${index + 1}: ${result.status}; exit code ${result.exitCode ?? '(none)'}; duration ${result.durationMs} ms.`,
        `stdout:\n${result.stdout.slice(0, 8_000) || '(empty)'}`,
        `stderr:\n${result.stderr.slice(0, 8_000) || '(empty)'}`,
      ]),
      response.compile
        ? `Compile: exit code ${response.compile.exitCode ?? '(none)'}\n${response.compile.stderr.slice(0, 8_000)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    void send(
      `Analyze this actual local test result. Separate observed output from hypotheses and suggest the smallest corrective change:\n\n${evidence}`,
      { capability: 'debug', agentEvidence: evidence },
    )
  }

  return (
    <section className={styles.panel} aria-label="Project coding agent tools">
      <header className={styles.header}>
        <div>
          <p>Scoped local tools</p>
          <h2>
            <FolderTree size={14} />
            {project.name}
          </h2>
        </div>
        <span>Workspace only</span>
      </header>

      <form className={styles.search} onSubmit={(event) => void submitSearch(event)}>
        <label htmlFor="agent-project-search">Search actual project contents</label>
        <div>
          <input
            id="agent-project-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search term or short phrase"
          />
          <button type="submit" disabled={working} aria-label="Inspect and search project">
            {working ? <Loader2 className={styles.spin} size={13} /> : <Search size={13} />}
            Inspect
          </button>
        </div>
      </form>

      {agentReport ? (
        <div className={styles.report}>
          <p className={styles.scanSummary}>
            Read {agentReport.filesRead} of {agentReport.totalProjectFiles} project file entries
            · {agentReport.totalBytesRead.toLocaleString()} bytes
          </p>
          {agentReport.dependencies.length > 0 ? (
            <div className={styles.reportGroup}>
              <h3>
                <PackageSearch size={12} /> Dependencies
              </h3>
              {agentReport.dependencies.map((manifest) => (
                <p key={manifest.manifest}>
                  <strong>{manifest.manifest}</strong>
                  {manifest.names.length ? ` · ${manifest.names.join(', ')}` : ' · none detected'}
                </p>
              ))}
            </div>
          ) : null}
          {agentReport.search.query.trim() ? (
            <div className={styles.reportGroup}>
              <h3>Search · {agentReport.search.totalMatches} matching line(s)</h3>
              {agentReport.search.hits.slice(0, 8).map((hit) => (
                <div className={styles.hit} key={`${hit.path}:${hit.line}`}>
                  <span title={`${hit.path}:${hit.line}`}>
                    {hit.path}:{hit.line}
                  </span>
                  <code>{hit.preview}</code>
                  <button
                    type="button"
                    onClick={() => toggleContextPath(hit.path)}
                    aria-label={`${state.ui.copilotContext.includes(hit.path) ? 'Remove' : 'Attach'} ${hit.path} to Copilot context`}
                    title={
                      state.ui.copilotContext.includes(hit.path)
                        ? 'Remove from model context'
                        : 'Attach this file to model context'
                    }
                  >
                    {state.ui.copilotContext.includes(hit.path) ? <CheckCircle2 size={12} /> : <FileCode2 size={12} />}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {agentReport.imports.length > 0 ? (
            <div className={styles.reportGroup}>
              <h3>Imports · {agentReport.imports.length} references</h3>
              {agentReport.imports.slice(0, 8).map((reference) => (
                <p key={`${reference.path}:${reference.line}:${reference.specifier}`}>
                  <span>{reference.path}:{reference.line}</span>
                  {' → '}
                  <code>{reference.resolvedPath ?? reference.specifier}</code>
                  {reference.kind === 'unresolved' ? ' · not read' : ''}
                </p>
              ))}
            </div>
          ) : null}
          {agentReport.omittedCount > 0 ? (
            <p className={styles.omissions}>
              <AlertTriangle size={12} />
              {agentReport.omittedCount} file(s) omitted by type/security/read limits. The report
              names readable omissions; sensitive paths are not disclosed.
            </p>
          ) : null}
        </div>
      ) : (
        <p className={styles.hint}>
          Inspection reads only this workspace’s stored files and live editor drafts. Sensitive
          paths and vendor/build folders are excluded; nothing is sent to AI until you press Send.
        </p>
      )}

      <div className={styles.testRun}>
        <div>
          <h3>Run a project test entry</h3>
          <p>Uses a bounded snapshot and the existing local execution sidecar; no shell commands.</p>
        </div>
        {testPaths.length > 0 ? (
          <select
            value={activeTestPath}
            onChange={(event) => setSelectedPath(event.target.value)}
            aria-label="Project test entry"
          >
            {testPaths.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        ) : (
          <p className={styles.hint}>No test entry file was found in the project tree.</p>
        )}
        {activeTestPath && !canRunTest ? (
          <p className={styles.hint}>
            Project test snapshots currently support Python, JavaScript and TypeScript entries.
            Other languages remain available through the existing single-file Run panel.
          </p>
        ) : null}
        <div className={styles.runActions}>
          <button
            type="button"
            onClick={() => void approveAndRun()}
            disabled={!canRunTest || working || isRunning}
          >
            {working ? <Loader2 className={styles.spin} size={13} /> : <Play size={13} />}
            {working ? 'Preparing…' : 'Review and run'}
          </button>
          {isRunning ? (
            <button type="button" className={styles.stop} onClick={() => void cancelProjectTest()}>
              <Square size={12} /> Stop test
            </button>
          ) : null}
        </div>
        <p className={styles.disclaimer}>
          Snapshot caps: {120} files / 600,000 source bytes / 120,000 bytes per file. Project
          packages are not installed. This resource-limited runner is not a sandbox.
        </p>
      </div>

      {agentRun ? (
        <div className={styles.result} role="status">
          <div className={styles.resultHead}>
            <strong>
              {agentRun.entryPath} · {agentRun.response.status}
            </strong>
            {agentRun.response.status !== 'ok' ? (
              <button type="button" onClick={analyzeFailure}>
                Analyze with Copilot <ArrowUpRight size={11} />
              </button>
            ) : null}
          </div>
          {agentRun.response.message ? <p>{agentRun.response.message}</p> : null}
          {agentRun.response.compile?.stderr ? (
            <pre>{agentRun.response.compile.stderr.slice(0, 4_000)}</pre>
          ) : null}
          {agentRun.response.results.map((result, index) => (
            <div className={styles.output} key={`${agentRun.entryPath}:${index}`}>
              <p>{result.status} · exit {result.exitCode ?? 'not reported'} · {result.durationMs} ms</p>
              {result.stdout ? <pre>{result.stdout.slice(0, 4_000)}</pre> : null}
              {result.stderr ? <pre>{result.stderr.slice(0, 4_000)}</pre> : null}
            </div>
          ))}
        </div>
      ) : null}

      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}

      <details className={styles.activity}>
        <summary>Tool activity · {agentActivity.length}</summary>
        {agentActivity.length ? (
          <ul>
            {agentActivity.slice(0, 6).map((activity) => (
              <li key={activity.id} data-status={activity.status}>
                <span>{activity.tool === 'inspect-project' ? 'Inspect' : 'Run test'}</span>
                <p>{activity.message}</p>
                <time>{new Date(activity.createdAt).toLocaleTimeString()}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>No local agent tools have run in this session.</p>
        )}
      </details>
    </section>
  )
}
