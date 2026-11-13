import { describe, expect, it } from 'vitest'

import {
  ARCHIVE_METADATA_PATH,
  ArchiveError,
  archiveFileName,
  createProjectArchive,
  createZip,
  crc32,
  readProjectArchive,
} from './projectArchive'

const encoder = new TextEncoder()

async function zipOf(entries: { path: string; content: string }[], compress = false) {
  return new Uint8Array(
    await createZip(
      entries.map((entry) => ({ path: entry.path, bytes: encoder.encode(entry.content) })),
      { compress },
    ),
  )
}

describe('crc32', () => {
  it('matches the known CRC-32 of “123456789”', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('project archive round trip', () => {
  it('writes and reads stored entries with metadata', async () => {
    const archive = await createProjectArchive({
      name: 'Demo',
      description: 'A real round trip',
      language: 'Python',
      source: 'imported',
      files: [
        { path: 'src/main.py', content: 'print("hello")\n' },
        { path: 'README.md', content: '# Demo\n' },
      ],
    })

    const read = await readProjectArchive(archive.bytes)
    expect(read.meta).toMatchObject({
      name: 'Demo',
      description: 'A real round trip',
      language: 'Python',
      source: 'imported',
    })
    expect(read.metaProblem).toBeNull()
    expect(read.skipped).toEqual([])
    expect(read.files.map((file) => file.path)).toEqual(['README.md', 'src/main.py'])
    expect(read.files.find((file) => file.path === 'src/main.py')?.content).toBe(
      'print("hello")\n',
    )
    expect(read.files.some((file) => file.path === ARCHIVE_METADATA_PATH)).toBe(false)
  })

  it('round-trips deflated entries when the runtime supports deflate-raw', async () => {
    const content = 'const value = 42\n'.repeat(200)
    const bytes = await zipOf([{ path: 'src/index.ts', content }], true)
    const read = await readProjectArchive(bytes)
    expect(read.skipped).toEqual([])
    expect(read.files).toHaveLength(1)
    expect(read.files[0]?.content).toBe(content)
  })

  it('refuses unsafe paths and duplicate names during write', async () => {
    const archive = await createProjectArchive({
      name: 'Unsafe',
      description: '',
      language: 'Unknown',
      source: 'created',
      files: [
        { path: '../escape.txt', content: 'nope' },
        { path: 'ok.txt', content: 'yes' },
        { path: 'ok.txt', content: 'again' },
      ],
    })

    expect(archive.skipped.map((entry) => entry.path)).toContain('../escape.txt')
    const read = await readProjectArchive(archive.bytes)
    expect(read.files.map((file) => file.path)).toEqual(['ok.txt'])
  })
})

describe('project archive validation', () => {
  it('rejects an entry whose CRC does not match', async () => {
    const content = 'the quick brown fox jumps over the lazy dog'
    const bytes = await zipOf([{ path: 'note.txt', content }])
    const dataIndex = bytes.findIndex((_byte, index) => {
      const probe = new TextDecoder().decode(bytes.subarray(index, index + content.length))
      return probe === content
    })
    expect(dataIndex).toBeGreaterThan(0)
    bytes[dataIndex] = bytes[dataIndex] === 0x74 ? 0x75 : 0x74

    const read = await readProjectArchive(bytes)
    expect(read.files).toEqual([])
    expect(read.skipped[0]?.path).toBe('note.txt')
    expect(read.skipped[0]?.reason).toMatch(/CRC/)
  })

  it('rejects traversal paths written by another tool', async () => {
    const bytes = await zipOf([{ path: '../../etc/passwd', content: 'root' }])
    const read = await readProjectArchive(bytes)
    expect(read.files).toEqual([])
    expect(read.skipped[0]?.reason).toMatch(/cannot contain/)
  })

  it('skips binary entries and reports why', async () => {
    const bytes = new Uint8Array(
      await createZip([
        { path: 'image.bin', bytes: new Uint8Array([1, 2, 0, 4]) },
        { path: 'text.txt', bytes: encoder.encode('plain') },
      ]),
    )

    const read = await readProjectArchive(bytes)
    expect(read.files.map((file) => file.path)).toEqual(['text.txt'])
    expect(read.skipped[0]?.path).toBe('image.bin')
    expect(read.skipped[0]?.reason).toMatch(/Binary/)
  })

  it('rejects a file that is not a ZIP', async () => {
    await expect(readProjectArchive(encoder.encode('not a zip at all'))).rejects.toBeInstanceOf(
      ArchiveError,
    )
  })
})

describe('archiveFileName', () => {
  it('removes path separators and keeps a .zip suffix', () => {
    expect(archiveFileName('My Project')).toBe('My Project.zip')
    expect(archiveFileName('a/b:c*?')).toBe('a-b-c--.zip')
    expect(archiveFileName('   ')).toBe('codepilot-project.zip')
  })
})
