import {
  db,
  ensureProjectEntries,
  type ProjectRecord,
  type StoredEntry,
} from './db'
import { logActivity } from './activityService'
import {
  ensureHandlePermission,
  pickDirectory,
  queryHandlePermission,
  readTextFromDirectory,
  writeTextToDirectory,
  type DiskAccessStatus,
  type DiskWriteOutcome,
} from './diskAccess'
import {
  MAX_IMPORT_CONTENT_BYTES,
  MAX_IMPORT_FILE_BYTES,
  isProbablyBinary,
  type ImportFileCandidate,
} from './projectImport'
import {
  assertStoredPath,
  normalizeStoredPath,
  storedPath,
  validateEntryName,
} from './storedPaths'

export { StoredPathError, storedPath, validateEntryName, validateStoredPath } from './storedPaths'

export type ContentSource = 'stored' | 'disk'

export type LoadedContent =
  | { status: 'ready'; content: string; source: ContentSource }
  | { status: 'unavailable'; reason: string }

export type SaveContentResult = {
  stored: true
  disk: DiskWriteOutcome
}

export type ImportedContentsResult = {
  stored: number
  bytes: number
  skipped: { path: string; reason: string }[]
}

export type ProjectFileBundle = {
  files: { path: string; content: string }[]
  unavailable: { path: string; reason: string }[]
  storedCount: number
  diskCount: number
}

export type LinkedFolderProbe =
  | { status: 'none' }
  | { status: 'unsupported'; reason: string }
  | { status: 'linked'; read: DiskAccessStatus; write: DiskAccessStatus }

export type ReconnectFolderResult =
  | { status: 'linked'; project: ProjectRecord; writeAccess: boolean; reason?: string }
  | { status: 'cancelled' }
  | { status: 'unsupported'; reason: string }
  | { status: 'failed'; reason: string }

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

