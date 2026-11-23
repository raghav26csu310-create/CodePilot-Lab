import { readEditorPreferences } from '../../editor/editorPreferences'
import {
  addNode,
  ancestorsOf,
  buildFileTreeFromEntries,
  collectFolderPaths,
  defaultExpandedPaths,
  deleteNode,
  findNode,
  getBaseName,
  getParentPath,
  joinPath,
  remapPath,
  renameNode,
  siblingNameExists,
  validateEntryName,
  type TreeEntry,
} from './fileTree'
import {
  DEFAULT_LAYOUT,
  clampBottomHeight,
  clampCopilotWidth,
  clampExplorerWidth,
  readLayoutPreference,
} from './layoutPreference'
import type {
  BottomPanelTab,
  EditorMarker,
  FileTreeNode,
  WorkspaceAction,
  WorkspaceState,
  WorkspaceTab,
  WorkspaceTreeState,
} from './types'

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function markersEqual(left: EditorMarker[], right: EditorMarker[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((marker, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      marker.path === other.path &&
      marker.line === other.line &&
      marker.column === other.column &&
      marker.severity === other.severity &&
      marker.message === other.message &&
      marker.source === other.source
    )
  })
}

function createTab(path: string, name: string): WorkspaceTab {
  return {
    path,
    name,
    dirty: false,
    status: 'idle',
    source: 'none',
    content: '',
  }
}

function openFile(tree: WorkspaceTreeState, path: string): WorkspaceTreeState {
  const node = findNode(tree.nodes, path)
  if (!node || node.kind !== 'file') {
    return tree
  }

  const tabs = tree.tabs.some((tab) => tab.path === path)
    ? tree.tabs
    : [...tree.tabs, createTab(path, node.name)]

  return {
    ...tree,
    tabs,
    activeTabPath: path,
    selectedPath: path,
    expanded: unique([...tree.expanded, ...ancestorsOf(path)]),
  }
}

function closeTab(tree: WorkspaceTreeState, path: string): WorkspaceTreeState {
  const index = tree.tabs.findIndex((tab) => tab.path === path)
  if (index === -1) {
    return tree
  }

  const tabs = tree.tabs.filter((tab) => tab.path !== path)
  let activeTabPath = tree.activeTabPath

  if (activeTabPath === path) {
    const neighbour = tree.tabs[index - 1] ?? tree.tabs[index + 1] ?? null
    activeTabPath = neighbour && neighbour.path !== path ? neighbour.path : null
  }

  return {
    ...tree,
    tabs,
    activeTabPath,
    selectedPath: tree.selectedPath === path ? activeTabPath : tree.selectedPath,
  }
}

function readViewportDefaults(): {
  explorerOpen: boolean
  copilotOpen: boolean
  bottomOpen: boolean
} {
  if (typeof window === 'undefined') {
    return { explorerOpen: true, copilotOpen: true, bottomOpen: true }
  }

  return {
    explorerOpen: window.matchMedia('(min-width: 1024px)').matches,
    copilotOpen: window.matchMedia('(min-width: 1360px)').matches,
    bottomOpen: window.matchMedia('(min-width: 768px)').matches,
  }
}

export function createInitialWorkspaceState(entries: TreeEntry[] = []): WorkspaceState {
  const preference = readLayoutPreference()
  const viewport = readViewportDefaults()
  const nodes = buildFileTreeFromEntries(entries)

  return {
    tree: {
      nodes,
      expanded: defaultExpandedPaths(nodes),
      tabs: [],
      activeTabPath: null,
      selectedPath: null,
    },
    ui: {
      ...preference.layout,
      bottomTab: preference.bottomTab,
      explorerOpen: viewport.explorerOpen,
      copilotOpen: viewport.copilotOpen,
      bottomOpen: viewport.bottomOpen,
      dialog: null,
      mobilePanel: null,
      copilotContext: [],
      editor: readEditorPreferences(),
      markers: [],
      selection: null,
      cursor: null,
      palette: null,
      pendingReveal: null,
      pendingJob: null,
      toast: null,
    },
  }
}

