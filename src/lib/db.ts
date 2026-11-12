import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie'

export type ProjectSource = 'created' | 'imported'

export type ProjectRecord = {
  id: string
  name: string
  description: string
  language: string
  source: ProjectSource
  createdAt: number
  /** Latest real file mtime for imports, or the last persisted workspace edit. */
  modifiedAt: number
  lastOpenedAt: number
  openCount: number
  fileCount: number
  sizeBytes: number
  /** Relative file paths, capped by the importer. Kept in sync with stored files. */
  manifest: string[]
  truncated: boolean
  excluded: string[]
  /** Present only when the File System Access API provided a handle. */
  directoryHandle?: FileSystemDirectoryHandle
}

export type NewProjectInput = {
  name: string
  description?: string
  language: string
  source: ProjectSource
  modifiedAt?: number
  fileCount?: number
  sizeBytes?: number
  manifest?: string[]
  truncated?: boolean
  excluded?: string[]
  directoryHandle?: FileSystemDirectoryHandle
}

export type StoredEntryKind = 'file' | 'folder'

/**
 * Version 2 tree record. The entry table is the source of truth for the
 * workspace tree; `manifest` on the project remains for import metadata and
 * dossier compatibility.
 */
export type StoredEntry = {
  projectId: string
  path: string
  kind: StoredEntryKind
  /** Bytes persisted in IndexedDB for this path. Zero when content is not stored. */
  sizeBytes: number
  createdAt: number
  updatedAt: number
}

/** File contents are separate from tree metadata so large files load on demand. */
export type StoredContent = {
  projectId: string
  path: string
  content: string
  updatedAt: number
}

export type StoredSetting = {
  key: string
  value: string
  updatedAt: number
}

/** A completed AI conversion, persisted for the converter history. */
export type ConversionRecord = {
  id: string
  projectId: string | null
  sourceLanguage: string
  targetLanguage: string
  sourceCode: string
  convertedCode: string
  instructions: string
  status: 'complete' | 'partial' | 'failed'
  notes: string
  warnings: string[]
  providerLabel: string
  model: string
  createdAt: number
  durationMs: number
}

/** Per-problem practice state. Drafts are kept per executable language. */
export type PracticeProgress = {
  problemId: string
  attempted: number
  solved: boolean
  solvedAt: number | null
  lastAttemptAt: number
  lastLanguage: string
  bookmarked: boolean
  notes: string
  codeByLanguage: Record<string, string>
}

export type PracticeSubmission = {
  id: string
  problemId: string
  language: string
  verdict: string
  passed: number
  total: number
  hiddenCases: number
  durationMs: number
  createdAt: number
}

export type FeedbackCategory = 'general' | 'bug' | 'feature'

export type FeedbackDelivery = 'local' | 'endpoint' | 'endpoint-failed'

/**
 * Feedback is always written to IndexedDB first. `delivery` records whether the
 * optional configured endpoint also accepted it, so the UI can be honest.
 */
export type FeedbackRecord = {
  id: string
  category: FeedbackCategory
  rating: number | null
  feature: string
  message: string
  contact: string
  page: string
  appVersion: string
  createdAt: number
  delivery: FeedbackDelivery
  endpointStatus: number | null
  endpointError: string | null
}

export type StorageSnapshot = {
  indexedDB: boolean
  estimate: boolean
  persisted: boolean | null
  usage: number | null
  quota: number | null
}

