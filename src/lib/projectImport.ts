export const MAX_IMPORT_FILES = 3000
export const MAX_IMPORT_DEPTH = 12

/**
 * Content capture is deliberately smaller than the manifest. A folder can be
 * large; the editor stores real text only when it fits these caps, and every
 * skipped file is reported rather than silently dropped.
 */
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_CONTENT_BYTES = 24 * 1024 * 1024

/**
 * Vendored or generated trees are excluded from the manifest. The scan reports
 * every excluded directory it actually encountered so the UI can disclose it.
 */
export const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
] as const

const EXCLUDED = new Set<string>(EXCLUDED_DIRECTORIES)

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  cs: 'C#',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  c: 'C',
  h: 'C',
  rb: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  dart: 'Dart',
  scala: 'Scala',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  ps1: 'PowerShell',
  sql: 'SQL',
  vue: 'Vue',
  svelte: 'Svelte',
  astro: 'Astro',
  lua: 'Lua',
  r: 'R',
  ex: 'Elixir',
  exs: 'Elixir',
  hs: 'Haskell',
  sol: 'Solidity',
  zig: 'Zig',
  tf: 'Terraform',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
}

export type ImportFileCandidate = {
  path: string
  file: File
}

export type ImportScan = {
  name: string
  manifest: string[]
  files: ImportFileCandidate[]
  fileCount: number
  sizeBytes: number
  modifiedAt: number
  language: string
  languageBreakdown: { language: string; files: number }[]
  excluded: string[]
  truncated: boolean
}

type ScanAccumulator = {
  manifest: string[]
  files: ImportFileCandidate[]
  fileCount: number
  sizeBytes: number
  modifiedAt: number
  languages: Map<string, number>
  excluded: Set<string>
  truncated: boolean
}

function createAccumulator(): ScanAccumulator {
  return {
    manifest: [],
    files: [],
    fileCount: 0,
    sizeBytes: 0,
    modifiedAt: 0,
    languages: new Map(),
    excluded: new Set(),
    truncated: false,
  }
}

export function extensionForFile(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function languageForFile(name: string): string | null {
  if (name.toLowerCase() === 'dockerfile') {
    return 'Docker'
  }

  return LANGUAGE_BY_EXTENSION[extensionForFile(name)] ?? null
}

function addFile(
  acc: ScanAccumulator,
  path: string,
  file: File,
  onProgress?: (count: number) => void,
) {
  if (acc.fileCount >= MAX_IMPORT_FILES) {
    acc.truncated = true
    return
  }

  acc.fileCount += 1
  acc.sizeBytes += file.size
  acc.modifiedAt = Math.max(acc.modifiedAt, file.lastModified)
  acc.manifest.push(path)
  acc.files.push({ path, file })

  const language = languageForFile(file.name)
  if (language) {
    acc.languages.set(language, (acc.languages.get(language) ?? 0) + 1)
  }

  onProgress?.(acc.fileCount)
}

function finalize(name: string, acc: ScanAccumulator): ImportScan {
  const breakdown = [...acc.languages.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([language, files]) => ({ language, files }))

  return {
    name,
    manifest: acc.manifest,
    files: acc.files,
    fileCount: acc.fileCount,
    sizeBytes: acc.sizeBytes,
    modifiedAt: acc.modifiedAt || Date.now(),
    language: breakdown[0]?.language ?? 'Unknown',
    languageBreakdown: breakdown,
    excluded: [...acc.excluded].sort((a, b) => a.localeCompare(b)),
    truncated: acc.truncated,
  }
}

async function walkDirectory(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  depth: number,
  acc: ScanAccumulator,
  onProgress?: (count: number) => void,
) {
  for await (const entry of directory.values()) {
    if (acc.truncated) {
      return
    }

    if (entry.kind === 'directory') {
      if (EXCLUDED.has(entry.name.toLowerCase())) {
        acc.excluded.add(entry.name)
        continue
      }

      if (depth >= MAX_IMPORT_DEPTH) {
        acc.truncated = true
        continue
      }

      await walkDirectory(entry, `${prefix}${entry.name}/`, depth + 1, acc, onProgress)
      continue
    }

    const file = await entry.getFile()
    addFile(acc, `${prefix}${entry.name}`, file, onProgress)
  }
}

export async function scanDirectory(
  directory: FileSystemDirectoryHandle,
  onProgress?: (count: number) => void,
): Promise<ImportScan> {
  const acc = createAccumulator()
  await walkDirectory(directory, '', 0, acc, onProgress)
  return finalize(directory.name, acc)
}

/**
 * Fallback for browsers without the directory picker. `webkitdirectory` keeps
 * the relative path on each File, so the manifest stays faithful. The selected
 * top-level folder is stripped from every path to match `scanDirectory`, which
 * always reports paths relative to the chosen folder.
 */
export function scanFileList(files: File[]): ImportScan {
  const acc = createAccumulator()
  let name = 'Imported project'

  for (const file of files) {
    const rawPath = file.webkitRelativePath || file.name
    const segments = rawPath.split('/').filter(Boolean)
    const isInsideChosenFolder = segments.length > 1

    if (isInsideChosenFolder && name === 'Imported project') {
      name = segments[0] ?? name
    }

    const relativeSegments = isInsideChosenFolder ? segments.slice(1) : segments
    const relativePath = relativeSegments.join('/')
    if (!relativePath) {
      continue
    }

    const directories = relativeSegments.slice(0, -1).map((segment) => segment.toLowerCase())
    const excluded = directories.find((directory) => EXCLUDED.has(directory))
    if (excluded) {
      acc.excluded.add(excluded)
      continue
    }

    if (directories.length > MAX_IMPORT_DEPTH) {
      acc.truncated = true
      continue
    }

    addFile(acc, relativePath, file)
  }

  return finalize(name, acc)
}

export type ContentCaptureEstimate = {
  /** Files that fit the per-file and total content budget. */
  eligible: number
  /** Files above the per-file limit; they stay available only from disk. */
  tooLarge: number
  bytes: number
}

/**
 * Predicts what a folder import can store in the browser. Binary files cannot
 * be identified until they are read, so this count is honest about being an
 * upper bound.
 */
export function estimateContentCapture(scan: ImportScan): ContentCaptureEstimate {
  let eligible = 0
  let tooLarge = 0
  let bytes = 0

  for (const candidate of scan.files) {
    if (candidate.file.size > MAX_IMPORT_FILE_BYTES) {
      tooLarge += 1
      continue
    }
    if (bytes + candidate.file.size > MAX_IMPORT_CONTENT_BYTES) {
      tooLarge += 1
      continue
    }
    eligible += 1
    bytes += candidate.file.size
  }

  return { eligible, tooLarge, bytes }
}

/** True when a file's first bytes contain a NUL, the usual binary signal. */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8192)
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return true
    }
  }
  return false
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}
