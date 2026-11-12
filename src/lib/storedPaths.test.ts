import { describe, expect, it } from 'vitest'

import {
  StoredPathError,
  normalizeStoredPath,
  storedPath,
  validateEntryName,
  validateStoredPath,
} from './storedPaths'

describe('validateStoredPath', () => {
  it('accepts ordinary project-relative paths', () => {
    expect(validateStoredPath('src/main.py')).toBeNull()
    expect(validateStoredPath('README.md')).toBeNull()
    expect(validateStoredPath('a/b/c/d.ts')).toBeNull()
  })

  it('normalizes backslashes only after validating each segment', () => {
    expect(validateStoredPath('src\\main.py')).toBeNull()
    expect(normalizeStoredPath('src\\main.py')).toBe('src/main.py')
  })

  it('rejects traversal segments anywhere in the path', () => {
    expect(validateStoredPath('../secret.txt')).toMatch(/cannot contain/)
    expect(validateStoredPath('src/../../secret.txt')).toMatch(/cannot contain/)
    expect(validateStoredPath('..\\..\\secret.txt')).toMatch(/cannot contain/)
  })

  it('rejects absolute and drive-qualified paths', () => {
    expect(validateStoredPath('/etc/passwd')).toMatch(/Absolute paths/)
    expect(validateStoredPath('\\server\\share\\file.txt')).toMatch(/Absolute paths/)
    expect(validateStoredPath('C:\\Windows\\win.ini')).toMatch(/Absolute paths/)
  })

  it('rejects empty paths and empty segments', () => {
    expect(validateStoredPath('')).toMatch(/cannot be empty/)
    expect(validateStoredPath('   ')).toMatch(/cannot be empty/)
    expect(validateStoredPath('src//main.py')).toMatch(/empty/)
  })

  it('rejects control characters and reserved names', () => {
    expect(validateStoredPath('src/ma\u0000in.py')).toMatch(/control/)
    expect(validateStoredPath('con.txt')).toMatch(/reserved/)
  })
})

describe('validateEntryName', () => {
  it('rejects separators, dot names and trailing dots', () => {
    expect(validateEntryName('a/b')).toMatch(/cannot contain/)
    expect(validateEntryName('a\\b')).toMatch(/cannot contain/)
    expect(validateEntryName('.')).toMatch(/not allowed/)
    expect(validateEntryName('..')).toMatch(/not allowed/)
    expect(validateEntryName('name.')).toMatch(/cannot end/)
    expect(validateEntryName('name ')).toBeNull()
  })

  it('rejects empty and oversized names', () => {
    expect(validateEntryName('')).toMatch(/Enter a name/)
    expect(validateEntryName('x'.repeat(121))).toMatch(/120/)
  })

  it('accepts normal file names', () => {
    expect(validateEntryName('main.py')).toBeNull()
    expect(validateEntryName('my component.tsx')).toBeNull()
  })
})

describe('storedPath', () => {
  it('joins a parent and a name', () => {
    expect(storedPath('src/lib', 'util.ts')).toBe('src/lib/util.ts')
    expect(storedPath('', 'main.py')).toBe('main.py')
  })

  it('throws on traversal in the parent', () => {
    expect(() => storedPath('../outside', 'file.txt')).toThrow(StoredPathError)
  })

  it('throws on a name with a separator', () => {
    expect(() => storedPath('src', '../escape.txt')).toThrow(StoredPathError)
  })
})