const database = new Dexie('codepilot-lab') as Dexie & {
  projects: EntityTable<ProjectRecord, 'id'>
  files: Table<StoredEntry, [string, string]>
  contents: Table<StoredContent, [string, string]>
  settings: EntityTable<StoredSetting, 'key'>
  conversions: EntityTable<ConversionRecord, 'id'>
  practiceProgress: EntityTable<PracticeProgress, 'problemId'>
  practiceSubmissions: EntityTable<PracticeSubmission, 'id'>
  feedback: EntityTable<FeedbackRecord, 'id'>
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function nameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizeManifestPaths(paths: string[], projectName: string): string[] {
  const cleaned = [...new Set(paths.map(normalizePath).filter(Boolean))]

  if (cleaned.length === 0) {
    return []
  }

  const firstSegments = new Set(cleaned.map((path) => path.split('/')[0] ?? ''))
  if (firstSegments.size === 1) {
    const only = [...firstSegments][0]
    if (only && !only.includes('/')) {
      const projectKey = nameKey(projectName)
      if (projectKey.length > 0 && nameKey(only) === projectKey) {
        const stripped = cleaned
          .map((path) => path.slice(only.length + 1))
          .filter((path) => path.length > 0)

        if (stripped.length === cleaned.length) {
          return stripped
        }
      }
    }
  }

  return cleaned
}

function entriesFromManifest(project: ProjectRecord): StoredEntry[] {
  const kinds = new Map<string, StoredEntryKind>()
  const paths = normalizeManifestPaths(project.manifest, project.name)

  for (const path of paths) {
    const segments = path.split('/').filter(Boolean)
    for (let index = 1; index < segments.length; index += 1) {
      const folderPath = segments.slice(0, index).join('/')
      if (!kinds.has(folderPath)) {
        kinds.set(folderPath, 'folder')
      }
    }
    kinds.set(path, 'file')
  }

  return [...kinds].map(([path, kind]) => ({
    projectId: project.id,
    path,
    kind,
    sizeBytes: 0,
    createdAt: project.createdAt,
    updatedAt: project.modifiedAt,
  }))
}

database.version(1).stores({
  projects: 'id, name, lastOpenedAt',
})

database.version(2)
  .stores({
    projects: 'id, name, lastOpenedAt',
    files: '[projectId+path], projectId, kind, updatedAt',
    contents: '[projectId+path], projectId, updatedAt',
    settings: 'key',
  })
  .upgrade(async (tx: Transaction) => {
    // Backfill tree metadata for projects introduced before the editor existed.
    // No content is fabricated: manifest-only imports keep content unavailable
    // until their folder handle can provide the real bytes.
    const projects = await tx.table<ProjectRecord>('projects').toArray()
    const files = tx.table<StoredEntry>('files')
    const rows: StoredEntry[] = []

    for (const project of projects) {
      rows.push(...entriesFromManifest(project))
    }

    if (rows.length > 0) {
      await files.bulkPut(rows)
    }
  })

database.version(3).stores({
  projects: 'id, name, lastOpenedAt',
  files: '[projectId+path], projectId, kind, updatedAt',
  contents: '[projectId+path], projectId, updatedAt',
  settings: 'key',
  conversions: 'id, projectId, createdAt',
  practiceProgress: 'problemId, solved, lastAttemptAt',
  practiceSubmissions: 'id, problemId, createdAt',
})

database.version(4).stores({
  feedback: 'id, createdAt, category',
})

export const db = database

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export async function findProjectByName(name: string): Promise<ProjectRecord | undefined> {
  const normalized = name.trim().toLocaleLowerCase()
  return db.projects.filter((project) => project.name.trim().toLocaleLowerCase() === normalized).first()
}

export async function createProjectRecord(input: NewProjectInput): Promise<ProjectRecord> {
  const now = Date.now()
  const record: ProjectRecord = {
    id: createId(),
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    language: input.language,
    source: input.source,
    createdAt: now,
    modifiedAt: input.modifiedAt ?? now,
    lastOpenedAt: now,
    openCount: 0,
    fileCount: input.fileCount ?? 0,
    sizeBytes: input.sizeBytes ?? 0,
    manifest: input.manifest ?? [],
    truncated: input.truncated ?? false,
    excluded: input.excluded ?? [],
    directoryHandle: input.directoryHandle,
  }

  await db.transaction('rw', db.projects, db.files, async () => {
    await db.projects.add(record)

    const entries = entriesFromManifest(record)
    if (entries.length > 0) {
      await db.files.bulkPut(entries)
    }
  })

  return record
}

/**
 * Safety net for records created between schema versions: backfill their tree
 * metadata from the stored manifest without touching existing entries.
 */
export async function ensureProjectEntries(project: ProjectRecord): Promise<void> {
  const count = await db.files.where('projectId').equals(project.id).count()
  if (count > 0 || project.manifest.length === 0) {
    return
  }

  const entries = entriesFromManifest(project)
  if (entries.length > 0) {
    await db.files.bulkPut(entries)
  }
}

export async function listRecentProjects(limit = 6): Promise<ProjectRecord[]> {
  return db.projects.orderBy('lastOpenedAt').reverse().limit(limit).toArray()
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return db.projects.orderBy('lastOpenedAt').reverse().toArray()
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return db.projects.get(id)
}

export async function touchProject(id: string): Promise<ProjectRecord | undefined> {
  return db.transaction('rw', db.projects, async () => {
    const current = await db.projects.get(id)
    if (!current) {
      return undefined
    }

    const updated: ProjectRecord = {
      ...current,
      lastOpenedAt: Date.now(),
      openCount: current.openCount + 1,
    }
    await db.projects.put(updated)
    return updated
  })
}

export async function renameProjectRecord(
  id: string,
  name: string,
): Promise<ProjectRecord | undefined> {
  return db.transaction('rw', db.projects, async () => {
    const current = await db.projects.get(id)
    if (!current) {
      return undefined
    }

    const updated: ProjectRecord = {
      ...current,
      name: name.trim(),
      modifiedAt: Date.now(),
    }
    await db.projects.put(updated)
    return updated
  })
}

/** Removes the project, its tree entries, stored contents and conversions. */
export async function deleteProjectCascade(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.projects,
    db.files,
    db.contents,
    db.conversions,
    async () => {
      await db.files.where('projectId').equals(id).delete()
      await db.contents.where('projectId').equals(id).delete()
      await db.conversions.where('projectId').equals(id).delete()
      await db.projects.delete(id)
    },
  )
}

export async function probeStorage(): Promise<StorageSnapshot> {
  const indexedDB = typeof window !== 'undefined' && 'indexedDB' in window
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined

  let persisted: boolean | null = null
  let usage: number | null = null
  let quota: number | null = null
  let estimate = false

  if (storage && typeof storage.persisted === 'function') {
    try {
      persisted = await storage.persisted()
    } catch {
      persisted = null
    }
  }

  if (storage && typeof storage.estimate === 'function') {
    try {
      const result = await storage.estimate()
      usage = typeof result.usage === 'number' ? result.usage : null
      quota = typeof result.quota === 'number' ? result.quota : null
      estimate = usage !== null
    } catch {
      estimate = false
    }
  }

  return { indexedDB, estimate, persisted, usage, quota }
}
