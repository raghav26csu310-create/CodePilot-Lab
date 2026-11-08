import type { EditorPreferences, EditorThemeId } from '../../editor/editorPreferences'

export type TreeNodeKind = 'file' | 'folder'

/**
 * A node in the workspace tree persisted through IndexedDB.
 * `path` is relative to the project root and doubles as the stable identity.
 */
export type FileTreeNode = {
  id: string
  name: string
  path: string
  kind: TreeNodeKind
  children: FileTreeNode[]
  /** Files contained in this node (a file counts as one). */
  fileCount: number
}

export type TabContentStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

export type TabContentSource = 'stored' | 'disk' | 'new' | 'none'

export type WorkspaceTab = {
  path: string
  name: string
  dirty: boolean
  status: TabContentStatus
  source: TabContentSource
  /** Last persisted/loaded snapshot. Live edits stay inside Monaco models. */
  content: string
  error?: string
}

export type BottomPanelTab = 'terminal' | 'output' | 'problems' | 'diagnostics'

export type WorkspaceDialog =
  | { kind: 'create-file'; parentPath: string }
  | { kind: 'create-folder'; parentPath: string }
  | { kind: 'rename'; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'reload-tree' }
  | { kind: 'close-tabs'; paths: string[]; label: string }

export type WorkspaceLayout = {
  explorerWidth: number
  copilotWidth: number
  bottomHeight: number
}

export type WorkspaceTreeState = {
  nodes: FileTreeNode[]
  expanded: string[]
  tabs: WorkspaceTab[]
  activeTabPath: string | null
  selectedPath: string | null
}

export type WorkspaceToastTone = 'ok' | 'warn' | 'danger'

export type WorkspaceToast = {
  id: number
  message: string
  tone: WorkspaceToastTone
}

export type EditorMarkerSeverity = 'error' | 'warning' | 'info' | 'hint'

export type EditorMarker = {
  path: string
  line: number
  column: number
  endLine: number
  endColumn: number
  severity: EditorMarkerSeverity
  message: string
  source: string
}

export type PendingReveal = {
  path: string
  line: number
  column: number
}

/** Live text selection reported by Monaco; used to scope Copilot requests. */
export type EditorSelection = {
  path: string
  text: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export type WorkspaceUiState = WorkspaceLayout & {
  explorerOpen: boolean
  copilotOpen: boolean
  bottomOpen: boolean
  bottomTab: BottomPanelTab
  dialog: WorkspaceDialog | null
  /** Drawer surface on compact viewports. Inline panels use the booleans above. */
  mobilePanel: 'explorer' | 'copilot' | null
  /** Paths the user explicitly attached to the Copilot context control. */
  copilotContext: string[]
  editor: EditorPreferences
  markers: EditorMarker[]
  /** Current editor selection, or null when the cursor is collapsed. */
  selection: EditorSelection | null
  palette: 'files' | 'search' | null
  pendingReveal: PendingReveal | null
  toast: WorkspaceToast | null
}

export type WorkspaceState = {
  tree: WorkspaceTreeState
  ui: WorkspaceUiState
}

export type WorkspaceStats = {
  files: number
  folders: number
}

export type WorkspaceAction =
  | { type: 'tree/replace'; nodes: FileTreeNode[] }
  | { type: 'tree/toggle-folder'; path: string }
  | { type: 'tree/expand'; paths: string[] }
  | { type: 'tree/reveal-folder'; path: string }
  | { type: 'tree/expand-all' }
  | { type: 'tree/collapse-all' }
  | { type: 'file/open'; path: string }
  | { type: 'file/select'; path: string }
  | { type: 'tab/activate'; path: string }
  | { type: 'tab/close'; path: string }
  | { type: 'tab/close-others'; path: string }
  | { type: 'tab/close-all' }
  | { type: 'tab/content-loading'; path: string }
  | {
      type: 'tab/content-loaded'
      path: string
      status: 'ready' | 'unavailable' | 'error'
      content?: string
      source?: TabContentSource
      error?: string
    }
  | { type: 'tab/reset-content'; path: string }
  | { type: 'tab/set-dirty'; path: string; dirty: boolean }
  | { type: 'tab/mark-saved'; path: string; content: string }
  | {
      type: 'entry/create'
      parentPath: string
      name: string
      kind: TreeNodeKind
    }
  | { type: 'entry/rename'; path: string; name: string; draft?: string | null }
  | { type: 'entry/delete'; path: string }
  | { type: 'editor/set-markers'; markers: EditorMarker[] }
  | { type: 'editor/set-selection'; selection: EditorSelection | null }
  | { type: 'ui/open-dialog'; dialog: WorkspaceDialog }
  | { type: 'ui/close-dialog' }
  | { type: 'ui/toggle-explorer' }
  | { type: 'ui/toggle-copilot' }
  | { type: 'ui/toggle-bottom' }
  | { type: 'ui/set-bottom-open'; open: boolean }
  | { type: 'ui/set-bottom-tab'; tab: BottomPanelTab }
  | { type: 'ui/set-explorer-width'; width: number }
  | { type: 'ui/set-copilot-width'; width: number }
  | { type: 'ui/set-bottom-height'; height: number }
  | { type: 'ui/open-mobile-panel'; panel: 'explorer' | 'copilot' }
  | { type: 'ui/close-mobile-panel' }
  | { type: 'ui/toggle-copilot-context'; path: string }
  | { type: 'ui/clear-copilot-context' }
  | { type: 'ui/reset-layout' }
  | { type: 'ui/set-editor-preference'; patch: Partial<EditorPreferences> }
  | { type: 'ui/set-theme'; theme: EditorThemeId }
  | { type: 'ui/open-palette'; palette: 'files' | 'search' }
  | { type: 'ui/close-palette' }
  | { type: 'ui/set-pending-reveal'; reveal: PendingReveal | null }
  | { type: 'ui/show-toast'; message: string; tone: WorkspaceToastTone }
  | { type: 'ui/clear-toast' }
