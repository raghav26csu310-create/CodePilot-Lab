/**
 * Canonical rules for every path the browser persists into IndexedDB.
 *
 * Stored paths are project-relative POSIX paths. They never leave the database
 * on their own, but they are still untrusted input: an AI proposal, a pasted
 * conversion target or a renamed tree node can contain traversal segments or
 * host-absolute paths. Validate once here and let every storage writer reuse it.
 */

const INVALID_NAME_CHARS = /[<>:"/\\|?*]/
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const WINDOWS_DRIVE = /^[a-z]:/i

export class StoredPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoredPathError'
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) {
      return true
    }
  }
  return false
}

/** Normalizes separators and removes leading/trailing decorative slashes. */
export function normalizeStoredPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/** Validates a single file or folder name (no separators allowed). */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim()

  if (!trimmed) {
    return 'Enter a name.'
  }

  if (trimmed.length > 120) {
    return 'Keep the name under 120 characters.'
  }

  if (trimmed === '.' || trimmed === '..') {
    return 'This name is not allowed.'
  }

  if (INVALID_NAME_CHARS.test(trimmed) || hasControlCharacter(trimmed)) {
    return 'Names cannot contain < > : " / \\ | ? * or control characters.'
  }

  if (/[. ]$/.test(trimmed)) {
    return 'Names cannot end with a dot or a space.'
  }

  if (RESERVED_WINDOWS_NAMES.test(trimmed)) {
    return 'This name is reserved by Windows.'
  }

  return null
}

/**
 * Validates a complete project-relative path. Returns a readable problem or
 * null when the path is safe to persist.
 */
export function validateStoredPath(path: string): string | null {
  const raw = path.trim()

  if (!raw) {
    return 'A file path cannot be empty.'
  }

  if (hasControlCharacter(raw)) {
    return 'File paths cannot contain control characters.'
  }

  if (raw.startsWith('/') || raw.startsWith('\\') || WINDOWS_DRIVE.test(raw)) {
    return 'File paths must stay inside the project. Absolute paths are not allowed.'
  }

  const segments = raw.replace(/\\/g, '/').split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'File paths cannot contain empty, "." or ".." segments.'
  }

  for (const segment of segments) {
    const problem = validateEntryName(segment)
    if (problem) {
      return `“${segment}”: ${problem}`
    }
  }

  return null
}

/** Validated, normalized path. Throws `StoredPathError` on invalid input. */
export function assertStoredPath(path: string): string {
  const problem = validateStoredPath(path)
  if (problem) {
    throw new StoredPathError(problem)
  }
  return normalizeStoredPath(path)
}

/** Joins a validated parent path and a validated name. */
export function storedPath(parentPath: string, name: string): string {
  const trimmed = name.trim()
  const nameProblem = validateEntryName(trimmed)
  if (nameProblem) {
    throw new StoredPathError(nameProblem)
  }

  const parent = parentPath.trim()
  if (!parent) {
    return trimmed
  }

  return `${assertStoredPath(parent)}/${trimmed}`
}
