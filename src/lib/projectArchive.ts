/**
 * Project archive (ZIP) writer and reader.
 *
 * The writer produces a plain, uncompressed ZIP that any extractor can open.
 * The reader accepts stored and deflated entries, rejects traversal, enforces
 * byte/entry caps and verifies every CRC before a file is imported. Honest
 * per-file skip reasons are returned instead of silently dropping data.
 *
 * Metadata lives in `codepilot.project.json` at the archive root. It is never
 * imported as a project file.
 */

import { normalizeStoredPath, validateStoredPath } from './storedPaths'

export const ARCHIVE_METADATA_PATH = 'codepilot.project.json'
export const MAX_ARCHIVE_ENTRIES = 4000
export const MAX_ARCHIVE_FILE_BYTES = 8 * 1024 * 1024
export const MAX_ARCHIVE_TOTAL_BYTES = 64 * 1024 * 1024

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_SIGNATURE = 0x06054b50
const UTF8_FLAG = 0x0800
const DOS_TIME = 0
const DOS_DATE = 0x0021 // 1980-01-01

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveError'
  }
}

export type ArchiveMeta = {
  name?: string
  description?: string
  language?: string
  source?: string
  createdAt?: number
  modifiedAt?: number
}

export type ArchiveFile = {
  path: string
  content: string
}

export type ArchiveSkipped = {
  path: string
  reason: string
}

export type ProjectArchiveInput = {
  name: string
  description: string
  language: string
  source: string
  files: ArchiveFile[]
}

export type ProjectArchiveResult = {
  bytes: Uint8Array
  /** Files the writer refused to include, with the real reason. */
  skipped: ArchiveSkipped[]
}

export type ArchiveReadResult = {
  meta: ArchiveMeta
  /** Non-null when the metadata entry existed but was unreadable. */
  metaProblem: string | null
  files: ArchiveFile[]
  skipped: ArchiveSkipped[]
  totalBytes: number
  truncated: boolean
}

type ZipInput = {
  path: string
  bytes: Uint8Array
}

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) {
    return crcTable
  }

  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  crcTable = table
  return table
}

export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value & 0xffff, true)
  return bytes
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
  return bytes
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') {
    return null
  }

  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ArchiveError(
      'This browser cannot decompress the archive. Re-export it without compression or use a Chromium-based browser.',
    )
  }

  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Builds a ZIP from raw entries. `compress` asks for deflate-raw when the
 * browser supports it; otherwise entries stay stored. Invalid or duplicate
 * paths are the caller's responsibility here.
 */
export async function createZip(
  entries: ZipInput[],
  options: { compress?: boolean } = {},
): Promise<Uint8Array> {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  const encoder = new TextEncoder()
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    let method = 0
    const data = entry.bytes
    let compressed = entry.bytes

    if (options.compress) {
      const deflated = await deflateRaw(entry.bytes)
      if (deflated) {
        method = 8
        compressed = deflated
      }
    }

    const checksum = crc32(data)
    const localHeader = concat([
      u32(LOCAL_HEADER_SIGNATURE),
      u16(20),
      u16(UTF8_FLAG),
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(checksum),
      u32(compressed.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ])

    localParts.push(localHeader, compressed)

    centralParts.push(
      concat([
        u32(CENTRAL_HEADER_SIGNATURE),
        u16(20),
        u16(20),
        u16(UTF8_FLAG),
        u16(method),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(checksum),
        u32(compressed.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    )

    offset += localHeader.length + compressed.length
  }

  const centralDirectory = concat(centralParts)
  const localData = concat(localParts)
  const end = concat([
    u32(END_OF_CENTRAL_SIGNATURE),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(localData.length),
    u16(0),
  ])

  return concat([localData, centralDirectory, end])
}

/** Validates and serializes a project into a ZIP archive. */
export async function createProjectArchive(
  input: ProjectArchiveInput,
  options: { compress?: boolean } = {},
): Promise<ProjectArchiveResult> {
  const skipped: ArchiveSkipped[] = []
  const entries: ZipInput[] = []
  const encoder = new TextEncoder()
  const seen = new Set<string>()

  const meta: ArchiveMeta = {
    name: input.name,
    description: input.description,
    language: input.language,
    source: input.source,
  }
  const metaBytes = encoder.encode(JSON.stringify(meta, null, 2))
  entries.push({ path: ARCHIVE_METADATA_PATH, bytes: metaBytes })
  seen.add(ARCHIVE_METADATA_PATH)

  const sorted = [...input.files].sort((left, right) => left.path.localeCompare(right.path))
  for (const file of sorted) {
    const problem = validateStoredPath(file.path)
    if (problem) {
      skipped.push({ path: file.path, reason: problem })
      continue
    }

    const path = normalizeStoredPath(file.path)
    if (seen.has(path)) {
      skipped.push({ path, reason: 'A duplicate path was already included in the archive.' })
      continue
    }
    if (path === ARCHIVE_METADATA_PATH) {
      skipped.push({
        path,
        reason: 'This name is reserved for the archive metadata file.',
      })
      continue
    }

    seen.add(path)
    entries.push({ path, bytes: encoder.encode(file.content) })
  }

  const bytes = await createZip(entries, options)
  return { bytes, skipped }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 22 - 0xffff)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  for (let index = bytes.length - 22; index >= minimum; index -= 1) {
    if (view.getUint32(index, true) === END_OF_CENTRAL_SIGNATURE) {
      return index
    }
  }

  return -1
}

function decodeName(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function findNulByte(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length, 8192)
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return index
    }
  }
  return -1
}

