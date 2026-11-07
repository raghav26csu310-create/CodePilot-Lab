export const MAX_IMPORT_FILES = 3000
export const MAX_IMPORT_DEPTH = 12

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

export type ImportScan = {
  name: string
  manifest: string[]
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
 * the relative path on each File, so the manifest stays faithful.
 */
export function scanFileList(files: File[]): ImportScan {
  const acc = createAccumulator()
  let name = 'Imported project'

  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name
    const segments = relativePath.split('/').filter(Boolean)

    if (segments.length > 1 && name === 'Imported project') {
      name = segments[0] ?? name
    }

    const directories = segments.slice(0, -1).map((segment) => segment.toLowerCase())
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

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}
