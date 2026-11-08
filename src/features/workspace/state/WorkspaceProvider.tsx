import { useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'

import type { ProjectRecord } from '../../../lib/db'
import { loadFileContent } from '../../../lib/projectStorage'
import { EditorCommandsProvider } from '../../editor/EditorCommandsContext'
import { writeEditorPreferences } from '../../editor/editorPreferences'
import { CopilotProvider } from '../../copilot/CopilotContext'
import { getWorkspaceStats, type TreeEntry } from './fileTree'
import { writeLayoutPreference } from './layoutPreference'
import { WorkspaceContext } from './WorkspaceContext'
import { createInitialWorkspaceState, workspaceReducer } from './workspaceReducer'

type WorkspaceProviderProps = {
  project: ProjectRecord
  entries: TreeEntry[]
  children: ReactNode
}

export function WorkspaceProvider({ project, entries, children }: WorkspaceProviderProps) {
  const [state, dispatch] = useReducer(workspaceReducer, entries, createInitialWorkspaceState)
  const loadingRef = useRef<Set<string>>(new Set())

  const stats = useMemo(() => getWorkspaceStats(state.tree.nodes), [state.tree.nodes])

  const controller = useMemo(
    () => ({ project, state, dispatch, stats }),
    [project, state, dispatch, stats],
  )

  const { explorerWidth, copilotWidth, bottomHeight, bottomTab, editor } = state.ui

  useEffect(() => {
    writeLayoutPreference({ explorerWidth, copilotWidth, bottomHeight }, bottomTab)
  }, [explorerWidth, copilotWidth, bottomHeight, bottomTab])

  useEffect(() => {
    writeEditorPreferences(editor)
  }, [editor])

  // Load real contents lazily for every opened tab. IndexedDB is authoritative
  // after the first save; a linked folder handle is the fallback source.
  const toast = state.ui.toast

  useEffect(() => {
    if (!toast) {
      return
    }

    const timer = window.setTimeout(() => dispatch({ type: 'ui/clear-toast' }), 3800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    for (const tab of state.tree.tabs) {
      if (tab.status !== 'idle' || loadingRef.current.has(tab.path)) {
        continue
      }

      loadingRef.current.add(tab.path)
      dispatch({ type: 'tab/content-loading', path: tab.path })

      loadFileContent(project, tab.path)
        .then((result) => {
          if (result.status === 'ready') {
            dispatch({
              type: 'tab/content-loaded',
              path: tab.path,
              status: 'ready',
              content: result.content,
              source: result.source,
            })
          } else {
            dispatch({
              type: 'tab/content-loaded',
              path: tab.path,
              status: 'unavailable',
              error: result.reason,
            })
          }
        })
        .catch((cause: unknown) => {
          dispatch({
            type: 'tab/content-loaded',
            path: tab.path,
            status: 'error',
            error:
              cause instanceof Error && cause.message
                ? cause.message
                : 'The local content store could not be read.',
          })
        })
        .finally(() => {
          loadingRef.current.delete(tab.path)
        })
    }
  }, [project, state.tree.tabs])

  return (
    <EditorCommandsProvider>
      <WorkspaceContext.Provider value={controller}>
        <CopilotProvider>{children}</CopilotProvider>
      </WorkspaceContext.Provider>
    </EditorCommandsProvider>
  )
}
