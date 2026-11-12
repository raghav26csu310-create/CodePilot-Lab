import {
  db,
  ensureProjectEntries,
  type ProjectRecord,
  type StoredEntry,
} from './db'
import {
  assertStoredPath,
  normalizeStoredPath,
  storedPath,
} from './storedPaths'

export { StoredPathError, storedPath, validateEntryName, validateStoredPath } from './storedPaths'

export type ContentSource = 'stored' | 'disk'

export type LoadedContent =
  | { status: 'ready'; content: string; source: ContentSource }
  | { status: 'unavailable'; reason: string }

export type SearchHit = {
  path: string
  line: number
  column: number
  preview: string
}

export type ContentSearchReport = {
  hits: SearchHit[]
  scannedFiles: number
  totalMatches: number
  capped: boolean
}

const SEARCH_HIT_LIMIT = 100

const normalizePath = normalizeStoredPath

function getParentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : ''
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) {
    return newPath
  }
  if (path.startsWith(`${oldPath}/`)) {
    return `${newPath}${path.slice(oldPath.length)}`
  }
  return path
}

export async function listStoredEntries(projectId: string): Promise<StoredEntry[]> {
  return db.files.where('projectId').equals(projectId).toArray()
}

export async function prepareProjectStorage(project: ProjectRecord): Promise<void> {
  await ensureProjectEntries(project)
}

export async function readStoredContent(
  projectId: string,
  path: string,
): Promise<string | null> {
  const row = await db.contents.get([projectId, normalizePath(path)])
  return row ? row.content : null
}

type PermittedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

/** Reads the real bytes behind a linked folder handle, if it is readable. */
async function readLinkedFile(
  project: ProjectRecord,
  path: string,
): Promise<LoadedContent> {
  const root = project.directoryHandle as PermittedDirectoryHandle | undefined
  if (!root) {
    return {
      status: 'unavailable',
      reason:
        'This manifest-only record has no folder handle. Re-import the folder to read its real contents.',
    }
  }

  try {
    if (typeof root.queryPermission === 'function') {
      const permission = await root.queryPermission({ mode: 'read' })
      if (permission !== 'granted' && typeof root.requestPermission === 'function') {
        const requested = await root.requestPermission({ mode: 'read' })
        if (requested !== 'granted') {
          return {
            status: 'unavailable',
            reason:
              'Read permission for the linked folder was not granted. Open the file again and allow access.',
          }
        }
      }
    }

    const segments = normalizePath(path).split('/').filter(Boolean)
    const fileName = segments.pop()
    if (!fileName) {
      return { status: 'unavailable', reason: 'The stored path is empty.' }
    }

    let directory = root
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment)
    }

    const handle = await directory.getFileHandle(fileName)
    const file = await handle.getFile()
    const content = await file.text()
    return { status: 'ready', content, source: 'disk' }
  } catch {
    return {
      status: 'unavailable',
      reason:
        'The linked folder could not be read. The handle may have moved, lost permission, or the file no longer exists.',
    }
  }
}

/**
 * Stored IndexedDB content wins after the first save; otherwise a linked folder
 * is the source of truth. Nothing is generated when neither source exists.
 */
export async function loadFileContent(
  project: ProjectRecord,
  path: string,
): Promise<LoadedContent> {
  const stored = await readStoredContent(project.id, path)
  if (stored !== null) {
    return { status: 'ready', content: stored, source: 'stored' }
  }

  return readLinkedFile(project, path)
}

async function syncProjectFileMetadata(
  projectId: string,
  options: { touchModifiedAt: boolean },
): Promise<void> {
  const files = await db.files.where('projectId').equals(projectId).toArray()
  const project = await db.projects.get(projectId)
  if (!project) {
    return
  }

  const manifest = files
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b))

  await db.projects.put({
    ...project,
    manifest,
    fileCount: manifest.length,
    modifiedAt: options.touchModifiedAt ? Date.now() : project.modifiedAt,
  })
}

