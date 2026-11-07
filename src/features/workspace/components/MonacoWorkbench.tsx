import { useCallback, useEffect, useRef, useState } from 'react'

import type { EditorMarker, TabContentSource } from '../state/types'
import { useEditorCommands } from '../../editor/EditorCommandsContext'
import { clampFontSize } from '../../editor/editorPreferences'
import { languageForPath, monacoLanguageId } from '../../editor/languageRegistry'
import { MONACO_THEMES, ensureMonacoSetup, monaco } from '../../editor/monacoSetup'
import { writeStoredContent } from '../../../lib/projectStorage'
import { useWorkspace } from '../state/useWorkspace'
import styles from './MonacoWorkbench.module.css'

type ModelRecord = {
  model: monaco.editor.ITextModel
  listener: monaco.IDisposable
}

type CursorState = {
  line: number
  column: number
  selected: number
  selectionLines: number
}

const STATIC_OPTIONS = {
  automaticLayout: true,
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontLigatures: true,
  renderWhitespace: 'selection' as const,
  smoothScrolling: true,
  cursorBlinking: 'smooth' as const,
  cursorSmoothCaretAnimation: 'on' as const,
  renderLineHighlight: 'all' as const,
  scrollBeyondLastLine: false,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  roundedSelection: false,
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  showFoldingControls: 'mouseover' as const,
  foldingHighlight: true,
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: 'active' as const, indentation: false },
  fixedOverflowWidgets: true,
  contextmenu: true,
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
  },
} satisfies monaco.editor.IEditorOptions

function modelUri(projectId: string, path: string): monaco.Uri {
  return monaco.Uri.parse(`inmemory://workspace/${projectId}/`).with({ path: `/${path}` })
}

