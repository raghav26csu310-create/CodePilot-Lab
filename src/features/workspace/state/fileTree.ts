import type { FileTreeNode, TreeNodeKind, WorkspaceStats } from './types'
import { validateEntryName } from '../../../lib/storedPaths'

export { validateEntryName }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1
  }
  return collator.compare(a.name, b.name)
}

function finalizeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes]
    .sort(compareNodes)
    .map((node) => {
      if (node.kind === 'file') {
        return { ...node, children: [], fileCount: 1 }
      }

      const children = finalizeNodes(node.children)
      return {
        ...node,
        children,
        fileCount: children.reduce((total, child) => total + child.fileCount, 0),
      }
    })
}

/** Normalises separators and removes redundant root markers. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function nameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Some import paths include the selected root folder. Strip that prefix only
 * when every path shares it and it matches the project name.
 */
export function normalizeManifestPaths(paths: string[], projectName: string): string[] {
  const cleaned = [...new Set(paths.map(normalizePath).filter(Boolean))]

  if (cleaned.length === 0) {
    return []
  }

  const firstSegments = new Set(cleaned.map((path) => path.split('/')[0] ?? ''))
  if (firstSegments.size === 1) {
    const only = [...firstSegments][0]
    if (only && only.includes('/') === false) {
      const projectKey = nameKey(projectName)
      if (projectKey.length > 0 && nameKey(only) === projectKey) {
        const stripped = cleaned
          .map((path) => path.slice(only.length + 1))
          .filter((path) => path.length > 0)

        if (stripped.length === cleaned.length) {
          return stripped.sort((a, b) => collator.compare(a, b))
        }
      }
    }
  }

  return cleaned.sort((a, b) => collator.compare(a, b))
}

export function buildFileTree(paths: string[], projectName: string): FileTreeNode[] {
  const roots: FileTreeNode[] = []

  for (const path of normalizeManifestPaths(paths, projectName)) {
    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) {
      continue
    }

    let level = roots

    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index]
      if (!name) {
        break
      }

      const isFile = index === segments.length - 1
      const nodePath = segments.slice(0, index + 1).join('/')
      let node = level.find((candidate) => candidate.name === name)

      if (!node) {
        node = {
          id: nodePath,
          name,
          path: nodePath,
          kind: isFile ? 'file' : 'folder',
          children: [],
          fileCount: 0,
        }
        level.push(node)
      }

      if (isFile) {
        break
      }

      if (node.kind !== 'folder') {
        // A file already occupies this name; the descendant path is ignored.
        break
      }

      level = node.children
    }
  }

  return finalizeNodes(roots)
}

export type TreeEntry = {
  path: string
  kind: TreeNodeKind
}

/**
 * Builds a tree from persisted entries. Unlike the manifest projection this
 * keeps empty folders and explicit file/folder kinds.
 */
export function buildFileTreeFromEntries(entries: TreeEntry[]): FileTreeNode[] {
  const byPath = new Map<string, FileTreeNode>()
  const roots: FileTreeNode[] = []

  const sorted = entries
    .map((entry) => ({ path: normalizePath(entry.path), kind: entry.kind }))
    .filter((entry) => entry.path.length > 0)
    .sort((a, b) => collator.compare(a.path, b.path))

  for (const entry of sorted) {
    const segments = entry.path.split('/').filter(Boolean)

    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index]
      if (!name) {
        break
      }

      const path = segments.slice(0, index + 1).join('/')
      const isLeaf = index === segments.length - 1
      const kind: TreeNodeKind = isLeaf ? entry.kind : 'folder'
      const existing = byPath.get(path)

      if (existing) {
        // A persisted descendant makes this path a folder even if a stale
        // file record occupied it first.
        if (!isLeaf && existing.kind === 'file') {
          existing.kind = 'folder'
          existing.fileCount = 0
        }
        continue
      }

      const node: FileTreeNode = {
        id: path,
        name,
        path,
        kind,
        children: [],
        fileCount: 0,
      }

      byPath.set(path, node)

      const parentPath = segments.slice(0, index).join('/')
      const parent = parentPath ? byPath.get(parentPath) : null
      if (parent) {
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }
  }

  return finalizeNodes(roots)
}

export function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | null {  if (!path) {
    return null
  }

  let level = nodes
  let found: FileTreeNode | null = null

  for (const segment of path.split('/')) {
    found = level.find((node) => node.name === segment) ?? null
    if (!found) {
      return null
    }
    level = found.children
  }

  return found
}

export function getParentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : ''
}

export function getBaseName(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

export function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name
}

export function ancestorsOf(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  const ancestors: string[] = []

  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join('/'))
  }

  return ancestors
}

