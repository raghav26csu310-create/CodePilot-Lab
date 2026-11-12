import {
  Activity,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Lock,
  PanelBottom,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { formatBytes } from '../../../lib/format'
import { languageForPath } from '../../editor/languageRegistry'
import { useCopilot } from '../../copilot/CopilotContext'
import { providerLabel } from '../../copilot/providerPresets'
import { useAiSettings } from '../../copilot/settingsStore'
import { findNode } from '../state/fileTree'
import type { BottomPanelTab } from '../state/types'
import { useWorkspace } from '../state/useWorkspace'
import { WorkspaceRunPanel } from './WorkspaceRunPanel'
import styles from './DevelopmentPanel.module.css'

const TABS: {
  id: BottomPanelTab
  label: string
  icon: typeof Terminal
}[] = [
  { id: 'run', label: 'Run', icon: Play },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'output', label: 'Output', icon: PanelBottom },
  { id: 'problems', label: 'Problems', icon: TriangleAlert },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
]

export function DevelopmentPanel({ height }: { height: number }) {
  const { project, state, dispatch, stats } = useWorkspace()
  const { ui, tree } = state
  const activeNode = tree.activeTabPath ? findNode(tree.nodes, tree.activeTabPath) : null
  const errorCount = ui.markers.filter((marker) => marker.severity === 'error').length

  const selectTab = (tab: BottomPanelTab) => {
    dispatch({ type: 'ui/set-bottom-tab', tab })
  }

  return (
    <section
      className={styles.panel}
      aria-label="Development panel"
      style={{ height: ui.bottomOpen ? height : 34 }}
    >
      <div className={styles.bar}>
        <div className={styles.tabList} role="tablist" aria-label="Development panel views">
          {TABS.map((tab, index) => {
            const Icon = tab.icon
            const active = ui.bottomTab === tab.id

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`devtab-${tab.id}`}
                aria-selected={active}
                aria-controls={`devpanel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                data-bottom-tab={tab.id}
                className={styles.tab}
                data-active={active}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                    return
                  }
                  event.preventDefault()
                  const direction = event.key === 'ArrowRight' ? 1 : -1
                  const next = TABS[(index + direction + TABS.length) % TABS.length]
                  if (!next) {
                    return
                  }
                  dispatch({ type: 'ui/set-bottom-tab', tab: next.id })
                  window.requestAnimationFrame(() => {
                    document
                      .querySelector<HTMLButtonElement>(`[data-bottom-tab="${next.id}"]`)
                      ?.focus()
                  })
                }}
              >
                <Icon size={12} aria-hidden="true" />
                <span>{tab.label}</span>
                {tab.id === 'problems' ? (
                  <span
                    className={errorCount === 0 ? styles.zero : styles.countHit}
                    data-hit={errorCount > 0}
                    aria-label={errorCount === 0 ? 'No collected problems' : `${errorCount} errors collected`}
                  >
                    {errorCount === 0 ? '0' : errorCount}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <div className={styles.barRight}>
          <span className={styles.barNote}>Local session</span>
          <button
            type="button"
            className={styles.collapse}
            aria-expanded={ui.bottomOpen}
            onClick={() => dispatch({ type: 'ui/toggle-bottom' })}
            title={ui.bottomOpen ? 'Collapse development panel' : 'Expand development panel'}
            aria-label={ui.bottomOpen ? 'Collapse development panel' : 'Expand development panel'}
          >
            {ui.bottomOpen ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronUp size={14} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {ui.bottomOpen ? (
        <div
          className={styles.content}
          id={`devpanel-${ui.bottomTab}`}
          role="tabpanel"
          aria-labelledby={`devtab-${ui.bottomTab}`}
        >
          {ui.bottomTab === 'run' ? <WorkspaceRunPanel activePath={activeNode?.path ?? null} /> : null}
          {ui.bottomTab === 'terminal' ? <TerminalView /> : null}
          {ui.bottomTab === 'output' ? <OutputView /> : null}
          {ui.bottomTab === 'problems' ? <ProblemsView /> : null}
          {ui.bottomTab === 'diagnostics' ? (
            <DiagnosticsView
              activePath={activeNode?.path ?? null}
              sessionFiles={stats.files}
              sessionFolders={stats.folders}
              expandedCount={tree.expanded.length}
              tabCount={tree.tabs.length}
              dirtyCount={tree.tabs.filter((tab) => tab.dirty).length}
              markerCount={ui.markers.length}
              projectName={project.name}
              entryCount={stats.files + stats.folders}
              truncated={project.truncated}
              excludedCount={project.excluded.length}
              sizeBytes={project.sizeBytes}
              folderHandle={Boolean(project.directoryHandle)}
              onResetLayout={() => dispatch({ type: 'ui/reset-layout' })}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function PanelEmpty({
  icon,
  kicker,
  title,
  copy,
  chips,
  action,
}: {
  icon: ReactNode
  kicker: string
  title: string
  copy: string
  chips: string[]
  action?: React.ReactNode
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      <p className={styles.emptyKicker}>{kicker}</p>
      <h3 className={styles.emptyTitle}>{title}</h3>
      <p className={styles.emptyCopy}>{copy}</p>
      <ul className={styles.chips}>
        {chips.map((chip) => (
          <li key={chip}>{chip}</li>
        ))}
      </ul>
      {action}
    </div>
  )
}

function TerminalView() {
  return (
    <PanelEmpty
      icon={<Terminal size={20} />}
      kicker="Terminal · not connected"
      title="No terminal session"
      copy="There is no interactive shell in this build. Program execution is real: use the Run tab, which sends the active file to the local execution service and shows its actual output. This terminal surface shows no shell because none exists."
      chips={['Shell · not connected', 'Run tab · real execution', 'Working dir · project root']}
      action={
        <button type="button" className={styles.disabledAction} disabled>
          <Lock size={12} aria-hidden="true" />
          Start terminal · unavailable
        </button>
      }
    />
  )
}

function OutputView() {
  return (
    <PanelEmpty
      icon={<PanelBottom size={20} />}
      kicker="Output · no channels"
      title="No output has been produced"
      copy="Build, task and extension channels appear only after a real process runs. The panel is empty because nothing has run — this is not a successful build claim."
      chips={['No tasks executed', 'No build results', 'No channels registered']}
    />
  )
}

function ProblemsView() {
  const { state, dispatch } = useWorkspace()
  const { seedComposer } = useCopilot()
  const markers = state.ui.markers

  const askAboutMarker = (index: number) => {
    const marker = markers[index]
    if (!marker) {
      return
    }

    seedComposer(
      [
        `${marker.severity.toUpperCase()} in ${marker.path}:${marker.line}:${marker.column}`,
        marker.message,
        '',
        'Explain the root cause from the diagnostic and the shared code, then propose the complete corrected file if a change is needed.',
      ].join('\n'),
      'debug',
    )
  }

  if (markers.length === 0) {
    return (
      <div className={styles.problems}>
        <div className={styles.problemsMain}>
          <PanelEmpty
            icon={<TriangleAlert size={20} />}
            kicker="Problems · collected from open buffers"
            title="No diagnostics produced right now"
            copy="Diagnostics come from the real Monaco models that are open — nothing is simulated. TypeScript and JavaScript get the full language service; other languages are highlighted only and can raise no diagnostics. Import-resolution codes (2307, 2792, 6133) are ignored because there is no project-wide module graph."
            chips={['Eager model sync · on', 'Ignored codes · imports', 'Coverage disclosure in Diagnostics']}
          />
        </div>
        <dl className={styles.problemCounts} aria-label="Collected problem counts">
          <div>
            <dt>Errors</dt>
            <dd>0</dd>
          </div>
          <div>
            <dt>Warnings</dt>
            <dd>0</dd>
          </div>
          <div>
            <dt>Information</dt>
            <dd>0</dd>
          </div>
        </dl>
      </div>
    )
  }

  const errors = markers.filter((marker) => marker.severity === 'error').length
  const warnings = markers.filter((marker) => marker.severity === 'warning').length
  const infos = markers.length - errors - warnings

  return (
    <div className={styles.problems} data-populated="true">
      <div className={styles.problemsMain}>
        <ul className={styles.problemList} aria-label="Collected problems">
          {markers.map((marker, index) => (
            <li
              key={`${marker.path}:${marker.line}:${marker.column}:${index}`}
              className={styles.problemItem}
            >
              <button
                type="button"
                className={styles.problemRow}
                onClick={() =>
                  dispatch({
                    type: 'ui/set-pending-reveal',
                    reveal: { path: marker.path, line: marker.line, column: marker.column },
                  })
                }
                title="Open in editor"
              >
                <span
                  className={styles.problemSeverity}
                  data-severity={marker.severity}
                  aria-label={`${marker.severity} problem`}
                />
                <span className={styles.problemText}>{marker.message}</span>
                <span className={styles.problemLocationMono}>
                  {marker.path}:{marker.line}:{marker.column}
                </span>
                <span className={styles.problemOwner}>{marker.source}</span>
              </button>
              <button
                type="button"
                className={styles.problemAsk}
                onClick={() => askAboutMarker(index)}
                title="Ask Copilot about this problem"
                aria-label={`Ask Copilot about: ${marker.message}`}
              >
                <Sparkles size={11} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <dl className={styles.problemCounts} aria-label="Collected problem counts">
        <div>
          <dt>Errors</dt>
          <dd>{errors}</dd>
        </div>
        <div>
          <dt>Warnings</dt>
          <dd>{warnings}</dd>
        </div>
        <div>
          <dt>Information</dt>
          <dd>{infos}</dd>
        </div>
      </dl>
    </div>
  )
}

function DiagnosticsView({
  activePath,
  sessionFiles,
  sessionFolders,
  expandedCount,
  tabCount,
  dirtyCount,
  markerCount,
  projectName,
  entryCount,
  truncated,
  excludedCount,
  sizeBytes,
  folderHandle,
  onResetLayout,
}: {
  activePath: string | null
  sessionFiles: number
  sessionFolders: number
  expandedCount: number
  tabCount: number
  dirtyCount: number
  markerCount: number
  projectName: string
  entryCount: number
  truncated: boolean
  excludedCount: number
  sizeBytes: number
  folderHandle: boolean
  onResetLayout: () => void
}) {
  const validation =
    activePath === null
      ? 'None open'
      : languageForPath(activePath).validation === 'language-service'
        ? 'Language service active'
        : 'Syntax highlighting only'

  const ai = useAiSettings()
  const aiManaged = ai.settings.provider === 'gateway'
  const aiConfigured = aiManaged
    ? true
    : ai.settings.baseUrl.trim().length > 0 && ai.settings.model.trim().length > 0
  const aiVerification = !aiConfigured
    ? 'Not configured'
    : aiManaged
      ? 'Checked by the API gateway'
      : ai.lastTest?.ok
        ? 'Endpoint responded · session'
        : 'Unverified'

  return (
    <div className={styles.diagnostics}>
      <div className={styles.diagHead}>
        <div>
          <p className={styles.emptyKicker}>Computed from the stored record and live session state</p>
          <h3 className={styles.diagTitle}>Workspace diagnostics</h3>
        </div>
        <span className={styles.diagTag}>
          <span className={styles.diagDot} aria-hidden="true" />
          Live session
        </span>
      </div>

      <dl className={styles.diagGrid}>
        <DiagRow label="Project" value={projectName} />
        <DiagRow label="Registry" value="IndexedDB · editor read-write" />
        <DiagRow label="Stored entries" value={String(entryCount)} />
        <DiagRow label="Session files" value={String(sessionFiles)} />
        <DiagRow label="Session folders" value={String(sessionFolders)} />
        <DiagRow label="Expanded folders" value={String(expandedCount)} />
        <DiagRow label="Open tabs" value={String(tabCount)} />
        <DiagRow label="Unsaved buffers" value={String(dirtyCount)} />
        <DiagRow label="Collected problems" value={String(markerCount)} />
        <DiagRow
          label="Editor validation"
          value={
            activePath === null
              ? validation
              : `${validation} · ${activePath.split('/').pop() ?? activePath}`
          }
          mono
        />
        <DiagRow label="Active file" value={activePath ?? 'None'} mono />
        <DiagRow
          label="Import scan"
          value={truncated ? 'Capped during import (manifests)' : 'Complete scan (manifests)'}
        />
        <DiagRow label="Import size" value={formatBytes(sizeBytes)} />
        <DiagRow
          label="Folder link"
          value={folderHandle ? 'Handle stored · used as read fallback' : 'Manifest only'}
        />
        <DiagRow
          label="Excluded"
          value={excludedCount > 0 ? `${excludedCount} directories disclosed` : 'None encountered'}
        />
        <DiagRow label="Tree persistence" value="IndexedDB · survives reload" />
        <DiagRow label="Layout" value="localStorage preferences" />
        <DiagRow
          label="AI provider"
          value={aiConfigured ? providerLabel(ai.settings) : 'Not configured'}
        />
        <DiagRow label="AI model" value={ai.settings.model || 'provider default'} mono />
        <DiagRow label="AI verification" value={aiVerification} />
        <DiagRow
          label="AI key"
          value={
            aiManaged
              ? 'Server-side · none in this browser'
              : ai.settings.apiKey
                ? ai.settings.rememberKey
                  ? 'Remembered in IndexedDB (plaintext)'
                  : 'Memory only · this tab'
                : 'None'
          }
        />
        <DiagRow label="AI requests" value="Only on explicit Send" />
      </dl>

      <div className={styles.diagFoot}>
        <button type="button" className={styles.diagAction} onClick={onResetLayout}>
          <RotateCcw size={12} aria-hidden="true" />
          Reset panel layout
        </button>
        <span className={styles.diagNote}>
          <CircleSlash size={11} aria-hidden="true" />
          No fabricated metrics
        </span>
      </div>
    </div>
  )
}

function DiagRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className={styles.diagRow}>
      <dt>{label}</dt>
      <dd data-mono={mono} title={value}>
        {value}
      </dd>
    </div>
  )
}