export default function MonacoWorkbench() {
  const { project, state, dispatch } = useWorkspace()
  const apiRef = useEditorCommands()

  const { tabs, activeTabPath } = state.tree
  const { editor: preferences, pendingReveal } = state.ui

  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelsRef = useRef<Map<string, ModelRecord>>(new Map())
  const savedVersionsRef = useRef<Map<string, number>>(new Map())
  const dirtyRef = useRef<Map<string, boolean>>(new Map())
  const viewStatesRef = useRef<
    Map<string, monaco.editor.ICodeEditorViewState | null>
  >(new Map())
  const previousActiveRef = useRef<string | null>(null)
  const tabsRef = useRef(tabs)
  const activeRef = useRef(activeTabPath)
  const projectRef = useRef(project)
  const saveAllRef = useRef<(() => Promise<{ saved: number; failed: number }>) | null>(null)
  const cycleTabRef = useRef<((direction: 1 | -1) => void) | null>(null)
  const collectRef = useRef<(() => void) | null>(null)

  const [cursor, setCursor] = useState<CursorState>({
    line: 1,
    column: 1,
    selected: 0,
    selectionLines: 0,
  })
  const [failed, setFailed] = useState(false)

  const attach = useCallback((path: string) => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    const record = modelsRef.current.get(path)
    if (editor.getModel() === (record?.model ?? null)) {
      return
    }

    const previous = previousActiveRef.current
    if (previous && previous !== path) {
      const previousRecord = modelsRef.current.get(previous)
      if (previousRecord && editor.getModel() === previousRecord.model) {
        viewStatesRef.current.set(previous, editor.saveViewState())
      }
    }

    editor.setModel(record?.model ?? null)
    const restored = record ? viewStatesRef.current.get(path) : undefined
    if (restored) {
      editor.restoreViewState(restored)
    }
    editor.focus()
    previousActiveRef.current = path
  }, [])

  const ensureModels = useCallback(
    (openPaths: Set<string>) => {
      for (const [path, record] of modelsRef.current) {
        if (!openPaths.has(path)) {
          record.listener.dispose()
          record.model.dispose()
          modelsRef.current.delete(path)
          viewStatesRef.current.delete(path)
          dirtyRef.current.delete(path)
          savedVersionsRef.current.delete(path)
        }
      }

      for (const tab of tabsRef.current) {
        if (tab.status !== 'ready' || modelsRef.current.has(tab.path)) {
          continue
        }

        const language = monacoLanguageId(tab.path)
        const model = monaco.editor.createModel(
          tab.content,
          language,
          modelUri(projectRef.current.id, tab.path),
        )

        const listener = model.onDidChangeContent(() => {
          const saved = savedVersionsRef.current.get(tab.path) ?? Number.NaN
          const dirty = model.getAlternativeVersionId() !== saved
          const wasDirty = dirtyRef.current.get(tab.path) ?? false
          if (dirty !== wasDirty) {
            dirtyRef.current.set(tab.path, dirty)
            dispatch({ type: 'tab/set-dirty', path: tab.path, dirty })
          }
        })

        savedVersionsRef.current.set(
          tab.path,
          tab.dirty ? -1 : model.getAlternativeVersionId(),
        )
        dirtyRef.current.set(tab.path, tab.dirty)
        modelsRef.current.set(tab.path, { model, listener })
      }
    },
    [dispatch],
  )

  const persistPath = useCallback(
    async (
      path: string | null,
      notify: 'silent' | 'single' = 'single',
    ): Promise<boolean> => {
      if (!path) {
        return false
      }

      const record = modelsRef.current.get(path)
      if (!record) {
        dispatch({
          type: 'ui/show-toast',
          tone: 'warn',
          message: 'No editor content is loaded for this file yet.',
        })
        return false
      }

      const content = record.model.getValue()
      try {
        await writeStoredContent(projectRef.current.id, path, content)
        savedVersionsRef.current.set(path, record.model.getAlternativeVersionId())
        dirtyRef.current.set(path, false)
        dispatch({ type: 'tab/mark-saved', path, content })
        if (notify === 'single') {
          const name = path.slice(path.lastIndexOf('/') + 1)
          dispatch({ type: 'ui/show-toast', tone: 'ok', message: `Saved ${name}` })
        }
        return true
      } catch (cause) {
        const message =
          cause instanceof Error && cause.message
            ? cause.message
            : 'IndexedDB rejected the write.'
        dispatch({
          type: 'ui/show-toast',
          tone: 'danger',
          message: `Save failed for ${path}: ${message}`,
        })
        return false
      }
    },
    [dispatch],
  )

  const saveAll = useCallback(async () => {
    const dirtyPaths = [...dirtyRef.current.entries()]
      .filter(([, dirty]) => dirty)
      .map(([path]) => path)

    let saved = 0
    let failedCount = 0
    for (const path of dirtyPaths) {
      const ok = await persistPath(path, 'silent')
      if (ok) {
        saved += 1
      } else {
        failedCount += 1
      }
    }

    if (saved > 0 || failedCount > 0) {
      dispatch({
        type: 'ui/show-toast',
        tone: failedCount > 0 ? 'warn' : 'ok',
        message:
          failedCount > 0
            ? `Saved ${saved} file${saved === 1 ? '' : 's'} · ${failedCount} failed`
            : `Saved ${saved} file${saved === 1 ? '' : 's'}`,
      })
    } else {
      dispatch({ type: 'ui/show-toast', tone: 'ok', message: 'No unsaved changes' })
    }

    return { saved, failed: failedCount }
  }, [dispatch, persistPath])

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      const open = tabsRef.current.filter((tab) => tab.status === 'ready')
      if (open.length === 0) {
        return
      }

      const currentIndex = open.findIndex((tab) => tab.path === activeRef.current)
      const nextIndex =
        ((currentIndex === -1 ? 0 : currentIndex) + direction + open.length) % open.length
      const next = open[nextIndex]
      if (next) {
        dispatch({ type: 'tab/activate', path: next.path })
      }
    },
    [dispatch],
  )

  useEffect(() => {
    saveAllRef.current = saveAll
    cycleTabRef.current = cycleTab
  }, [saveAll, cycleTab])

  useEffect(() => {
    tabsRef.current = tabs
    activeRef.current = activeTabPath
    projectRef.current = project
  }, [tabs, activeTabPath, project])

  try {
    // Initialisation stays in a plain guarded block below; this block never renders.
    void ensureMonacoSetup
  } catch {
    // unreachable
  }

  useEffect(() => {
    let disposed = false

    try {
      ensureMonacoSetup()
      const container = containerRef.current
      if (!container) {
        return
      }

      const editor = monaco.editor.create(
        container,
        {
          ...STATIC_OPTIONS,
          fontSize: preferences.fontSize,
          lineHeight: Math.round(clampFontSize(preferences.fontSize) * 1.6),
          minimap: {
            enabled: preferences.minimap,
            renderCharacters: false,
            maxColumn: 90,
            showSlider: 'mouseover',
          },
          wordWrap: preferences.wordWrap ? 'on' : 'off',
          theme: MONACO_THEMES[preferences.theme],
        },
      )
      editorRef.current = editor

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void persistPath(activeRef.current)
      })
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
        () => {
          void saveAllRef.current?.()
        },
      )
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
        dispatch({ type: 'ui/open-palette', palette: 'files' })
      })
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        () => {
          dispatch({ type: 'ui/open-palette', palette: 'search' })
        },
      )
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.PageUp, () => {
        cycleTabRef.current?.(-1)
      })
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.PageDown, () => {
        cycleTabRef.current?.(1)
      })

      const updateCursor = () => {
        const selection = editor.getSelection()
        const position = editor.getPosition()
        if (!position || !selection) {
          return
        }

        const model = editor.getModel()
        setCursor({
          line: position.lineNumber,
          column: position.column,
          selected: selection.isEmpty() ? 0 : (model?.getValueInRange(selection).length ?? 0),
          selectionLines: selection.isEmpty()
            ? 0
            : selection.endLineNumber - selection.startLineNumber + 1,
        })
      }

      editor.onDidChangeCursorPosition(updateCursor)
      editor.onDidChangeCursorSelection(updateCursor)
    } catch {
      // Deferred out of the effect body so the failure state doesn't cascade
      // mid-mount; the boundary plate renders on the next frame.
      window.setTimeout(() => setFailed(true), 0)
    }

    // Snapshot the maps for the cleanup path — the rule wants stable values
    // captured inside the effect body rather than read after React is done.
    const models = modelsRef.current
    const viewStates = viewStatesRef.current
    const dirty = dirtyRef.current
    const savedVersions = savedVersionsRef.current

    return () => {
      disposed = true
      for (const record of models.values()) {
        record.listener.dispose()
        record.model.dispose()
      }
      models.clear()
      viewStates.clear()
      dirty.clear()
      savedVersions.clear()
      editorRef.current?.dispose()
      editorRef.current = null
      previousActiveRef.current = null
      void disposed
    }
    // The editor is created once per workspace mount; subsequent preference
    // changes flow through updateOptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || failed) {
      return
    }

    const fontSize = clampFontSize(preferences.fontSize)
    editor.updateOptions({
      fontSize,
      lineHeight: Math.round(fontSize * 1.6),
      wordWrap: preferences.wordWrap ? 'on' : 'off',
      minimap: {
        enabled: preferences.minimap,
        renderCharacters: false,
        maxColumn: 90,
        showSlider: 'mouseover',
      },
    })
  }, [preferences, failed])

  useEffect(() => {
    if (!failed) {
      monaco.editor.setTheme(MONACO_THEMES[preferences.theme])
    }
  }, [preferences.theme, failed])

  const collectMarkers = useCallback(() => {
    const severityOf = (severity: number): EditorMarker['severity'] => {
      if (severity === monaco.MarkerSeverity.Error) {
        return 'error'
      }
      if (severity === monaco.MarkerSeverity.Warning) {
        return 'warning'
      }
      if (severity === monaco.MarkerSeverity.Info) {
        return 'info'
      }
      return 'hint'
    }

    const markers: EditorMarker[] = []

    for (const [path, record] of modelsRef.current) {
      const found = monaco.editor.getModelMarkers({ resource: record.model.uri }).slice(0, 40)

      for (const marker of found) {
        markers.push({
          path,
          line: marker.startLineNumber,
          column: marker.startColumn,
          endLine: marker.endLineNumber,
          endColumn: marker.endColumn,
          severity: severityOf(marker.severity),
          message: marker.message,
          source: marker.owner || 'editor',
        })
      }
    }

    dispatch({ type: 'editor/set-markers', markers })
  }, [dispatch])

  useEffect(() => {
    collectRef.current = collectMarkers
    const listener = monaco.editor.onDidChangeMarkers(() => collectRef.current?.())
    return () => listener.dispose()
  }, [collectMarkers])

  useEffect(() => {
    if (failed) {
      return
    }

    ensureModels(new Set(tabs.map((tab) => tab.path)))
    if (activeTabPath) {
      attach(activeTabPath)
    } else {
      editorRef.current?.setModel(null)
      previousActiveRef.current = null
    }
    collectRef.current?.()
  }, [tabs, activeTabPath, failed, ensureModels, attach])

  useEffect(() => {
    apiRef.current = {
      getDraft: (path) => modelsRef.current.get(path)?.model.getValue() ?? null,
      save: (path) => persistPath(path),
      saveAll: () => saveAllRef.current?.() ?? Promise.resolve({ saved: 0, failed: 0 }),
      focusFind: () => {
        const editor = editorRef.current
        if (!editor) {
          return
        }
        editor.focus()
        void editor.getAction('actions.find')?.run()
        void editor.getAction('actions.findReplace')?.run()
      },
      reveal: (path, line = 1, column = 1) => {
        // file/open activates the tab when one exists and opens the file when
        // it does not — reveals from Problems/search must work on closed files.
        dispatch({ type: 'file/open', path })
        const tryReveal = (attempt: number) => {
          const record = modelsRef.current.get(path)
          const editor = editorRef.current
          if (record && editor) {
            editor.revealPositionInCenter(
              { lineNumber: line, column },
              monaco.editor.ScrollType.Smooth,
            )
            editor.setPosition({ lineNumber: line, column })
            window.requestAnimationFrame(() => editor.focus())
            return
          }

          if (attempt < 80) {
            window.requestAnimationFrame(() => tryReveal(attempt + 1))
          }
        }

        tryReveal(0)
      },
    }

    return () => {
      apiRef.current = null
    }
  }, [apiRef, dispatch, persistPath])

  useEffect(() => {
    if (!pendingReveal) {
      return
    }

    dispatch({ type: 'ui/set-pending-reveal', reveal: null })
    apiRef.current?.reveal(pendingReveal.path, pendingReveal.line, pendingReveal.column)
  }, [pendingReveal, apiRef, dispatch])

  const language = activeTabPath ? languageForPath(activeTabPath) : null
  const activeSource: TabContentSource | null =
    tabs.find((tab) => tab.path === activeTabPath)?.source ?? null

  if (failed) {
    return (
      <div className={styles.failure} role="alert">
        <p className={styles.failureTitle}>Editor failed to initialise</p>
        <p className={styles.failureCopy}>
          Monaco could not start in this browser session. The workspace tree, tabs and stored
          contents remain intact.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.workbench}>
      <div
        id="workspace-monaco"
        key={project.id}
        ref={containerRef}
        className={styles.canvas}
        aria-label="Code editor"
      />
      <div className={styles.status} aria-live="polite">
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className={styles.sep} aria-hidden="true" />
        <span>
          {cursor.selected > 0
            ? `${cursor.selectionLines || 1} line${cursor.selectionLines === 1 ? '' : 's'} selected`
            : 'no selection'}
        </span>
        <span className={styles.sep} aria-hidden="true" />
        <span>Spaces: 2</span>
        <span className={styles.sep} aria-hidden="true" />
        <span>UTF-8</span>
        <span className={styles.sep} aria-hidden="true" />
        <span>LF</span>
        <span className={`${styles.sep} ${styles.hideWide}`} aria-hidden="true" />
        <span className={styles.hideWide}>{language?.label ?? '—'}</span>
        <span className={`${styles.sep} ${styles.hideWide}`} aria-hidden="true" />
        <span className={styles.hideWide}>
          {activeSource === 'stored'
            ? 'Stored copy'
            : activeSource === 'disk'
              ? 'Folder copy'
              : activeSource === 'new'
                ? 'New file'
                : 'Not loaded'}
        </span>
        <span className={`${styles.sep} ${styles.hideNarrow}`} aria-hidden="true" />
        <span className={styles.hideNarrow}>Monaco</span>
      </div>
    </div>
  )
}