export function collectPaths(node: FileTreeNode): string[] {
  const paths = [node.path]

  for (const child of node.children) {
    paths.push(...collectPaths(child))
  }

  return paths
}

export function collectFolderPaths(nodes: FileTreeNode[]): string[] {
  const folders: string[] = []

  const walk = (list: FileTreeNode[]) => {
    for (const node of list) {
      if (node.kind === 'folder') {
        folders.push(node.path)
        walk(node.children)
      }
    }
  }

  walk(nodes)
  return folders
}

export function defaultExpandedPaths(nodes: FileTreeNode[]): string[] {
  return nodes.filter((node) => node.kind === 'folder').map((node) => node.path)
}

export function siblingNameExists(
  nodes: FileTreeNode[],
  parentPath: string,
  name: string,
  exceptPath?: string,
): boolean {
  const parent = parentPath ? findNode(nodes, parentPath) : null
  if (parentPath && (!parent || parent.kind !== 'folder')) {
    return false
  }

  const siblings = parent ? parent.children : nodes
  const key = name.trim().toLocaleLowerCase()

  return siblings.some(
    (node) => node.path !== exceptPath && node.name.toLocaleLowerCase() === key,
  )
}

export function addNode(
  nodes: FileTreeNode[],
  parentPath: string,
  name: string,
  kind: TreeNodeKind,
): FileTreeNode[] {
  const trimmed = name.trim()
  const path = joinPath(parentPath, trimmed)
  const created: FileTreeNode = {
    id: path,
    name: trimmed,
    path,
    kind,
    children: [],
    fileCount: kind === 'file' ? 1 : 0,
  }

  const insert = (list: FileTreeNode[]): FileTreeNode[] => {
    if (!parentPath) {
      return [...list, created]
    }

    return list.map((node) => {
      if (node.path === parentPath && node.kind === 'folder') {
        return { ...node, children: [...node.children, created] }
      }

      if (node.kind === 'folder' && parentPath.startsWith(`${node.path}/`)) {
        return { ...node, children: insert(node.children) }
      }

      return node
    })
  }

  return finalizeNodes(insert(nodes))
}

export function renameNode(
  nodes: FileTreeNode[],
  path: string,
  name: string,
): FileTreeNode[] {
  const trimmed = name.trim()
  const newPath = joinPath(getParentPath(path), trimmed)

  const relabel = (node: FileTreeNode): FileTreeNode => {
    const suffix = node.path.slice(path.length)
    const nextPath = `${newPath}${suffix}`

    return {
      ...node,
      id: nextPath,
      path: nextPath,
      name: node.path === path ? trimmed : node.name,
      children: node.children.map(relabel),
    }
  }

  const walk = (list: FileTreeNode[]): FileTreeNode[] =>
    list.map((node) => {
      if (node.path === path) {
        return relabel(node)
      }

      if (node.kind === 'folder' && path.startsWith(`${node.path}/`)) {
        return { ...node, children: walk(node.children) }
      }

      return node
    })

  return finalizeNodes(walk(nodes))
}

export function deleteNode(
  nodes: FileTreeNode[],
  path: string,
): { nodes: FileTreeNode[]; removedPaths: string[] } {
  const target = findNode(nodes, path)
  const removedPaths = target ? collectPaths(target) : [path]

  const walk = (list: FileTreeNode[]): FileTreeNode[] =>
    list
      .filter((node) => node.path !== path)
      .map((node) =>
        node.kind === 'folder' ? { ...node, children: walk(node.children) } : node,
      )

  return { nodes: finalizeNodes(walk(nodes)), removedPaths }
}

/** Maps an old path (and everything below it) to the renamed path. */
export function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) {
    return newPath
  }

  if (path.startsWith(`${oldPath}/`)) {
    return `${newPath}${path.slice(oldPath.length)}`
  }

  return path
}

export function searchTree(nodes: FileTreeNode[], query: string, limit = 200): FileTreeNode[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) {
    return []
  }

  const matches: FileTreeNode[] = []

  const walk = (list: FileTreeNode[]) => {
    for (const node of list) {
      if (matches.length >= limit) {
        return
      }

      const haystack = `${node.name} ${node.path}`.toLocaleLowerCase()
      if (haystack.includes(normalized)) {
        matches.push(node)
      }

      if (node.kind === 'folder') {
        walk(node.children)
      }
    }
  }

  walk(nodes)
  return matches
}

export function getWorkspaceStats(nodes: FileTreeNode[]): WorkspaceStats {
  let files = 0
  let folders = 0

  const walk = (list: FileTreeNode[]) => {
    for (const node of list) {
      if (node.kind === 'file') {
        files += 1
      } else {
        folders += 1
        walk(node.children)
      }
    }
  }

  walk(nodes)
  return { files, folders }
}