/** Reads the real bytes behind a linked folder handle, if it is readable. */
export async function readLinkedFileContent(
  project: ProjectRecord,
  path: string,
): Promise<LoadedContent> {
  const root = project.directoryHandle
  if (!root) {
    return {
      status: 'unavailable',
      reason:
        'This manifest-only record has no folder handle. Import the folder or open the file to read its real contents.',
    }
  }

  const result = await readTextFromDirectory(root, path)
  if (result.status === 'ready') {
    if (isProbablyBinary(new TextEncoder().encode(result.content))) {
      return {
        status: 'unavailable',
        reason:
          'This device file looks binary. The text editor does not open binary files, so no content is shown.',
      }
    }
    return { status: 'ready', content: result.content, source: 'disk' }
  }

  return {
    status: 'unavailable',
    reason: `${result.reason} Use “Reconnect folder” on the project dossier to choose the folder again.`,
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

  return readLinkedFileContent(project, path)
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

/**
 * Attempts a real write to the linked device folder. Never throws: the caller
 * keeps the IndexedDB save and reports the disk outcome separately.
 */
export async function writeContentToLinkedFolder(
  project: ProjectRecord,
  path: string,
  content: string,
): Promise<DiskWriteOutcome> {
  if (!project.directoryHandle) {
    return {
      status: 'skipped',
      reason:
        'This project has no linked device folder. The save updated the browser copy only.',
    }
  }

  const normalized = assertStoredPath(path)
  return writeTextToDirectory(project.directoryHandle, normalized, content)
}

/**
 * Saves to IndexedDB, then tries the linked folder. The IndexedDB write is the
 * durable browser copy; the disk result is returned so the UI can be exact.
 */
export async function saveFileContent(
  project: ProjectRecord,
  path: string,
  content: string,
): Promise<SaveContentResult> {
  await writeStoredContent(project.id, path, content)
  const disk = await writeContentToLinkedFolder(project, path, content)
  void logActivity({
    type: 'file:save',
    description: `Saved file ${path}`,
    projectId: project.id,
    projectName: project.name,
    target: path,
    status: 'success',
  })
  return { stored: true, disk }
}

/** Current read/write permission of the linked folder, without prompting. */
export async function probeLinkedFolder(project: ProjectRecord): Promise<LinkedFolderProbe> {
  const root = project.directoryHandle
  if (!root) {
    return { status: 'none' }
  }

  if (typeof root.queryPermission !== 'function') {
    return {
      status: 'unsupported',
      reason: 'This browser does not expose folder permissions to the page.',
    }
  }

  const [read, write] = await Promise.all([
    queryHandlePermission(root, 'read'),
    queryHandlePermission(root, 'readwrite'),
  ])

  return { status: 'linked', read: read.status, write: write.status }
}

/** Re-picks a device folder for an existing record and stores the new handle. */
export async function reconnectLinkedFolder(
  project: ProjectRecord,
): Promise<ReconnectFolderResult> {
  const picked = await pickDirectory('readwrite')
  if (picked.status === 'cancelled') {
    return { status: 'cancelled' }
  }
  if (picked.status === 'unsupported') {
    return { status: 'unsupported', reason: picked.reason }
  }
  if (picked.status === 'failed') {
    return { status: 'failed', reason: picked.reason }
  }

  const permission = await ensureHandlePermission(picked.handle, 'readwrite', true)

  const updated = await db.transaction('rw', db.projects, async () => {
    const current = await db.projects.get(project.id)
    if (!current) {
      return undefined
    }
    const next: ProjectRecord = { ...current, directoryHandle: picked.handle }
    await db.projects.put(next)
    return next
  })

  if (!updated) {
    return {
      status: 'failed',
      reason: 'The project record disappeared while the folder was being linked.',
    }
  }

  return {
    status: 'linked',
    project: updated,
    writeAccess: permission.status === 'granted',
    reason: permission.reason,
  }
}

/**
 * Stores real text contents for a freshly imported folder. Files above the
 * per-file or total cap, binary files and unreadable files are reported.
 */
export async function storeScannedContents(
  projectId: string,
  candidates: ImportFileCandidate[],
): Promise<ImportedContentsResult> {
  const skipped: { path: string; reason: string }[] = []
  const pending: { path: string; content: string; sizeBytes: number }[] = []
  let totalBytes = 0

  for (const candidate of candidates) {
    if (candidate.file.size > MAX_IMPORT_FILE_BYTES) {
      skipped.push({
        path: candidate.path,
        reason: `Larger than the ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MiB browser-copy limit.`,
      })
      continue
    }

    if (totalBytes + candidate.file.size > MAX_IMPORT_CONTENT_BYTES) {
      skipped.push({
        path: candidate.path,
        reason: `The folder exceeded the ${Math.round(MAX_IMPORT_CONTENT_BYTES / (1024 * 1024))} MiB browser-copy budget.`,
      })
      continue
    }

    let path: string
    try {
      path = assertStoredPath(candidate.path)
    } catch (cause) {
      skipped.push({
        path: candidate.path,
        reason: cause instanceof Error ? cause.message : 'The path is not safe to store.',
      })
      continue
    }

    try {
      const bytes = new Uint8Array(await candidate.file.arrayBuffer())
      if (isProbablyBinary(bytes)) {
        skipped.push({ path, reason: 'Binary file. Only text is stored in the browser copy.' })
        continue
      }

      const content = new TextDecoder('utf-8').decode(bytes)
      pending.push({ path, content, sizeBytes: bytes.length })
      totalBytes += bytes.length
    } catch (cause) {
      skipped.push({
        path,
        reason: cause instanceof Error ? cause.message : 'The file could not be read from the folder.',
      })
    }
  }

  if (pending.length > 0) {
    const now = Date.now()
    await db.transaction('rw', db.contents, db.files, db.projects, async () => {
      for (const record of pending) {
        await db.contents.put({
          projectId,
          path: record.path,
          content: record.content,
          updatedAt: now,
        })

        const entry = await db.files.get([projectId, record.path])
        if (entry) {
          await db.files.put({ ...entry, sizeBytes: record.sizeBytes, updatedAt: now })
        } else {
          await db.files.put({
            projectId,
            path: record.path,
            kind: 'file',
            sizeBytes: record.sizeBytes,
            createdAt: now,
            updatedAt: now,
          })
        }
      }

      await syncProjectFileMetadata(projectId, { touchModifiedAt: false })
    })
  }

  return { stored: pending.length, bytes: totalBytes, skipped }
}

/** Stores already-decoded archive contents in one transaction. */
export async function storeProjectContents(
  projectId: string,
  files: { path: string; content: string }[],
): Promise<ImportedContentsResult> {
  const skipped: { path: string; reason: string }[] = []
  const pending: { path: string; content: string; sizeBytes: number }[] = []
  let totalBytes = 0

  for (const file of files) {
    let path: string
    try {
      path = assertStoredPath(file.path)
    } catch (cause) {
      skipped.push({
        path: file.path,
        reason: cause instanceof Error ? cause.message : 'The path is not safe to store.',
      })
      continue
    }

    const sizeBytes = byteLength(file.content)
    pending.push({ path, content: file.content, sizeBytes })
    totalBytes += sizeBytes
  }

  if (pending.length > 0) {
    const now = Date.now()
    await db.transaction('rw', db.contents, db.files, db.projects, async () => {
      for (const record of pending) {
        await db.contents.put({
          projectId,
          path: record.path,
          content: record.content,
          updatedAt: now,
        })

        const entry = await db.files.get([projectId, record.path])
        if (entry) {
          await db.files.put({ ...entry, sizeBytes: record.sizeBytes, updatedAt: now })
        } else {
          await db.files.put({
            projectId,
            path: record.path,
            kind: 'file',
            sizeBytes: record.sizeBytes,
            createdAt: now,
            updatedAt: now,
          })
        }
      }

      await syncProjectFileMetadata(projectId, { touchModifiedAt: false })
    })
  }

  return { stored: pending.length, bytes: totalBytes, skipped }
}

/**
 * Adds dropped or picked files to a project folder. Names are validated and
 * collisions are reported instead of overwritten.
 */
export async function importFilesIntoProject(
  projectId: string,
  parentPath: string,
  files: File[],
): Promise<{ stored: string[]; skipped: { name: string; reason: string }[] }> {
  const stored: string[] = []
  const skipped: { name: string; reason: string }[] = []

  let parent: string
  try {
    parent = parentPath.trim() ? assertStoredPath(parentPath) : ''
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'The destination folder is not valid.'
    return { stored, skipped: files.map((file) => ({ name: file.name, reason })) }
  }

  const existing = await db.files.where('projectId').equals(projectId).toArray()
  const taken = new Set(
    existing
      .filter((entry) => {
        const index = entry.path.lastIndexOf('/')
        const directory = index > 0 ? entry.path.slice(0, index) : ''
        return directory === parent
      })
      .map((entry) => entry.path.slice(entry.path.lastIndexOf('/') + 1).toLocaleLowerCase()),
  )

  for (const file of files) {
    const nameProblem = validateEntryName(file.name)
    if (nameProblem) {
      skipped.push({ name: file.name, reason: nameProblem })
      continue
    }

    if (taken.has(file.name.toLocaleLowerCase())) {
      skipped.push({
        name: file.name,
        reason: 'A file or folder with this name already exists in that folder.',
      })
      continue
    }

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      skipped.push({
        name: file.name,
        reason: `Larger than the ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MiB browser-copy limit.`,
      })
      continue
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (isProbablyBinary(bytes)) {
        skipped.push({ name: file.name, reason: 'Binary file. The editor stores text only.' })
        continue
      }

      const path = storedPath(parent, file.name)
      await createStoredEntry(projectId, parent, file.name, 'file')
      await writeStoredContent(projectId, path, new TextDecoder('utf-8').decode(bytes))
      stored.push(path)
      taken.add(file.name.toLocaleLowerCase())
    } catch (cause) {
      skipped.push({
        name: file.name,
        reason: cause instanceof Error ? cause.message : 'The file could not be stored.',
      })
    }
  }

  return { stored, skipped }
}

/**
 * Collects the saved contents of every file for archive export. Stored copies
 * win; linked-folder reads fill the gaps when permission allows. Nothing is
 * invented for unavailable files.
 */
export async function collectProjectFiles(project: ProjectRecord): Promise<ProjectFileBundle> {
  const entries = (await listStoredEntries(project.id)).filter((entry) => entry.kind === 'file')
  const rows = await db.contents.where('projectId').equals(project.id).toArray()
  const storedByPath = new Map(rows.map((row) => [row.path, row.content]))

  const root = project.directoryHandle
  let readGranted = false
  let readReason = 'This project has no linked device folder, so only stored copies were exported.'

  if (root) {
    const permission = await ensureHandlePermission(root, 'read', true)
    readGranted = permission.status === 'granted'
    if (!readGranted) {
      readReason =
        permission.reason ??
        'Read permission for the linked folder was not granted, so only stored copies were exported.'
    }
  }

  const files: { path: string; content: string }[] = []
  const unavailable: { path: string; reason: string }[] = []
  let storedCount = 0
  let diskCount = 0

  for (const entry of entries) {
    if (storedByPath.has(entry.path)) {
      files.push({ path: entry.path, content: storedByPath.get(entry.path) ?? '' })
      storedCount += 1
      continue
    }

    if (!root || !readGranted) {
      unavailable.push({ path: entry.path, reason: readReason })
      continue
    }

    const result = await readTextFromDirectory(root, entry.path)
    if (result.status === 'ready') {
      if (isProbablyBinary(new TextEncoder().encode(result.content))) {
        unavailable.push({
          path: entry.path,
          reason: 'Binary file. Archives include text files only.',
        })
        continue
      }
      files.push({ path: entry.path, content: result.content })
      diskCount += 1
    } else {
      unavailable.push({ path: entry.path, reason: result.reason })
    }
  }

  return { files, unavailable, storedCount, diskCount }
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

  void logActivity({
    type: 'file:create',
    description: `Created ${kind} ${path}`,
    projectId,
    target: path,
    status: 'success',
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

  void logActivity({
    type: 'file:rename',
    description: `Renamed ${oldPath} to ${name}`,
    projectId,
    target: newPath,
    status: 'success',
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

    void logActivity({
      type: 'file:delete',
      description: `Deleted ${path} (${removed.length} item${removed.length === 1 ? '' : 's'})`,
      projectId,
      target: path,
      status: 'success',
    })

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