export async function writeStoredContent(
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  const normalized = assertStoredPath(path)
  const now = Date.now()
  const sizeBytes = byteLength(content)

  await db.transaction('rw', db.contents, db.files, db.projects, async () => {
    await db.contents.put({
      projectId,
      path: normalized,
      content,
      updatedAt: now,
    })

    const entry = await db.files.get([projectId, normalized])
    if (entry) {
      await db.files.put({ ...entry, sizeBytes, updatedAt: now })
    } else {
      // A content record without tree metadata should not happen, but repairing
      // it is safer than silently losing saved code.
      await db.files.put({
        projectId,
        path: normalized,
        kind: 'file',
        sizeBytes,
        createdAt: now,
        updatedAt: now,
      })
    }

    const project = await db.projects.get(projectId)
    if (project) {
      await db.projects.put({ ...project, modifiedAt: now })
    }
  })
}

export async function createStoredEntry(
  projectId: string,
  parentPath: string,
  name: string,
  kind: 'file' | 'folder',
): Promise<string> {
  const path = storedPath(parentPath, name)
  const now = Date.now()

  await db.transaction('rw', db.files, db.contents, db.projects, async () => {
    await db.files.put({
      projectId,
      path,
      kind,
      sizeBytes: 0,
      createdAt: now,
      updatedAt: now,
    })

    if (kind === 'file') {
      await db.contents.put({
        projectId,
        path,
        content: '',
        updatedAt: now,
      })
    }

    await syncProjectFileMetadata(projectId, { touchModifiedAt: true })
  })

  return path
}

export async function renameStoredEntry(
  projectId: string,
  path: string,
  name: string,
): Promise<string> {
  const oldPath = assertStoredPath(path)
  const newPath = storedPath(getParentPath(oldPath), name)
  const now = Date.now()

  if (newPath === oldPath) {
    return newPath
  }

  await db.transaction('rw', db.files, db.contents, db.projects, async () => {
    const entries = await db.files.where('projectId').equals(projectId).toArray()
    const contents = await db.contents.where('projectId').equals(projectId).toArray()

    const movingEntries = entries.filter((entry) => isWithin(entry.path, oldPath))
    const movingContents = contents.filter((content) => isWithin(content.path, oldPath))

    await db.files.bulkDelete(movingEntries.map((entry) => [projectId, entry.path]))
    await db.contents.bulkDelete(movingContents.map((content) => [projectId, content.path]))

    await db.files.bulkPut(
      movingEntries.map((entry) => ({
        ...entry,
        path: remapPath(entry.path, oldPath, newPath),
        updatedAt: now,
      })),
    )

    if (movingContents.length > 0) {
      await db.contents.bulkPut(
        movingContents.map((content) => ({
          ...content,
          path: remapPath(content.path, oldPath, newPath),
        })),
      )
    }

    await syncProjectFileMetadata(projectId, { touchModifiedAt: true })
  })

  return newPath
}

export async function deleteStoredEntry(
  projectId: string,
  path: string,
): Promise<string[]> {
  const normalized = assertStoredPath(path)

  return db.transaction('rw', db.files, db.contents, db.projects, async () => {
    const entries = await db.files.where('projectId').equals(projectId).toArray()
    const removed = entries
      .filter((entry) => isWithin(entry.path, normalized))
      .map((entry) => entry.path)

    await db.files.bulkDelete(removed.map((entryPath) => [projectId, entryPath]))
    await db.contents.bulkDelete(removed.map((entryPath) => [projectId, entryPath]))
    await syncProjectFileMetadata(projectId, { touchModifiedAt: true })

    return removed
  })
}

export async function searchStoredContents(
  projectId: string,
  query: string,
): Promise<ContentSearchReport> {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) {
    return { hits: [], scannedFiles: 0, totalMatches: 0, capped: false }
  }

  const contents = await db.contents.where('projectId').equals(projectId).toArray()
  const hits: SearchHit[] = []
  let totalMatches = 0

  for (const record of contents) {
    const lines = record.content.split(/\r?\n/)

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const column = line.toLocaleLowerCase().indexOf(needle)
      if (column === -1) {
        continue
      }

      totalMatches += 1
      if (hits.length < SEARCH_HIT_LIMIT) {
        hits.push({
          path: record.path,
          line: index + 1,
          column: column + 1,
          preview: line.trim().slice(0, 180),
        })
      }
    }
  }

  return {
    hits,
    scannedFiles: contents.length,
    totalMatches,
    capped: totalMatches > hits.length,
  }
}
