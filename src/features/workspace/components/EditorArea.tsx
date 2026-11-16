import { motion } from 'framer-motion'
import {
  AlignLeft,
  Archive,
  ArrowUpRight,
  BookOpen,
  Bug,
  ChevronRight,
  CircleSlash,
  Copy,
  Download,
  FilePlus2,
  FolderGit2,
  FolderTree,
  Minus,
  Play,
  Plus,
  Save,
  ScrollText,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import {
  Component,
  Suspense,
  lazy,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'

import { clampFontSize } from '../../editor/editorPreferences'
import { useEditorCommands } from '../../editor/EditorCommandsContext'
import { useCopilot } from '../../copilot/CopilotContext'
import { languageForPath } from '../../editor/languageRegistry'
import { isPrettierSupported, unsupportedLanguageLabel } from '../../editor/formatting/prettier'
import { projectLanguageForMonaco } from '../../editor/projectLanguages'
import { saveBinaryFile, saveTextFile } from '../../../lib/diskAccess'
import { archiveFileName, createProjectArchive } from '../../../lib/projectArchive'
import { collectProjectFiles } from '../../../lib/projectStorage'
import { findNode } from '../state/fileTree'
import { useWorkspace } from '../state/useWorkspace'
import type { FileTreeNode, WorkspaceJobKind, WorkspaceTab } from '../state/types'
import { EditorMoreMenu, type EditorMenuItem } from './EditorMoreMenu'
import { FileGlyph } from './FileGlyph'
import styles from './EditorArea.module.css'

const MonacoWorkbench = lazy(() => import('./MonacoWorkbench'))

type EditorAreaProps = {
  onShowExplorer: () => void
  onShowCopilot: () => void
  copilotInline: boolean
}

export function EditorArea({
  onShowExplorer,
  onShowCopilot,
  copilotInline,
}: EditorAreaProps) {
  const { project, state, dispatch, stats } = useWorkspace()
  const { tabs, activeTabPath } = state.tree

  const activeTab = activeTabPath
    ? (tabs.find((tab) => tab.path === activeTabPath) ?? null)
    : null
  const activeNode = activeTabPath ? findNode(state.tree.nodes, activeTabPath) : null
  const activeFile = activeNode?.kind === 'file' ? activeNode : null

  const dirtyCount = tabs.filter((tab) => tab.dirty).length

  /**
   * Closing a dirty tab must surface the confirm dialog instead of silently
   * dropping the draft. Clean tabs close straight away.
   */
  const requestClose = (path: string) => {
    const tab = tabs.find((candidate) => candidate.path === path)
    if (tab?.dirty) {
      dispatch({
        type: 'ui/open-dialog',
        dialog: { kind: 'close-tabs', paths: [path], label: tab.name },
      })
      return
    }

    dispatch({ type: 'tab/close', path })
  }

  const closeOthers = (path: string) => {
    const dirty = tabs.filter(
      (candidate) => candidate.path !== path && candidate.dirty,
    )
    if (dirty.length > 0) {
      dispatch({
        type: 'ui/open-dialog',
        dialog: {
          kind: 'close-tabs',
          paths: dirty.map((tab) => tab.path),
          label: `${tabs.length - 1} other ${tabs.length - 1 === 1 ? 'tab' : 'tabs'}`,
        },
      })
      return
    }

    dispatch({ type: 'tab/close-others', path })
  }

  const closeAll = () => {
    if (dirtyCount > 0) {
      dispatch({
        type: 'ui/open-dialog',
        dialog: {
          kind: 'close-tabs',
          paths: tabs.filter((tab) => tab.dirty).map((tab) => tab.path),
          label: 'all open tabs',
        },
      })
      return
    }

    dispatch({ type: 'tab/close-all' })
  }

  const showCopilot = () => {
    if (!copilotInline) {
      dispatch({ type: 'ui/open-mobile-panel', panel: 'copilot' })
    }
    onShowCopilot()
  }

  const startSearch = () => {
    dispatch({ type: 'ui/open-palette', palette: 'search' })
  }

  const openQuickFiles = () => {
    dispatch({ type: 'ui/open-palette', palette: 'files' })
  }

  return (
    <section className={styles.editor} aria-label="Main workspace">
      <div className={styles.tabBar}>
        <div className={styles.tabScroll} role="tablist" aria-label="Open files">
          {tabs.length === 0 ? (
            <span className={styles.noTabs}>
              <span className={styles.noTabsDot} aria-hidden="true" />
              No open files
            </span>
          ) : (
            tabs.map((tab, index) => {
              const active = tab.path === activeTabPath
              return (
                <div key={tab.path} className={styles.tabWrap} data-active={active}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    data-tab-index={index}
                    className={styles.tab}
                    onClick={() => dispatch({ type: 'tab/activate', path: tab.path })}
                    onAuxClick={(event) => {
                      if (event.button === 1) {
                        event.preventDefault()
                        requestClose(tab.path)
                      }
                    }}
                    onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                        return
                      }
                      event.preventDefault()
                      const direction = event.key === 'ArrowRight' ? 1 : -1
                      const nextIndex = (index + direction + tabs.length) % tabs.length
                      const next = tabs[nextIndex]
                      if (!next) {
                        return
                      }
                      dispatch({ type: 'tab/activate', path: next.path })
                      window.requestAnimationFrame(() => {
                        document
                          .querySelector<HTMLButtonElement>(
                            `[data-tab-index="${nextIndex}"]`,
                          )
                          ?.focus()
                      })
                    }}
                    title={
                      `${tab.path}${tab.dirty ? ' · unsaved changes' : ''}${
                        tab.status === 'error' ? ' · load failed' : ''
                      }`
                    }
                  >
                    <FileGlyph name={tab.name} kind="file" size={13} />
                    <span className={styles.tabName}>{tab.name}</span>
                    {tab.dirty ? (
                      <span className={styles.tabDirtyDot} aria-label="Unsaved changes" />
                    ) : tab.status === 'error' ? (
                      <span className={styles.tabErrorDot} aria-label="Load failed" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={styles.tabClose}
                    onClick={() => requestClose(tab.path)}
                    aria-label={`Close ${tab.name}`}
                    title={`Close ${tab.name}`}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className={styles.tabActions}>
          <button
            type="button"
            className={styles.tabAction}
            disabled={!activeTabPath || tabs.length < 2}
            onClick={() => activeTabPath && closeOthers(activeTabPath)}
            title="Close every other tab"
          >
            Close others
          </button>
          <button
            type="button"
            className={styles.tabAction}
            disabled={tabs.length === 0}
            onClick={closeAll}
            title="Close every open tab"
          >
            Close all
          </button>
        </div>
      </div>

      {activeFile && activeTab ? (
        <>
          <Breadcrumbs path={activeFile.path} onShowExplorer={onShowExplorer} />
          <EditorSurface tab={activeTab} node={activeFile} onShowCopilot={showCopilot} />
        </>
      ) : (
        <motion.div
          className={styles.welcome}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.welcomeHead}>
            <p className={styles.welcomeKicker}>
              <span className={styles.liveDot} aria-hidden="true" />
              Workspace session · {project.name}
            </p>
            <h2 className={styles.welcomeTitle}>
              {state.tree.nodes.length > 0
                ? 'A real editor, on a real tree.'
                : 'This record is still empty — and honestly so.'}
            </h2>
            <p className={styles.welcomeCopy}>
              {stats.files > 0
                ? `${stats.files} files across ${stats.folders} folders are stored with this project record in this browser. Open one to load its real contents into Monaco, edit with full syntax highlighting, and save back to IndexedDB with Ctrl/Cmd+S.`
                : 'No entries are stored with this project record yet. Create a file to start a stored tree — the entry and every save is persisted to IndexedDB, not just this session.'}
            </p>
          </div>

          <div className={styles.welcomeGrid}>
            <section className={styles.startPanel} aria-labelledby="start-title">
              <div className={styles.welcomePanelHead}>
                <span id="start-title" className={styles.welcomePanelTitle}>
                  Start here
                </span>
                <span className={styles.welcomePanelMeta}>01</span>
              </div>

              <button
                type="button"
                className={styles.startAction}
                onClick={() =>
                  dispatch({
                    type: 'ui/open-dialog',
                    dialog: { kind: 'create-file', parentPath: '' },
                  })
                }
              >
                <span className={styles.startIcon} aria-hidden="true">
                  <FilePlus2 size={15} />
                </span>
                <span className={styles.startBody}>
                  <span className={styles.startName}>Create a file</span>
                  <span className={styles.startHint}>
                    Stores a real entry with this project record
                  </span>
                </span>
                <ChevronRight size={13} className={styles.startArrow} aria-hidden="true" />
              </button>

              <button type="button" className={styles.startAction} onClick={openQuickFiles}>
                <span className={styles.startIcon} aria-hidden="true">
                  <Search size={15} />
                </span>
                <span className={styles.startBody}>
                  <span className={styles.startName}>Quick open</span>
                  <span className={styles.startHint}>Jump to any stored file · Ctrl/Cmd+P</span>
                </span>
                <ChevronRight size={13} className={styles.startArrow} aria-hidden="true" />
              </button>

              <button type="button" className={styles.startAction} onClick={startSearch}>
                <span className={styles.startIcon} aria-hidden="true">
                  <ScrollText size={15} />
                </span>
                <span className={styles.startBody}>
                  <span className={styles.startName}>Search stored contents</span>
                  <span className={styles.startHint}>
                    Scan real saved text · Ctrl/Cmd+Shift+F
                  </span>
                </span>
                <ChevronRight size={13} className={styles.startArrow} aria-hidden="true" />
              </button>

              <button type="button" className={styles.startAction} onClick={showCopilot}>
                <span className={styles.startIcon} aria-hidden="true">
                  <Sparkles size={15} />
                </span>
                <span className={styles.startBody}>
                  <span className={styles.startName}>Open the Copilot dock</span>
                  <span className={styles.startHint}>
                    Provider-independent · configure inside the dock
                  </span>
                </span>
                <ChevronRight size={13} className={styles.startArrow} aria-hidden="true" />
              </button>

              <Link to={`/workspace/${project.id}/overview`} className={styles.startAction}>
                <span className={styles.startIcon} aria-hidden="true">
                  <FolderGit2 size={15} />
                </span>
                <span className={styles.startBody}>
                  <span className={styles.startName}>Project dossier</span>
                  <span className={styles.startHint}>Registry facts and storage detail</span>
                </span>
                <ArrowUpRight size={13} className={styles.startArrow} aria-hidden="true" />
              </Link>
            </section>

            <section className={styles.mapPanel} aria-labelledby="map-title">
              <div className={styles.welcomePanelHead}>
                <span id="map-title" className={styles.welcomePanelTitle}>
                  Project map
                </span>
                <span className={styles.welcomePanelMeta}>root · {stats.folders} folders</span>
              </div>

              {state.tree.nodes.length === 0 ? (
                <div className={styles.mapEmpty}>
                  <FolderTree size={18} aria-hidden="true" />
                  <p>No stored entries. The explorer will grow as you create files.</p>
                </div>
              ) : (
                <ul className={styles.mapList}>
                  {state.tree.nodes.slice(0, 8).map((node) => (
                    <li key={node.path}>
                      <button
                        type="button"
                        className={styles.mapRow}
                        onClick={() => {
                          if (node.kind === 'folder') {
                            dispatch({ type: 'tree/reveal-folder', path: node.path })
                            onShowExplorer()
                          } else {
                            dispatch({ type: 'file/open', path: node.path })
                          }
                        }}
                      >
                        <FileGlyph name={node.name} kind={node.kind} size={13} />
                        <span className={styles.mapName}>{node.name}</span>
                        {node.kind === 'folder' ? (
                          <span className={styles.dirtyBadge}>
                            {node.fileCount} {node.fileCount === 1 ? 'file' : 'files'}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {state.tree.nodes.length > 8 ? (
                <p className={styles.mapMore}>
                  +{state.tree.nodes.length - 8} more root entries in the explorer
                </p>
              ) : null}

              <button type="button" className={styles.mapOpen} onClick={onShowExplorer}>
                <FolderTree size={13} aria-hidden="true" /> Open project explorer
              </button>
            </section>
          </div>

          <div className={styles.welcomeMeta}>
            <span>{project.source === 'created' ? 'Created locally' : 'Imported folder'}</span>
            <span className={styles.metaSep} aria-hidden="true" />
            <span>{project.language}</span>
            <span className={styles.metaSep} aria-hidden="true" />
            <span>
              {stats.files} {stats.files === 1 ? 'file' : 'files'} · {stats.folders} folders
            </span>
            <span className={styles.metaSep} aria-hidden="true" />
            <span className={styles.sessionChip}>
              <span className={styles.sessionDot} aria-hidden="true" />
              Stored in IndexedDB · saves are local
            </span>
          </div>
        </motion.div>
      )}
    </section>
  )
}

function Breadcrumbs({ path, onShowExplorer }: { path: string; onShowExplorer: () => void }) {
  const { project, state, dispatch } = useWorkspace()
  const segments = path.split('/')

  return (
    <nav className={styles.breadcrumbs} aria-label="File breadcrumb">
      <span className={styles.crumbRoot} title={project.name}>
        <FolderGit2 size={12} aria-hidden="true" />
        {project.name}
      </span>

      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        const segmentPath = segments.slice(0, index + 1).join('/')
        const node = findNode(state.tree.nodes, segmentPath)

        return (
          <span key={segmentPath} className={styles.crumbPart}>
            <ChevronRight size={10} className={styles.crumbSep} aria-hidden="true" />
            {isLast || !node || node.kind === 'file' ? (
              <span aria-current={isLast ? 'page' : undefined} className={styles.crumbCurrent}>
                {isLast ? <FileGlyph name={node?.name ?? segment} kind="file" size={12} /> : null}
                {segment}
              </span>
            ) : (
              <button
                type="button"
                className={styles.crumbButton}
                onClick={() => {
                  dispatch({ type: 'tree/reveal-folder', path: segmentPath })
                  onShowExplorer()
                }}
              >
                {segment}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

type CopyState = 'idle' | 'copied' | 'failed'

function EditorSurface({
  tab,
  node,
  onShowCopilot,
}: {
  tab: WorkspaceTab
  node: FileTreeNode
  onShowCopilot: () => void
}) {
  const { project, state, dispatch } = useWorkspace()
  const commands = useEditorCommands()
  const { seedComposer } = useCopilot()
  const { editor: preferences } = state.ui

  const language = languageForPath(tab.path)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [boundaryFailed, setBoundaryFailed] = useState(false)

  const dirtyCount = state.tree.tabs.filter((candidate) => candidate.dirty).length
  const fontCanDecrease = preferences.fontSize > 11
  const fontCanIncrease = preferences.fontSize < 22
  const attached = state.ui.copilotContext.includes(tab.path)
  const runtime = projectLanguageForMonaco(language.id)?.runtime ?? null
  const canRun = tab.status === 'ready' && runtime !== null
  const canTrace = tab.status === 'ready' && runtime === 'python'
  const canFormat = isPrettierSupported(tab.path)

  const setPreference = (patch: {
    fontSize?: number
    minimap?: boolean
    wordWrap?: boolean
    formatOnSave?: boolean
  }) => {
    dispatch({ type: 'ui/set-editor-preference', patch })
  }

  const saveActive = () => {
    void commands.current?.save(tab.path)
  }

  const saveAll = () => {
    void commands.current?.saveAll()
  }

  const focusFind = () => {
    commands.current?.focusFind()
  }

  /**
   * Run/Trace open the Run panel and hand it an explicit request. The panel
   * performs the real call; the toolbar never produces or fakes output.
   */
  const requestJob = (kind: WorkspaceJobKind) => {
    dispatch({ type: 'ui/set-bottom-open', open: true })
    dispatch({ type: 'ui/set-bottom-tab', tab: 'run' })
    dispatch({ type: 'ui/set-pending-job', job: { kind, path: tab.path } })
  }

  const formatActive = () => {
    void (async () => {
      const outcome = await commands.current?.format(tab.path)
      if (!outcome) {
        dispatch({
          type: 'ui/show-toast',
          tone: 'warn',
          message: 'The editor is not ready yet. Try Format again in a moment.',
        })
        return
      }
      dispatch({ type: 'ui/show-toast', tone: outcome.ok ? 'ok' : 'warn', message: outcome.message })
    })()
  }

  const toggleAttached = () => {
    dispatch({ type: 'ui/toggle-copilot-context', path: tab.path })
    if (!attached) {
      onShowCopilot()
    }
  }

  const explainActive = () => {
    seedComposer(
      state.ui.selection
        ? 'Explain the selected code line by line.'
        : `Explain ${tab.name} line by line.`,
      'explain',
    )
    onShowCopilot()
  }

  const cycleTheme = () => {
    dispatch({ type: 'ui/set-theme', theme: preferences.theme === 'midnight' ? 'graphite' : 'midnight' })
  }

  const copyPath = async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard unavailable')
      }
      await navigator.clipboard.writeText(tab.path)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  /**
   * Saves a copy of the live Monaco draft through the real save picker. This
   * never changes the project record or the device path of the linked folder.
   */
  const saveCopy = () => {
    void (async () => {
      const content = commands.current?.getDraft(tab.path) ?? tab.content
      const result = await saveTextFile(tab.name, content)
      if (result.status === 'cancelled') {
        return
      }
      if (result.status === 'failed') {
        dispatch({ type: 'ui/show-toast', tone: 'danger', message: result.reason })
        return
      }
      dispatch({
        type: 'ui/show-toast',
        tone: 'ok',
        message:
          result.status === 'saved'
            ? `Saved a copy as ${result.fileName}. The project record is unchanged.`
            : `Downloaded ${result.fileName}. Your browser controls where it lands.`,
      })
    })()
  }

  /**
   * Exports saved project contents as a ZIP. Unsaved editor drafts are never
   * included silently: the toast names how many were left out.
   */
  const exportArchive = () => {
    void (async () => {
      dispatch({ type: 'ui/show-toast', tone: 'ok', message: 'Collecting saved files…' })
      try {
        const bundle = await collectProjectFiles(project)
        if (bundle.files.length === 0) {
          dispatch({
            type: 'ui/show-toast',
            tone: 'warn',
            message:
              bundle.unavailable[0]?.reason ??
              'This project has no saved text files to export yet. Save a file first.',
          })
          return
        }

        const archive = await createProjectArchive({
          name: project.name,
          description: project.description,
          language: project.language,
          source: project.source,
          files: bundle.files,
        })
        const saved = await saveBinaryFile({
          suggestedName: archiveFileName(project.name),
          bytes: archive.bytes,
          mimeType: 'application/zip',
          description: 'CodePilot Lab project archive',
          extensions: ['.zip'],
        })

        if (saved.status === 'cancelled') {
          dispatch({
            type: 'ui/show-toast',
            tone: 'warn',
            message: 'Archive export was cancelled. Nothing was written.',
          })
          return
        }
        if (saved.status === 'failed') {
          dispatch({ type: 'ui/show-toast', tone: 'danger', message: saved.reason })
          return
        }

        const notes: string[] = []
        if (bundle.unavailable.length > 0) {
          notes.push(`${bundle.unavailable.length} file${bundle.unavailable.length === 1 ? '' : 's'} unavailable`)
        }
        if (archive.skipped.length > 0) {
          notes.push(`${archive.skipped.length} invalid path${archive.skipped.length === 1 ? '' : 's'} skipped`)
        }
        if (dirtyCount > 0) {
          notes.push(`${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'} not included`)
        }

        dispatch({
          type: 'ui/show-toast',
          tone: bundle.unavailable.length > 0 || dirtyCount > 0 ? 'warn' : 'ok',
          message: `${saved.status === 'saved' ? 'Exported' : 'Downloaded'} ${saved.fileName} · ${bundle.files.length} file${bundle.files.length === 1 ? '' : 's'}${notes.length > 0 ? ` · ${notes.join(' · ')}` : ''}`,
        })
      } catch (cause) {
        dispatch({
          type: 'ui/show-toast',
          tone: 'danger',
          message:
            cause instanceof Error && cause.message
              ? cause.message
              : 'The archive could not be created. Nothing was written.',
        })
      }
    })()
  }

  const moreItems: EditorMenuItem[] = [
    {
      id: 'wrap',
      label: 'Word wrap',
      icon: <ScrollText size={13} aria-hidden="true" />,
      checked: preferences.wordWrap,
      onSelect: () => setPreference({ wordWrap: !preferences.wordWrap }),
    },
    {
      id: 'minimap',
      label: 'Minimap',
      checked: preferences.minimap,
      onSelect: () => setPreference({ minimap: !preferences.minimap }),
    },
    {
      id: 'format-on-save',
      label: 'Format on save · Prettier',
      checked: preferences.formatOnSave,
      onSelect: () => setPreference({ formatOnSave: !preferences.formatOnSave }),
    },
    {
      id: 'theme',
      label: `Theme · ${preferences.theme === 'midnight' ? 'Midnight' : 'Graphite'}`,
      onSelect: cycleTheme,
    },
    {
      id: 'font-decrease',
      label: 'Decrease font size',
      icon: <Minus size={13} aria-hidden="true" />,
      shortcut: `${preferences.fontSize}px`,
      disabled: !fontCanDecrease,
      onSelect: () => setPreference({ fontSize: clampFontSize(preferences.fontSize - 1) }),
    },
    {
      id: 'font-increase',
      label: 'Increase font size',
      icon: <Plus size={13} aria-hidden="true" />,
      disabled: !fontCanIncrease,
      onSelect: () => setPreference({ fontSize: clampFontSize(preferences.fontSize + 1) }),
    },
    {
      id: 'copy-path',
      label:
        copyState === 'copied'
          ? 'Path copied'
          : copyState === 'failed'
            ? 'Clipboard unavailable'
            : 'Copy path',
      icon: <Copy size={13} aria-hidden="true" />,
      onSelect: () => void copyPath(),
    },
    {
      id: 'save-copy',
      label: 'Save a copy…',
      icon: <Download size={13} aria-hidden="true" />,
      disabled: tab.status !== 'ready',
      onSelect: saveCopy,
    },
    {
      id: 'export-archive',
      label: 'Export project archive…',
      icon: <Archive size={13} aria-hidden="true" />,
      onSelect: exportArchive,
    },
    {
      id: 'copilot-attach',
      label: 'Copilot context',
      icon: <Sparkles size={13} aria-hidden="true" />,
      checked: attached,
      onSelect: toggleAttached,
    },
    {
      id: 'copilot-explain',
      label: 'Explain with Copilot',
      icon: <BookOpen size={13} aria-hidden="true" />,
      onSelect: explainActive,
    },
  ]


  return (
    <motion.div
      className={styles.surface}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.editorToolbar}>
        <div className={styles.toolbarIdentity}>
          <FileGlyph name={node.name} kind="file" size={15} />
          <span className={styles.surfaceName}>{node.name}</span>
          <span className={styles.surfacePath}>{tab.path}</span>
        </div>

        <div className={styles.toolbarMeta}>
          <span
            className={styles.langChip}
            title={
              language.validation === 'syntax-only'
                ? `${language.label} — highlighting and syntax edits in Monaco; no language service, so diagnostics and symbols are not available`
                : `${language.label} — Monaco language service active`
            }
          >
            {language.label}
          </span>
          <span
            className={styles.dirtyChip}
            data-dirty={tab.dirty}
            title={tab.dirty ? 'Unsaved changes in the editor buffer' : 'Matches the stored copy'}
          >
            {tab.dirty ? 'Unsaved' : 'Saved'}
          </span>
        </div>

        <div className={styles.actionBar} role="toolbar" aria-label="Editor actions">
          <button
            type="button"
            className={styles.surfaceButton}
            data-variant="primary"
            disabled={!canRun}
            onClick={() => requestJob('run')}
            title={
              canRun
                ? `Run ${node.name} through the local execution service (opens the Run panel)`
                : tab.status !== 'ready'
                  ? 'The file must finish loading before it can run'
                  : `${language.label} has no runtime in this build`
            }
          >
            <Play size={13} aria-hidden="true" />
            <span className={styles.buttonLabel}>Run</span>
          </button>

          <button
            type="button"
            className={styles.surfaceButton}
            disabled={!canTrace}
            onClick={() => requestJob('trace')}
            title={
              canTrace
                ? `Trace ${node.name} line by line in local Python (opens the Run panel)`
                : tab.status !== 'ready'
                  ? 'The file must finish loading before it can be traced'
                  : runtime
                    ? `${language.label} has no tracer in this build — only Python is traced`
                    : `${language.label} has no runtime in this build`
            }
          >
            <Bug size={13} aria-hidden="true" />
            <span className={styles.buttonLabel}>Trace</span>
          </button>

          <span className={styles.toolbarSep} aria-hidden="true" />

          <button
            type="button"
            className={styles.surfaceButton}
            disabled={tab.status !== 'ready'}
            onClick={saveActive}
            title="Save current file · Ctrl/Cmd+S"
          >
            <Save size={13} aria-hidden="true" />
            <span className={styles.buttonLabel}>Save</span>
          </button>
          <button
            type="button"
            className={styles.surfaceButton}
            disabled={dirtyCount === 0}
            onClick={saveAll}
            title="Save all files · Ctrl/Cmd+Shift+S"
          >
            <Save size={13} aria-hidden="true" />
            <span className={styles.buttonLabel}>
              Save all{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
            </span>
          </button>
          <button
            type="button"
            className={styles.surfaceButton}
            disabled={tab.status !== 'ready'}
            onClick={formatActive}
            title={`Format the live buffer with Prettier · Shift+Alt+F${
              canFormat ? '' : ` — ${unsupportedLanguageLabel(tab.path) ?? language.label} is not supported by Prettier`
            }`}
          >
            <AlignLeft size={13} aria-hidden="true" />
            <span className={styles.buttonLabel}>Format</span>
          </button>
          <button
            type="button"
            className={styles.surfaceButton}
            disabled={tab.status !== 'ready'}
            onClick={focusFind}
            title="Find and replace in file · Ctrl/Cmd+F"
          >
            <Search size={13} aria-hidden="true" />
            <span className={styles.buttonLabel}>Find</span>
          </button>

          <span className={styles.toolbarSep} aria-hidden="true" />

          <EditorMoreMenu
            items={moreItems}
            triggerClassName={styles.surfaceButton}
            labelClassName={styles.buttonLabel}
          />
        </div>
      </div>

      <div className={styles.editorCanvas}>
        {boundaryFailed ? (
          <div className={styles.canvasFailure} role="alert">
            <p className={styles.overlayTitle}>Editor crashed</p>
            <p className={styles.overlayCopy}>
              Monaco hit an unrecoverable error rendering this file. Your stored copy and the
              open tabs are untouched — saving is still possible once the editor remounts.
            </p>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => setBoundaryFailed(false)}
            >
              Try mounting again
            </button>
          </div>
        ) : (
          <>
            <EditorErrorBoundary onCrash={() => setBoundaryFailed(true)}>
              <Suspense fallback={<div className={styles.editorLoading}>Loading Monaco…</div>}>
                <MonacoWorkbench />
              </Suspense>
            </EditorErrorBoundary>
            <CanvasOverlay tab={tab} />
          </>
        )}
      </div>
    </motion.div>
  )
}

/** Honest status plate shown over the editor canvas while content is not on screen. */
function CanvasOverlay({ tab }: { tab: WorkspaceTab }) {
  if (tab.status === 'ready') {
    return null
  }

  if (tab.status === 'loading' || tab.status === 'idle') {
    return (
      <div className={styles.canvasOverlay} role="status">
        <span className={styles.overlaySpinner} aria-hidden="true" />
        <p className={styles.overlayTitle}>Loading {tab.name}</p>
        <p className={styles.overlayCopy}>
          Reading the real stored text for this file out of the project record.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.canvasOverlay} role="alert">
      <span className={styles.overlayIcon} aria-hidden="true">
        <CircleSlash size={18} />
      </span>
      <p className={styles.overlayTitle}>
        {tab.status === 'unavailable' ? 'No readable content for this file' : 'Failed to read this file'}
      </p>
      <p className={styles.overlayCopy}>
        {tab.error ??
          'The editor never shows placeholder text, so there is nothing to render here.'}
      </p>
      <span className={styles.overlayPath}>{tab.path}</span>
    </div>
  )
}

class EditorErrorBoundary extends Component<{ children: ReactNode; onCrash: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // The canvas falls back to an explicit failure plate with a remount action.
    this.props.onCrash()
  }

  render() {
    if (this.state.failed) {
      return null
    }

    return this.props.children
  }
}
