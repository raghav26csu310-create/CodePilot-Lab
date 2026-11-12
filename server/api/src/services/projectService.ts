import type { Store } from '../db/store.ts'
import type { ProjectFileRecord, ProjectRecord } from '../db/types.ts'
import { badRequest, notFound } from '../http/errors.ts'
import { newId } from '../security/ids.ts'

const LANGUAGES = new Set([
  'python',
  'javascript',
  'typescript',
  'c',
  'cpp',
  'java',
  'html',
  'css',
  'json',
])

const MAX_FILE_CHARS = 1_000_000

export type CreateProjectInput = {
  name: string
  description?: string
  language?: string
}

export type UpdateProjectInput = {
  name?: string
  description?: string
  language?: string
  archived?: boolean
}

export type PutFileInput = {
  path: string
  kind?: 'file' | 'folder'
  content?: string
}

/**
 * User-scoped project service. It never queries by project id alone: the store
 * method always receives the authenticated user id, so a guessed project id
 * resolves to `notFound` rather than another user's data.
 */
export class ProjectService {
  private readonly store: Store
  private readonly now: () => number

  constructor(store: Store, now: () => number = Date.now) {
    this.store = store
    this.now = now
  }

  list(userId: string): Promise<ProjectRecord[]> {
    return this.store.listProjects(userId)
  }

  async create(userId: string, input: CreateProjectInput): Promise<ProjectRecord> {
    const name = input.name.trim()
    if (name.length === 0 || name.length > 120) {
      throw badRequest('Project name must be between 1 and 120 characters.')
    }
    const description = (input.description ?? '').trim()
    if (description.length > 2_000) {
      throw badRequest('Project description is longer than 2000 characters.')
    }
    const language = input.language ?? 'python'
    if (!LANGUAGES.has(language)) {
      throw badRequest('That project language is not supported.')
    }
    return this.store.createProject(userId, {
      id: newId(),
      name,
      description,
      language,
      createdAt: this.now(),
    })
  }

  async get(userId: string, projectId: string): Promise<ProjectRecord> {
    const project = await this.store.getProject(userId, projectId)
    if (!project) throw notFound('That project does not exist for this account.')
    return project
  }

  async update(
    userId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectRecord> {
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (name.length === 0 || name.length > 120) {
        throw badRequest('Project name must be between 1 and 120 characters.')
      }
    }
    if (input.description !== undefined && input.description.length > 2_000) {
      throw badRequest('Project description is longer than 2000 characters.')
    }
    if (input.language !== undefined && !LANGUAGES.has(input.language)) {
      throw badRequest('That project language is not supported.')
    }
    const updated = await this.store.updateProject(userId, projectId, input)
    if (!updated) throw notFound('That project does not exist for this account.')
    return updated
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const removed = await this.store.deleteProject(userId, projectId)
    if (!removed) throw notFound('That project does not exist for this account.')
  }

  async listFiles(userId: string, projectId: string): Promise<ProjectFileRecord[]> {
    const files = await this.store.listProjectFiles(userId, projectId)
    if (!files) throw notFound('That project does not exist for this account.')
    return files
  }

  async putFile(
    userId: string,
    projectId: string,
    input: PutFileInput,
  ): Promise<ProjectFileRecord> {
    const path = normalizeRelativePath(input.path)
    const content = input.content ?? ''
    if (content.length > MAX_FILE_CHARS) {
      throw badRequest(`File content exceeds the ${MAX_FILE_CHARS}-character API limit.`)
    }
    const file = await this.store.putProjectFile(userId, projectId, {
      id: newId(),
      path,
      kind: input.kind ?? 'file',
      content,
      updatedAt: this.now(),
    })
    if (!file) throw notFound('That project does not exist for this account.')
    return file
  }

  async deleteFile(userId: string, projectId: string, fileId: string): Promise<void> {
    const removed = await this.store.deleteProjectFile(userId, projectId, fileId)
    if (!removed) throw notFound('That file does not exist in this project.')
  }
}

/** Rejects absolute, traversing and control-character paths. */
export function normalizeRelativePath(raw: string): string {
  const path = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim()
  if (!path || path.length > 400) {
    throw badRequest('Enter a relative file path shorter than 400 characters.')
  }
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw badRequest('File paths must be relative to the project root.')
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw badRequest('File paths cannot contain empty, "." or ".." segments.')
  }
  if (hasControlCharacter(path)) {
    throw badRequest('File paths cannot contain control characters.')
  }
  return path
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) {
      return true
    }
  }
  return false
}
