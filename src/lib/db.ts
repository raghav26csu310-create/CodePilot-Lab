import Dexie, { type EntityTable } from 'dexie'

export type ProjectSource = 'created' | 'imported'

export type ProjectRecord = {
  id: string
  name: string
  description: string
  language: string
  source: ProjectSource
  createdAt: number
  /** Latest real file mtime for imports, or creation time for new records. */
  modifiedAt: number
  lastOpenedAt: number
  openCount: number
  fileCount: number
  sizeBytes: number
  /** Relative paths, capped by the importer. Empty for records without files. */
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

export type StorageSnapshot = {
  indexedDB: boolean
  estimate: boolean
  persisted: boolean | null
  usage: number | null
  quota: number | null
}

const database = new Dexie('codepilot-lab') as Dexie & {
  projects: EntityTable<ProjectRecord, 'id'>
}

database.version(1).stores({
  projects: 'id, name, lastOpenedAt',
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

  await db.projects.add(record)
  return record
}

export async function listRecentProjects(limit = 6): Promise<ProjectRecord[]> {
  return db.projects.orderBy('lastOpenedAt').reverse().limit(limit).toArray()
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
