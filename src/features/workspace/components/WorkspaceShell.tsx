import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowUpRight,
  FolderGit2,
  PanelBottom,
  PanelLeft,
  PanelRight,
} from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'

import { useMediaQuery } from '../../../lib/useMediaQuery'
import { languageForPath } from '../../editor/languageRegistry'
import { projectLanguageForMonaco } from '../../editor/projectLanguages'
import { useEditorCommands } from '../../editor/EditorCommandsContext'
import { CopilotDock } from './CopilotDock'
import { DevelopmentPanel } from './DevelopmentPanel'
import { EditorArea } from './EditorArea'
import { ExplorerPanel } from './ExplorerPanel'
import { QuickOpenPalette } from './QuickOpen'
import { ResizeHandle } from './ResizeHandle'
import { WorkspaceDialogs } from './WorkspaceDialogs'
import { WorkspaceDrawer } from './WorkspaceDrawer'
import { WorkspaceToast } from './WorkspaceToast'
import { DEFAULT_LAYOUT } from '../state/layoutPreference'
import { useWorkspace } from '../state/useWorkspace'
import styles from './WorkspaceShell.module.css'

const PANEL_TRANSITION = { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const }

export function WorkspaceShell() {
  const { project, state, dispatch, stats } = useWorkspace()
  const commands = useEditorCommands()
  const { ui } = state

  const isCompact = useMediaQuery('(max-width: 1023px)')
  const isWide = useMediaQuery('(min-width: 1360px)')

  const showExplorerInline = !isCompact && ui.explorerOpen
  const showCopilotInline = isWide && ui.copilotOpen
  const showExplorerDrawer = isCompact && ui.mobilePanel === 'explorer'
  const showCopilotDrawer = !isWide && ui.mobilePanel === 'copilot'

  const toggleExplorer = useCallback(() => {
    if (isCompact) {
      if (ui.mobilePanel === 'explorer') {
        dispatch({ type: 'ui/close-mobile-panel' })
      } else {
        dispatch({ type: 'ui/open-mobile-panel', panel: 'explorer' })
      }
      return
    }

    dispatch({ type: 'ui/toggle-explorer' })
  }, [dispatch, isCompact, ui.mobilePanel])

  const toggleCopilot = useCallback(() => {
    if (isWide) {
      dispatch({ type: 'ui/toggle-copilot' })
      return
    }

    if (ui.mobilePanel === 'copilot') {
      dispatch({ type: 'ui/close-mobile-panel' })
    } else {
      dispatch({ type: 'ui/open-mobile-panel', panel: 'copilot' })
    }
  }, [dispatch, isWide, ui.mobilePanel])

  const ensureExplorer = useCallback(() => {
    if (isCompact) {
      dispatch({ type: 'ui/open-mobile-panel', panel: 'explorer' })
      return
    }
    if (!ui.explorerOpen) {
      dispatch({ type: 'ui/toggle-explorer' })
    }
  }, [dispatch, isCompact, ui.explorerOpen])

  const ensureCopilot = useCallback(() => {
    if (isWide) {
      if (!ui.copilotOpen) {
        dispatch({ type: 'ui/toggle-copilot' })
      }
      return
    }
    dispatch({ type: 'ui/open-mobile-panel', panel: 'copilot' })
  }, [dispatch, isWide, ui.copilotOpen])

  const closeDrawer = useCallback(() => {
    dispatch({ type: 'ui/close-mobile-panel' })
  }, [dispatch])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return
      }

      if (event.key.toLocaleLowerCase() !== 'b') {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }

      event.preventDefault()
      toggleExplorer()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleExplorer])

  const explorerActive = isCompact ? ui.mobilePanel === 'explorer' : ui.explorerOpen
  const copilotActive = isWide ? ui.copilotOpen : ui.mobilePanel === 'copilot'

  /**
   * Global editing shortcuts. Inside the Monaco canvas the editor's own
   * keybinding service already owns Ctrl+S / Ctrl+Shift+S / Ctrl+P /
   * Ctrl+Shift+F / Ctrl+F, so the handler here covers every other focus
   * location (dock headers, panels, page body) and always blocks the browser
   * save/print dialogs.
   */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) {
        return
      }

      // Modal surfaces own the keyboard while open.
      if (ui.dialog || ui.palette) {
        return
      }

      const target = event.target
      const inEditor =
        target instanceof HTMLElement && target.closest('.monaco-editor') !== null
      if (inEditor) {
        // The Monaco session's registered commands handle these keys.
        return
      }

      const key = event.key.toLocaleLowerCase()
      const shift = event.shiftKey

      if (key === 's') {
        event.preventDefault()
        if (shift) {
          void commands.current?.saveAll()
        } else if (state.tree.activeTabPath) {
          void commands.current?.save(state.tree.activeTabPath)
        }
        return
      }

      if (key === 'p') {
        event.preventDefault()
        dispatch({ type: 'ui/open-palette', palette: 'files' })
        return
      }

      if (key === 'f') {
        if (shift) {
          event.preventDefault()
          dispatch({ type: 'ui/open-palette', palette: 'search' })
          return
        }

        event.preventDefault()
        const activeTab = state.tree.tabs.find(
          (tab) => tab.path === state.tree.activeTabPath,
        )
        if (activeTab?.status === 'ready') {
          commands.current?.focusFind()
        } else {
          dispatch({
            type: 'ui/show-toast',
            tone: 'warn',
            message: 'Find works inside an open file — open one first.',
          })
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    ui.dialog,
    ui.palette,
    commands,
    dispatch,
    state.tree.activeTabPath,
    state.tree.tabs,
  ])

  const activePath = state.tree.activeTabPath
  const activeTab = activePath ? state.tree.tabs.find((tab) => tab.path === activePath) : undefined
  const activeLanguage = activePath ? languageForPath(activePath) : null
  const activeProjectLanguage = activeLanguage ? projectLanguageForMonaco(activeLanguage.id) : null
  const dirtyCount = state.tree.tabs.filter((tab) => tab.dirty).length

  // BrowserRouter has no navigation blocker, so at minimum guard tab close and
  // reload while real unsaved editor drafts exist.
  useEffect(() => {
    if (dirtyCount === 0) {
      return
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyCount])

  return (
    <div
      className={styles.workspace}
      inert={ui.dialog !== null || ui.palette !== null || ui.mobilePanel !== null ? true : undefined}
    >
      <header className={styles.topbar}>
        <div className={styles.identityGroup}>
          <Link to="/" className={styles.back} title="Return to Command Center">
            <ArrowLeft size={15} aria-hidden="true" />
            <span className={styles.backLabel}>Command Center</span>
          </Link>

          <span className={styles.divider} aria-hidden="true" />

          <span className={styles.projectMark} aria-hidden="true">
            <FolderGit2 size={16} />
          </span>

          <div className={styles.projectCopy}>
            <p className={styles.kicker}>
              Code workspace
              <span className={styles.kickerSource}>
                · {project.source === 'created' ? 'Local record' : 'Imported folder'}
              </span>
            </p>
            <h1 className={styles.projectName} title={project.name}>
              {project.name}
            </h1>
          </div>

          <span
            className={styles.sessionChip}
            data-origin={project.directoryHandle ? 'linked' : 'browser'}
            title={
              project.directoryHandle
                ? 'Saves write the browser copy and, with write permission, the linked device folder.'
                : 'Saves stay in this browser’s IndexedDB. Link a device folder from the dossier to write device copies.'
            }
          >
            <span className={styles.sessionDot} aria-hidden="true" />
            {project.directoryHandle ? 'Folder linked' : 'Browser copy'}
          </span>

          <span className={styles.fileCount}>
            {stats.files} {stats.files === 1 ? 'file' : 'files'}
          </span>
        </div>

        <div className={styles.toolbar}>
          <Link
            to={`/workspace/${project.id}/overview`}
            className={styles.dossier}
            title="Open the project dossier"
          >
            <FolderGit2 size={13} aria-hidden="true" />
            <span className={styles.dossierLabel}>Dossier</span>
            <ArrowUpRight size={11} className={styles.dossierArrow} aria-hidden="true" />
          </Link>

          <div className={styles.toggles} role="group" aria-label="Workspace panels">
            <button
              type="button"
              className={styles.toggle}
              data-active={explorerActive}
              aria-pressed={explorerActive}
              onClick={toggleExplorer}
              title="Toggle project explorer · Ctrl/Cmd+B"
            >
              <PanelLeft size={14} aria-hidden="true" />
              <span className={styles.toggleLabel}>Explorer</span>
            </button>
            <button
              type="button"
              className={styles.toggle}
              data-active={copilotActive}
              aria-pressed={copilotActive}
              onClick={toggleCopilot}
              title="Toggle AI Copilot dock"
            >
              <PanelRight size={14} aria-hidden="true" />
              <span className={styles.toggleLabel}>Copilot</span>
            </button>
            <button
              type="button"
              className={styles.toggle}
              data-active={ui.bottomOpen}
              aria-pressed={ui.bottomOpen}
              onClick={() => dispatch({ type: 'ui/toggle-bottom' })}
              title="Toggle development panel"
            >
              <PanelBottom size={14} aria-hidden="true" />
              <span className={styles.toggleLabel}>Panel</span>
            </button>
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <AnimatePresence initial={false}>
          {showExplorerInline ? (
            <motion.aside
              key="explorer-inline"
              id="workspace-explorer"
              className={styles.panelShell}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: ui.explorerWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={PANEL_TRANSITION}
            >
              <div className={styles.panelInner} style={{ width: ui.explorerWidth }}>
                <ExplorerPanel />
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>

        {showExplorerInline ? (
          <ResizeHandle
            orientation="vertical"
            label="Resize project explorer"
            value={ui.explorerWidth}
            min={208}
            max={420}
            onChange={(width) => dispatch({ type: 'ui/set-explorer-width', width })}
            onReset={() => dispatch({ type: 'ui/set-explorer-width', width: DEFAULT_LAYOUT.explorerWidth })}
          />
        ) : null}

        <div className={styles.center}>
          <EditorArea
            onShowExplorer={ensureExplorer}
            onShowCopilot={ensureCopilot}
            copilotInline={isWide}
          />

          {ui.bottomOpen ? (
            <ResizeHandle
              orientation="horizontal"
              invert
              label="Resize development panel"
              value={ui.bottomHeight}
              min={132}
              max={440}
              onChange={(height) => dispatch({ type: 'ui/set-bottom-height', height })}
              onReset={() => dispatch({ type: 'ui/set-bottom-height', height: DEFAULT_LAYOUT.bottomHeight })}
            />
          ) : null}

          <DevelopmentPanel height={ui.bottomHeight} />
        </div>

        {showCopilotInline ? (
          <ResizeHandle
            orientation="vertical"
            invert
            label="Resize Copilot dock"
            value={ui.copilotWidth}
            min={272}
            max={480}
            onChange={(width) => dispatch({ type: 'ui/set-copilot-width', width })}
            onReset={() => dispatch({ type: 'ui/set-copilot-width', width: DEFAULT_LAYOUT.copilotWidth })}
          />
        ) : null}

        <AnimatePresence initial={false}>
          {showCopilotInline ? (
            <motion.aside
              key="copilot-inline"
              id="workspace-copilot"
              className={styles.panelShell}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: ui.copilotWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={PANEL_TRANSITION}
            >
              <div className={styles.panelInner} style={{ width: ui.copilotWidth }}>
                <CopilotDock onRequestClose={toggleCopilot} />
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>

      <footer className={styles.status} aria-label="Workspace status">
        <span className={styles.statusItem} data-tone={activeProjectLanguage?.runtime ? 'ok' : 'muted'}>
          <span className={styles.statusDot} aria-hidden="true" />
          {activeLanguage ? activeLanguage.label : 'No file open'}
        </span>
        <span className={styles.statusSep} aria-hidden="true" />
        <span className={styles.statusItem}>
          {activePath ?? 'Open a file from the explorer'}
        </span>
        {activeTab?.dirty ? (
          <>
            <span className={styles.statusSep} aria-hidden="true" />
            <span className={styles.statusItem} data-tone="warn">
              Unsaved changes
            </span>
          </>
        ) : null}
        <span className={styles.statusGrow} />
        <span className={styles.statusItem}>
          {activeProjectLanguage
            ? activeProjectLanguage.runtime
              ? 'Runnable in the Run tab'
              : 'Editor only · no runtime'
            : `${project.language} project`}
        </span>
        <span className={styles.statusSep} aria-hidden="true" />
        <span className={styles.statusItem}>{state.tree.tabs.length} open</span>
        {dirtyCount > 0 ? (
          <>
            <span className={styles.statusSep} aria-hidden="true" />
            <span className={styles.statusItem} data-tone="warn">
              {dirtyCount} unsaved
            </span>
          </>
        ) : null}
      </footer>

      <WorkspaceDialogs />
      <QuickOpenPalette />
      <WorkspaceToast />

      <AnimatePresence>
        {showExplorerDrawer ? (
          <WorkspaceDrawer
            key="explorer-drawer"
            side="left"
            label="Project explorer"
            onClose={closeDrawer}
          >
            <ExplorerPanel variant="drawer" onRequestClose={closeDrawer} />
          </WorkspaceDrawer>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showCopilotDrawer ? (
          <WorkspaceDrawer
            key="copilot-drawer"
            side="right"
            label="AI Copilot dock"
            onClose={closeDrawer}
          >
            <CopilotDock variant="drawer" onRequestClose={closeDrawer} />
          </WorkspaceDrawer>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