function reconcileTabs(
  tree: WorkspaceTreeState,
  nodes: FileTreeNode[],
): WorkspaceTreeState {
  const tabs = tree.tabs.filter((tab) => {
    const node = findNode(nodes, tab.path)
    return node?.kind === 'file'
  })

  let activeTabPath = tree.activeTabPath
  const activeNode = activeTabPath ? findNode(nodes, activeTabPath) : null
  if (!activeNode || activeNode.kind !== 'file') {
    activeTabPath = tabs[0]?.path ?? null
  }

  const selectedNode = tree.selectedPath ? findNode(nodes, tree.selectedPath) : null
  const folderPaths = new Set(collectFolderPaths(nodes))

  return {
    nodes,
    expanded: tree.expanded.filter((path) => folderPaths.has(path)),
    tabs,
    activeTabPath,
    selectedPath: selectedNode ? tree.selectedPath : activeTabPath,
  }
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  const { tree, ui } = state

  switch (action.type) {
    case 'tree/replace': {
      const nextTree = reconcileTabs(tree, action.nodes)
      const context = ui.copilotContext.filter((path) => findNode(action.nodes, path))
      return { tree: nextTree, ui: { ...ui, copilotContext: context, dialog: null } }
    }

    case 'tree/toggle-folder': {
      const node = findNode(tree.nodes, action.path)
      if (!node || node.kind !== 'folder') {
        return state
      }

      const expanded = tree.expanded.includes(action.path)
        ? tree.expanded.filter((path) => path !== action.path)
        : [...tree.expanded, action.path]

      return {
        tree: { ...tree, expanded, selectedPath: action.path },
        ui,
      }
    }

    case 'tree/expand': {
      const paths = action.paths.filter((path) => {
        const node = findNode(tree.nodes, path)
        return node?.kind === 'folder'
      })
      return { tree: { ...tree, expanded: unique([...tree.expanded, ...paths]) }, ui }
    }

    case 'tree/reveal-folder': {
      const node = findNode(tree.nodes, action.path)
      if (!node || node.kind !== 'folder') {
        return state
      }

      return {
        tree: {
          ...tree,
          expanded: unique([...tree.expanded, ...ancestorsOf(action.path), action.path]),
          selectedPath: action.path,
        },
        ui,
      }
    }

    case 'tree/expand-all':
      return {
        tree: { ...tree, expanded: collectFolderPaths(tree.nodes) },
        ui,
      }

    case 'tree/collapse-all':
      return { tree: { ...tree, expanded: [] }, ui }

    case 'file/open':
      return { tree: openFile(tree, action.path), ui }

    case 'file/select': {
      if (!findNode(tree.nodes, action.path)) {
        return state
      }
      return { tree: { ...tree, selectedPath: action.path }, ui }
    }

    case 'tab/activate': {
      const tab = tree.tabs.find((candidate) => candidate.path === action.path)
      if (!tab) {
        return state
      }
      return {
        tree: { ...tree, activeTabPath: action.path, selectedPath: action.path },
        ui,
      }
    }

    case 'tab/close':
      return { tree: closeTab(tree, action.path), ui }

    case 'tab/close-others': {
      const tab = tree.tabs.find((candidate) => candidate.path === action.path)
      if (!tab) {
        return state
      }
      return {
        tree: {
          ...tree,
          tabs: [tab],
          activeTabPath: tab.path,
          selectedPath: tab.path,
        },
        ui,
      }
    }

    case 'tab/close-all':
      return {
        tree: { ...tree, tabs: [], activeTabPath: null, selectedPath: null },
        ui,
      }

    case 'tab/content-loading':
      return {
        tree: {
          ...tree,
          tabs: tree.tabs.map((tab) =>
            tab.path === action.path
              ? { ...tab, status: 'loading', error: undefined }
              : tab,
          ),
        },
        ui,
      }

    case 'tab/content-loaded':
      return {
        tree: {
          ...tree,
          tabs: tree.tabs.map((tab) =>
            tab.path === action.path
              ? {
                  ...tab,
                  status: action.status,
                  content: action.content ?? '',
                  source: action.source ?? (action.status === 'ready' ? 'stored' : 'none'),
                  error: action.error,
                }
              : tab,
          ),
        },
        ui,
      }

    case 'tab/reset-content':
      return {
        tree: {
          ...tree,
          tabs: tree.tabs.map((tab) =>
            tab.path === action.path
              ? { ...tab, status: 'idle', error: undefined }
              : tab,
          ),
        },
        ui,
      }

    case 'tab/set-dirty':
      return {
        tree: {
          ...tree,
          tabs: tree.tabs.map((tab) =>
            tab.path === action.path && tab.dirty !== action.dirty
              ? { ...tab, dirty: action.dirty }
              : tab,
          ),
        },
        ui,
      }

    case 'tab/mark-saved':
      return {
        tree: {
          ...tree,
          tabs: tree.tabs.map((tab) =>
            tab.path === action.path
              ? {
                  ...tab,
                  dirty: false,
                  content: action.content,
                  source: 'stored',
                  status: 'ready',
                  error: undefined,
                }
              : tab,
          ),
        },
        ui,
      }

    case 'editor/set-markers': {
      if (markersEqual(ui.markers, action.markers)) {
        return state
      }
      return { tree, ui: { ...ui, markers: action.markers } }
    }

    case 'editor/set-selection': {
      const current = ui.selection
      const next = action.selection
      if (
        current === next ||
        (current !== null &&
          next !== null &&
          current.path === next.path &&
          current.text === next.text &&
          current.startLine === next.startLine &&
          current.startColumn === next.startColumn &&
          current.endLine === next.endLine &&
          current.endColumn === next.endColumn)
      ) {
        return state
      }
      return { tree, ui: { ...ui, selection: next } }
    }

    case 'editor/set-cursor': {
      const cur = ui.cursor
      const nxt = action.cursor
      if (
        cur === nxt ||
        (cur !== null &&
          nxt !== null &&
          cur.line === nxt.line &&
          cur.column === nxt.column &&
          cur.selected === nxt.selected)
      ) {
        return state
      }
      return { tree, ui: { ...ui, cursor: nxt } }
    }

    case 'entry/create': {
      const name = action.name.trim()
      const parentPath = action.parentPath
      const parent = parentPath ? findNode(tree.nodes, parentPath) : null

      if (
        (parentPath && (!parent || parent.kind !== 'folder')) ||
        validateEntryName(name) ||
        siblingNameExists(tree.nodes, parentPath, name)
      ) {
        return state
      }

      const nodes = addNode(tree.nodes, parentPath, name, action.kind)
      const path = joinPath(parentPath, name)
      const expanded = parentPath
        ? unique([...tree.expanded, ...ancestorsOf(parentPath), parentPath])
        : tree.expanded

      let nextTree: WorkspaceTreeState = {
        ...tree,
        nodes,
        expanded: action.kind === 'folder' ? unique([...expanded, path]) : expanded,
        selectedPath: path,
      }

      if (action.kind === 'file') {
        nextTree = openFile(nextTree, path)
      }

      return { tree: nextTree, ui: { ...ui, dialog: null } }
    }

    case 'entry/rename': {
      const node = findNode(tree.nodes, action.path)
      if (!node) {
        return state
      }

      const name = action.name.trim()
      if (name === node.name) {
        return { tree, ui: { ...ui, dialog: null } }
      }

      const parentPath = getParentPath(action.path)
      if (
        validateEntryName(name) ||
        siblingNameExists(tree.nodes, parentPath, name, action.path)
      ) {
        return state
      }

      const nodes = renameNode(tree.nodes, action.path, name)
      const newPath = joinPath(parentPath, name)
      const remap = (path: string) => remapPath(path, action.path, newPath)

      const tabs = tree.tabs.map((tab) => {
        const path = remap(tab.path)
        const nextNode = findNode(nodes, path)
        const draft = tab.path === action.path ? action.draft : undefined
        return {
          ...tab,
          path,
          name: nextNode?.name ?? getBaseName(path),
          content: draft ?? tab.content,
        }
      })

      return {
        tree: {
          ...tree,
          nodes,
          expanded: unique(tree.expanded.map(remap)),
          tabs,
          activeTabPath: tree.activeTabPath ? remap(tree.activeTabPath) : null,
          selectedPath: tree.selectedPath ? remap(tree.selectedPath) : null,
        },
        ui: {
          ...ui,
          copilotContext: unique(ui.copilotContext.map(remap)),
          dialog: null,
        },
      }
    }

    case 'entry/delete': {
      const node = findNode(tree.nodes, action.path)
      if (!node) {
        return state
      }

      const { nodes, removedPaths } = deleteNode(tree.nodes, action.path)
      const removed = new Set(removedPaths)
      const tabs = tree.tabs.filter((tab) => !removed.has(tab.path))

      let activeTabPath = tree.activeTabPath
      if (activeTabPath && removed.has(activeTabPath)) {
        const originalIndex = tree.tabs.findIndex((tab) => tab.path === activeTabPath)
        const neighbour =
          tree.tabs[originalIndex - 1] ?? tree.tabs[originalIndex + 1] ?? null
        activeTabPath =
          neighbour && !removed.has(neighbour.path)
            ? neighbour.path
            : tabs[0]?.path ?? null
      }

      const parentPath = getParentPath(action.path)
      const selectedPath =
        tree.selectedPath && removed.has(tree.selectedPath)
          ? findNode(nodes, parentPath)
            ? parentPath
            : activeTabPath
          : tree.selectedPath

      return {
        tree: {
          ...tree,
          nodes,
          expanded: tree.expanded.filter((path) => !removed.has(path)),
          tabs,
          activeTabPath,
          selectedPath,
        },
        ui: {
          ...ui,
          copilotContext: ui.copilotContext.filter((path) => !removed.has(path)),
          dialog: null,
        },
      }
    }

    case 'ui/open-dialog':
      return {
        tree,
        ui: { ...ui, dialog: action.dialog, mobilePanel: null, palette: null },
      }

    case 'ui/close-dialog':
      return { tree, ui: { ...ui, dialog: null } }

    case 'ui/toggle-explorer':
      return { tree, ui: { ...ui, explorerOpen: !ui.explorerOpen } }

    case 'ui/toggle-copilot':
      return { tree, ui: { ...ui, copilotOpen: !ui.copilotOpen } }

    case 'ui/toggle-bottom':
      return { tree, ui: { ...ui, bottomOpen: !ui.bottomOpen } }

    case 'ui/set-bottom-open':
      return { tree, ui: { ...ui, bottomOpen: action.open } }

    case 'ui/set-bottom-tab':
      return {
        tree,
        ui: { ...ui, bottomTab: action.tab, bottomOpen: true },
      }

    case 'ui/set-explorer-width':
      return {
        tree,
        ui: { ...ui, explorerWidth: clampExplorerWidth(action.width) },
      }

    case 'ui/set-copilot-width':
      return {
        tree,
        ui: { ...ui, copilotWidth: clampCopilotWidth(action.width) },
      }

    case 'ui/set-bottom-height':
      return {
        tree,
        ui: { ...ui, bottomHeight: clampBottomHeight(action.height) },
      }

    case 'ui/open-mobile-panel':
      return { tree, ui: { ...ui, mobilePanel: action.panel } }

    case 'ui/close-mobile-panel':
      return { tree, ui: { ...ui, mobilePanel: null } }

    case 'ui/toggle-copilot-context': {
      const exists = ui.copilotContext.includes(action.path)
      const next = exists
        ? ui.copilotContext.filter((path) => path !== action.path)
        : [...ui.copilotContext, action.path].slice(-8)

      return {
        tree,
        ui: {
          ...ui,
          copilotContext: next,
          copilotOpen: exists ? ui.copilotOpen : true,
        },
      }
    }

    case 'ui/clear-copilot-context':
      return { tree, ui: { ...ui, copilotContext: [] } }

    case 'ui/reset-layout':
      return {
        tree,
        ui: {
          ...ui,
          ...DEFAULT_LAYOUT,
          bottomTab: 'terminal' satisfies BottomPanelTab,
          bottomOpen: true,
        },
      }

    case 'ui/set-editor-preference':
      return {
        tree,
        ui: { ...ui, editor: { ...ui.editor, ...action.patch } },
      }

    case 'ui/set-theme':
      return {
        tree,
        ui: { ...ui, editor: { ...ui.editor, theme: action.theme } },
      }

    case 'ui/open-palette':
      return {
        tree,
        ui: { ...ui, palette: action.palette, dialog: null, mobilePanel: null },
      }

    case 'ui/close-palette':
      return { tree, ui: { ...ui, palette: null } }

    case 'ui/set-pending-reveal':
      return { tree, ui: { ...ui, pendingReveal: action.reveal } }

    case 'ui/set-pending-job':
      return { tree, ui: { ...ui, pendingJob: action.job } }

    case 'ui/show-toast':
      return {
        tree,
        ui: {
          ...ui,
          toast: {
            id: (ui.toast?.id ?? 0) + 1,
            message: action.message,
            tone: action.tone,
          },
        },
      }

    case 'ui/clear-toast':
      return { tree, ui: { ...ui, toast: null } }

    default:
      return state
  }
}