function parseMeta(bytes: Uint8Array): { meta: ArchiveMeta; problem: string | null } {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes))
  } catch {
    return {
      meta: {},
      problem: `“${ARCHIVE_METADATA_PATH}” was not valid JSON. The archive was read without metadata.`,
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      meta: {},
      problem: `“${ARCHIVE_METADATA_PATH}” was not a JSON object. The archive was read without metadata.`,
    }
  }

  const source = parsed as Record<string, unknown>
  const meta: ArchiveMeta = {}
  let problem: string | null = null

  for (const key of ['name', 'description', 'language', 'source'] as const) {
    const value = source[key]
    if (typeof value === 'string') {
      meta[key] = value
    } else if (value !== undefined) {
      problem = `Metadata field “${key}” was not text and was ignored.`
    }
  }

  for (const key of ['createdAt', 'modifiedAt'] as const) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      meta[key] = value
    }
  }

  return { meta, problem }
}

/**
 * Reads a project archive. Structural damage throws `ArchiveError`; per-file
 * damage, unsafe paths, binaries and cap overruns are returned in `skipped`.
 */
export async function readProjectArchive(bytes: Uint8Array): Promise<ArchiveReadResult> {
  if (bytes.length < 22) {
    throw new ArchiveError('The selected file is too small to be a ZIP archive.')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const endOffset = findEndOfCentralDirectory(bytes)
  if (endOffset === -1) {
    throw new ArchiveError('No ZIP end-of-central-directory record was found in this file.')
  }

  const diskNumber = view.getUint16(endOffset + 4, true)
  const centralDisk = view.getUint16(endOffset + 6, true)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralSize = view.getUint32(endOffset + 12, true)
  const centralOffset = view.getUint32(endOffset + 16, true)

  if (diskNumber !== 0 || centralDisk !== 0) {
    throw new ArchiveError('Multi-volume ZIP archives are not supported.')
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ArchiveError('ZIP64 archives are not supported in this build.')
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new ArchiveError(
      `This archive contains ${entryCount} entries. The import limit is ${MAX_ARCHIVE_ENTRIES}.`,
    )
  }
  if (centralOffset + centralSize > bytes.length) {
    throw new ArchiveError('The ZIP central directory points outside the file.')
  }

  const skipped: ArchiveSkipped[] = []
  const files: ArchiveFile[] = []
  let meta: ArchiveMeta = {}
  let metaProblem: string | null = null
  let totalBytes = 0
  let truncated = false

  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ArchiveError('The ZIP central directory is damaged or truncated.')
    }

    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const checksum = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)

    if (flags & 0x0001) {
      throw new ArchiveError('Encrypted ZIP archives are not supported.')
    }

    const nameStart = cursor + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > bytes.length) {
      throw new ArchiveError('The ZIP central directory has a malformed entry name.')
    }

    const rawName = decodeName(bytes.subarray(nameStart, nameEnd))
    cursor = nameEnd + extraLength + commentLength

    if (rawName.endsWith('/')) {
      continue
    }

    if (rawName === ARCHIVE_METADATA_PATH) {
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_HEADER_SIGNATURE) {
        metaProblem = 'The archive metadata entry had a damaged local header.'
        continue
      }

      const localNameLength = view.getUint16(localOffset + 26, true)
      const localExtraLength = view.getUint16(localOffset + 28, true)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const dataEnd = dataStart + compressedSize
      if (dataEnd > bytes.length) {
        metaProblem = 'The archive metadata entry points outside the file.'
        continue
      }

      try {
        const data =
          method === 0
            ? bytes.subarray(dataStart, dataEnd)
            : method === 8
              ? await inflateRaw(bytes.subarray(dataStart, dataEnd))
              : null

        if (!data) {
          metaProblem = `The archive metadata uses unsupported compression method ${method}.`
        } else if (crc32(data) !== checksum) {
          metaProblem = 'The archive metadata failed its CRC check.'
        } else {
          const parsed = parseMeta(data)
          meta = parsed.meta
          metaProblem = parsed.problem
        }
      } catch (cause) {
        metaProblem =
          cause instanceof Error && cause.message
            ? cause.message
            : 'The archive metadata could not be decompressed.'
      }
      continue
    }

    const normalized = normalizeStoredPath(rawName)
    const problem = validateStoredPath(normalized)
    if (problem) {
      skipped.push({ path: rawName, reason: problem })
      continue
    }

    if (normalized.startsWith('__MACOSX/') || normalized.endsWith('.DS_Store')) {
      skipped.push({ path: normalized, reason: 'Operating-system metadata, not a project file.' })
      continue
    }

    if (uncompressedSize > MAX_ARCHIVE_FILE_BYTES) {
      skipped.push({
        path: normalized,
        reason: `Larger than the ${Math.ceil(MAX_ARCHIVE_FILE_BYTES / (1024 * 1024))} MiB per-file import limit.`,
      })
      continue
    }

    if (totalBytes + uncompressedSize > MAX_ARCHIVE_TOTAL_BYTES) {
      truncated = true
      skipped.push({
        path: normalized,
        reason: `The archive exceeded the ${Math.ceil(MAX_ARCHIVE_TOTAL_BYTES / (1024 * 1024))} MiB total import limit.`,
      })
      continue
    }

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_HEADER_SIGNATURE) {
      skipped.push({ path: normalized, reason: 'The local ZIP header is damaged.' })
      continue
    }

    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) {
      skipped.push({ path: normalized, reason: 'The entry data points outside the archive.' })
      continue
    }

    let data: Uint8Array
    try {
      if (method === 0) {
        data = bytes.subarray(dataStart, dataEnd)
      } else if (method === 8) {
        data = await inflateRaw(bytes.subarray(dataStart, dataEnd))
      } else {
        skipped.push({
          path: normalized,
          reason: `Compression method ${method} is not supported. Re-export with deflate or store.`,
        })
        continue
      }
    } catch (cause) {
      skipped.push({
        path: normalized,
        reason:
          cause instanceof Error && cause.message
            ? cause.message
            : 'The entry could not be decompressed.',
      })
      continue
    }

    if (data.length !== uncompressedSize) {
      skipped.push({
        path: normalized,
        reason: `The entry declared ${uncompressedSize} bytes but produced ${data.length}.`,
      })
      continue
    }

    if (crc32(data) !== checksum) {
      skipped.push({ path: normalized, reason: 'The entry failed its CRC check and was not imported.' })
      continue
    }

    if (findNulByte(data) !== -1) {
      skipped.push({
        path: normalized,
        reason: 'Binary file (contains a NUL byte). Only text files are imported into the editor.',
      })
      continue
    }

    files.push({ path: normalized, content: new TextDecoder('utf-8').decode(data) })
    totalBytes += data.length
  }

  return { meta, metaProblem, files, skipped, totalBytes, truncated }
}

/** Suggests a safe download name from a project record name. */
export function archiveFileName(projectName: string): string {
  let withoutControls = ''
  for (const character of projectName.trim()) {
    withoutControls += character.charCodeAt(0) < 32 ? '-' : character
  }

  const cleaned = withoutControls
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return `${cleaned || 'codepilot-project'}.zip`
}
