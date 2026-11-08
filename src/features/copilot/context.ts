import type { ProjectRecord } from '../../lib/db'
import { loadFileContent } from '../../lib/projectStorage'
import { languageForPath } from '../editor/languageRegistry'
import type { EditorMarker, EditorSelection, FileTreeNode, WorkspaceTab } from '../workspace/state/types'
import type {
  ContextBundle,
  ContextFile,
  ContextOptions,
  ContextSummary,
} from './types'

export const DEFAULT_CONTEXT_OPTIONS: ContextOptions = {
  includeActiveFile: true,
  includeSelection: true,
  includeTree: true,
  includeDiagnostics: true,
}

export const MAX_CONTEXT_FILES = 8
const MAX_FILE_CHARS = 20000
const MAX_SELECTION_CHARS = 12000
const MAX_TREE_ENTRIES = 240
const MAX_DIAGNOSTICS = 40

export type BuildContextInput = {
  project: ProjectRecord
  tabs: WorkspaceTab[]
  nodes: FileTreeNode[]
  activePath: string | null
  selection: EditorSelection | null
  markers: EditorMarker[]
  /** Paths the user explicitly attached in the context control. */
  attached: string[]
  options: ContextOptions
  /** Live Monaco draft for an open path, if any. */
  getDraft: (path: string) => string | null
  /** Character budget for file content (selection is budgeted separately). */
  contextChars: number
}

export function collectContextPaths(
  activePath: string | null,
  selection: EditorSelection | null,
  attached: string[],
  options: ContextOptions,
  nodes: FileTreeNode[],
): string[] {
  const exists = new Set<string>()
  const walk = (items: FileTreeNode[]) => {
    for (const node of items) {
      if (node.kind === 'file') {
        exists.add(node.path)
      }
      walk(node.children)
    }
  }
  walk(nodes)

  const ordered: string[] = []
  if (options.includeActiveFile && activePath && exists.has(activePath)) {
    ordered.push(activePath)
  }
  if (options.includeSelection && selection && exists.has(selection.path)) {
    ordered.push(selection.path)
  }
  for (const path of attached) {
    if (exists.has(path)) {
      ordered.push(path)
    }
  }

  return [...new Set(ordered)].slice(0, MAX_CONTEXT_FILES)
}

function renderTree(nodes: FileTreeNode[]): { lines: string[]; truncated: boolean } {
  const lines: string[] = []
  let truncated = false

  const walk = (items: FileTreeNode[]) => {
    for (const node of items) {
      if (lines.length >= MAX_TREE_ENTRIES) {
        truncated = true
        return
      }
      lines.push(node.kind === 'folder' ? `${node.path}/` : node.path)
      walk(node.children)
      if (truncated) {
        return
      }
    }
  }

  walk(nodes)
  return { lines, truncated }
}

function truncate(content: string, limit: number): { text: string; truncated: boolean } {
  if (content.length <= limit) {
    return { text: content, truncated: false }
  }
  return { text: content.slice(0, limit), truncated: true }
}

async function loadContextFile(
  input: BuildContextInput,
  path: string,
  perFileBudget: number,
): Promise<ContextFile> {
  const language = languageForPath(path).label
  const tab = input.tabs.find((candidate) => candidate.path === path)
  const draft = input.getDraft(path)

  let content = ''
  let source: ContextFile['source'] = 'unavailable'
  let reason: string | undefined

  if (draft !== null) {
    content = draft
    source = 'draft'
  } else if (tab && tab.status === 'ready') {
    content = tab.content
    source = 'stored'
  } else {
    const loaded = await loadFileContent(input.project, path)
    if (loaded.status === 'ready') {
      content = loaded.content
      source = loaded.source
    } else {
      reason = loaded.reason
    }
  }

  const originalChars = content.length
  const { text, truncated } = truncate(content, perFileBudget)

  return {
    path,
    language,
    content: text,
    chars: text.length,
    originalChars,
    truncated,
    source,
    dirty: tab?.dirty ?? false,
    reason,
  }
}

/**
 * Builds the exact bundle that will be sent to the provider. Everything is
 * read from real editor models or IndexedDB; nothing is invented or silently
 * expanded beyond the paths listed in the result.
 */
export async function buildContextBundle(input: BuildContextInput): Promise<ContextBundle> {
  const paths = collectContextPaths(
    input.activePath,
    input.selection,
    input.attached,
    input.options,
    input.nodes,
  )

  const treeRender = input.options.includeTree
    ? renderTree(input.nodes)
    : { lines: [], truncated: false }

  const selection =
    input.options.includeSelection && input.selection && paths.includes(input.selection.path)
      ? input.selection
      : null

  const selectionText = selection ? truncate(selection.text, MAX_SELECTION_CHARS) : null
  const selectionChars = selectionText ? selectionText.text.length : 0
  const fileBudget = Math.max(0, input.contextChars - selectionChars)
  const perFileBudget =
    paths.length > 0
      ? Math.min(MAX_FILE_CHARS, Math.max(2000, Math.floor(fileBudget / paths.length)))
      : 0

  const files = await Promise.all(
    paths.map((path) => loadContextFile(input, path, perFileBudget)),
  )

  // A file whose content could not be read is still reported honestly.
  const omitted = files
    .filter((file) => file.source === 'unavailable')
    .map((file) => ({ path: file.path, reason: file.reason ?? 'Content unavailable.' }))

  const sharedPaths = new Set(paths)
  const diagnostics = input.options.includeDiagnostics
    ? input.markers
        .filter((marker) => sharedPaths.has(marker.path))
        .slice(0, MAX_DIAGNOSTICS)
        .map((marker) => ({
          path: marker.path,
          line: marker.line,
          column: marker.column,
          severity: marker.severity,
          message: marker.message,
          source: marker.source,
        }))
    : []

  const totalChars = files.reduce((total, file) => total + file.chars, 0) + selectionChars

  return {
    files,
    omitted,
    tree: treeRender.lines,
    treeTruncated: treeRender.truncated,
    diagnostics,
    selection:
      selection && selectionText
        ? {
            path: selection.path,
            text: selectionText.text,
            startLine: selection.startLine,
            endLine: selection.endLine,
            startColumn: selection.startColumn,
            endColumn: selection.endColumn,
            truncated: selectionText.truncated,
          }
        : null,
    totalChars,
    selectionChars,
  }
}

export function summarizeContext(bundle: ContextBundle): ContextSummary {
  return {
    files: bundle.files.map((file) => ({
      path: file.path,
      language: file.language,
      chars: file.chars,
      truncated: file.truncated,
      source: file.source,
    })),
    omitted: bundle.omitted,
    treeCount: bundle.tree.length,
    diagnostics: bundle.diagnostics.length,
    selectionLines: bundle.selection
      ? Math.max(1, bundle.selection.endLine - bundle.selection.startLine + 1)
      : 0,
    totalChars: bundle.totalChars,
  }
}
