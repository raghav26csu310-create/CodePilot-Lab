import type { ProjectRecord } from '../../../lib/db'
import { listStoredEntries, loadFileContent } from '../../../lib/projectStorage'
import { languageForPath } from '../../editor/languageRegistry'
import type { FileTreeNode, WorkspaceTab } from '../../workspace/state/types'

export const AGENT_SCAN_LIMITS = {
  maxFiles: 120,
  maxFileBytes: 120_000,
  maxTotalBytes: 600_000,
  maxRelevantFiles: 5,
  maxSearchMatches: 30,
} as const

const READABLE_EXTENSIONS =
  /\.(?:[cm]?[jt]sx?|py|json|toml|txt|xml|ya?ml|html?|css|md|ini|cfg|properties)$/i
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  'vendor',
])
const MANIFEST_NAMES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'cargo.toml',
  'go.mod',
  'pom.xml',
  'composer.json',
])
const SEARCH_STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'can',
  'could',
  'does',
  'for',
  'from',
  'have',
  'help',
  'how',
  'into',
  'make',
  'need',
  'please',
  'that',
  'the',
  'this',
  'with',
  'would',
])

export type AgentProjectFile = {
  path: string
  content: string
  language: string
  source: 'draft' | 'stored' | 'disk'
}

export type AgentSearchHit = {
  path: string
  line: number
  preview: string
}

export type AgentImportReference = {
  path: string
  line: number
  specifier: string
  resolvedPath: string | null
  kind: 'local' | 'external' | 'unresolved'
}

export type AgentProjectReport = {
  totalProjectFiles: number
  filesRead: number
  totalBytesRead: number
  files: AgentProjectFile[]
  dependencies: { manifest: string; names: string[] }[]
  imports: AgentImportReference[]
  search: {
    query: string
    hits: AgentSearchHit[]
    totalMatches: number
  }
  relevantPaths: string[]
  omitted: { path: string; reason: string }[]
  omittedCount: number
  summary: string
}

type ScanProjectInput = {
  project: ProjectRecord
  nodes: FileTreeNode[]
  tabs: WorkspaceTab[]
  activePath: string | null
  query: string
  getDraft: (path: string) => string | null
}

function flattenFiles(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (items: FileTreeNode[]) => {
    for (const node of items) {
      if (node.kind === 'file') {
        paths.push(node.path)
      }
      walk(node.children)
    }
  }
  walk(nodes)
  return paths
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function isSensitivePath(path: string): boolean {
  return (
    /(^|\/)\.env(?:$|[./-]|rc$)/i.test(path) ||
    /(^|[/._-])(?:api[-_]?keys?|tokens?|credentials?|secrets?)(?:[/._-]|$)/i.test(path) ||
    /(^|\/)(?:id_rsa|id_ed25519)(?:\.|$)/i.test(path) ||
    /\.(?:pem|p12|pfx|key)$/i.test(path)
  )
}

function isExcludedPath(path: string): boolean {
  return (
    path.split('/').some((part) => EXCLUDED_DIRECTORIES.has(part.toLocaleLowerCase())) ||
    isSensitivePath(path) ||
    !READABLE_EXTENSIONS.test(path)
  )
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

function isManifest(path: string): boolean {
  return MANIFEST_NAMES.has(fileName(path).toLocaleLowerCase())
}

function prioritizedPaths(
  paths: string[],
  activePath: string | null,
  query: string,
): string[] {
  const queryTerms = query.toLocaleLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? []
  const uniqueTerms = [...new Set(queryTerms.filter((term) => !SEARCH_STOP_WORDS.has(term)))]
  return paths
    .filter((path) => !isExcludedPath(path))
    .sort((left, right) => {
      const score = (path: string) =>
        (isManifest(path) ? 100 : 0) +
        (path === activePath ? 90 : 0) +
        uniqueTerms.reduce(
          (total, term) => total + (path.toLocaleLowerCase().includes(term) ? 5 : 0),
          0,
        )
      return score(right) - score(left) || left.localeCompare(right)
    })
}

async function loadProjectFile(
  input: ScanProjectInput,
  path: string,
): Promise<AgentProjectFile | null> {
  const draft = input.getDraft(path)
  if (draft !== null) {
    return { path, content: draft, language: languageForPath(path).label, source: 'draft' }
  }

  const tab = input.tabs.find((item) => item.path === path)
  if (tab?.status === 'ready') {
    return {
      path,
      content: tab.content,
      language: languageForPath(path).label,
      source: tab.source === 'disk' ? 'disk' : 'stored',
    }
  }

  const loaded = await loadFileContent(input.project, path)
  return loaded.status === 'ready'
    ? {
        path,
        content: loaded.content,
        language: languageForPath(path).label,
        source: loaded.source,
      }
    : null
}

function dependencyNames(path: string, content: string): string[] {
  const name = fileName(path).toLocaleLowerCase()
  if (name === 'package.json' || name === 'composer.json') {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>
      const keys = name === 'package.json' ? ['dependencies', 'devDependencies'] : ['require', 'require-dev']
      return [...new Set(keys.flatMap((key) => {
        const section = parsed[key]
        return section && typeof section === 'object' && !Array.isArray(section)
          ? Object.keys(section)
          : []
      }))].sort()
    } catch {
      return []
    }
  }
  if (name === 'requirements.txt') {
    return [...new Set(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
        .map((line) => line.match(/^([A-Za-z0-9_.-]+)/)?.[1])
        .filter((dependency): dependency is string => Boolean(dependency)),
    )].sort()
  }
  if (name === 'pyproject.toml') {
    return [...new Set(
      [...content.matchAll(/^\s*["']?([A-Za-z0-9_.-]+)\s*(?:[<>=!~;[]|=)/gm)]
        .map((match) => match[1])
        .filter((dependency): dependency is string => Boolean(dependency)),
    )].sort()
  }
  if (name === 'cargo.toml') {
    const section = content.match(/^\[dependencies\]([\s\S]*?)(?=^\[|\s*$)/m)?.[1] ?? ''
    return [...new Set(
      [...section.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)]
        .map((match) => match[1])
        .filter((dependency): dependency is string => Boolean(dependency)),
    )].sort()
  }
  if (name === 'go.mod') {
    return [...new Set(
      [...content.matchAll(/^\s*([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\s+v[^\s]+/gm)]
        .map((match) => match[1])
        .filter((dependency): dependency is string => Boolean(dependency)),
    )].sort()
  }
  if (name === 'pom.xml') {
    return [...new Set(
      [...content.matchAll(/<artifactId>\s*([^<]+)\s*<\/artifactId>/g)]
        .map((match) => match[1]?.trim())
        .filter((dependency): dependency is string => Boolean(dependency)),
    )].sort()
  }
  return []
}

function resolveRelativePath(importer: string, specifier: string): string | null {
  const parts = importer.split('/').slice(0, -1)
  for (const part of specifier.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue
    }
    if (part === '..') {
      if (parts.length === 0) {
        return null
      }
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.join('/')
}

function resolveImport(
  importer: string,
  specifier: string,
  paths: Set<string>,
  python: boolean,
): AgentImportReference['resolvedPath'] {
  let base: string | null = null
  if (specifier.startsWith('.')) {
    base = resolveRelativePath(importer, specifier)
  } else if (python) {
    base = specifier.replace(/^\.+/, '').replace(/\./g, '/')
  }
  if (base === null) {
    return null
  }

  const candidates = [base]
  if (python) {
    candidates.push(`${base}.py`, `${base}/__init__.py`)
  } else if (!/\.[A-Za-z0-9]+$/.test(base)) {
    for (const extension of ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json']) {
      candidates.push(`${base}${extension}`)
    }
    for (const extension of ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']) {
      candidates.push(`${base}/index${extension}`)
    }
  }
  return candidates.find((candidate) => paths.has(candidate)) ?? null
}

function extractImports(files: AgentProjectFile[]): AgentImportReference[] {
  const knownPaths = new Set(files.map((file) => file.path))
  const references: AgentImportReference[] = []
  for (const file of files) {
    const python = file.path.toLocaleLowerCase().endsWith('.py')
    const lines = file.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const specifier = python
        ? (
          line.match(/^\s*from\s+([.\w]+)\s+import\b/)?.[1] ??
          line.match(/^\s*import\s+([.\w]+)/)?.[1] ??
          null
        )
        : (
          line.match(/^\s*(?:import|export)\b.*?\bfrom\s*['"]([^'"]+)['"]/)?.[1] ??
          line.match(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ??
          line.match(/^\s*import\s*['"]([^'"]+)['"]/)?.[1] ??
          null
        )
      if (!specifier) {
        continue
      }
      const resolvedPath = resolveImport(file.path, specifier, knownPaths, python)
      references.push({
        path: file.path,
        line: index + 1,
        specifier,
        resolvedPath,
        kind: resolvedPath
          ? 'local'
          : specifier.startsWith('.') || (python && specifier.startsWith('.'))
            ? 'unresolved'
            : 'external',
      })
    }
  }
  return references
}

function searchFiles(files: AgentProjectFile[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) {
    return { query, hits: [] as AgentSearchHit[], totalMatches: 0 }
  }
  const terms = [...new Set(
    (needle.match(/[a-z0-9_./-]{3,}/g) ?? []).filter((term) => !SEARCH_STOP_WORDS.has(term)),
  )]
  const hits: AgentSearchHit[] = []
  let totalMatches = 0
  for (const file of files) {
    const lines = file.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const lower = line.toLocaleLowerCase()
      if (!lower.includes(needle) && !terms.some((term) => lower.includes(term))) {
        continue
      }
      totalMatches += 1
      if (hits.length < AGENT_SCAN_LIMITS.maxSearchMatches) {
        hits.push({ path: file.path, line: index + 1, preview: line.trim().slice(0, 180) })
      }
    }
  }
  return { query, hits, totalMatches }
}

function summarizeReport(input: {
  totalProjectFiles: number
  files: AgentProjectFile[]
  dependencies: AgentProjectReport['dependencies']
  imports: AgentImportReference[]
  search: AgentProjectReport['search']
  relevantPaths: string[]
  omitted: AgentProjectReport['omitted']
  omittedCount: number
  totalBytesRead: number
}): string {
  const lines = [
    `Workspace file entries: ${input.totalProjectFiles}. Real file contents read: ${input.files.length}, ${input.totalBytesRead} bytes.`,
    input.omittedCount > 0
      ? `Inspection limits/policy omitted ${input.omittedCount} file(s); omissions are listed below.`
      : 'No files were omitted by the inspection limits.',
    `Dependencies parsed from actual manifests: ${
      input.dependencies.length
        ? input.dependencies.map((item) => `${item.manifest}: ${item.names.join(', ') || '(none detected)'}`).join('; ')
        : '(no supported dependency manifest read)'
    }`,
  ]
  const localImports = input.imports.filter((entry) => entry.kind === 'local')
  const unresolved = input.imports.filter((entry) => entry.kind === 'unresolved')
  lines.push(
    `Import relationships read: ${localImports.length} resolved local edge(s)${
      unresolved.length ? `, ${unresolved.length} unresolved relative import(s)` : ''
    }.`,
  )
  for (const entry of localImports.slice(0, 35)) {
    lines.push(`- ${entry.path}:${entry.line} -> ${entry.resolvedPath}`)
  }
  if (localImports.length > 35) {
    lines.push(`- ${localImports.length - 35} additional local import edge(s) not shown.`)
  }
  if (input.search.query.trim()) {
    lines.push(
      `Project search for “${input.search.query}”: ${input.search.totalMatches} matching line(s) across inspected content.`,
    )
    for (const hit of input.search.hits.slice(0, 15)) {
      lines.push(`- ${hit.path}:${hit.line}: ${hit.preview}`)
    }
  }
  if (input.relevantPaths.length) {
    lines.push(`Relevant files selected for model context: ${input.relevantPaths.join(', ')}.`)
  }
  for (const omission of input.omitted.slice(0, 20)) {
    lines.push(`Omitted: ${omission.path} (${omission.reason})`)
  }
  if (input.omittedCount > input.omitted.length) {
    lines.push(`Omitted ${input.omittedCount - input.omitted.length} additional file(s).`)
  }
  return lines.join('\n')
}

export function createProjectReport(input: {
  paths: string[]
  files: AgentProjectFile[]
  query: string
  omitted: AgentProjectReport['omitted']
  omittedCount: number
  totalBytesRead: number
}): AgentProjectReport {
  const imports = extractImports(input.files)
  const dependencies = input.files
    .filter((file) => isManifest(file.path))
    .map((file) => ({ manifest: file.path, names: dependencyNames(file.path, file.content) }))
  const search = searchFiles(input.files, input.query)
  const hitPaths = [...new Set(search.hits.map((hit) => hit.path))]
  const relevantPaths = [...new Set([
    ...hitPaths,
    ...imports.filter((entry) => entry.kind === 'local').map((entry) => entry.resolvedPath!),
    ...input.files.filter((file) => isManifest(file.path)).map((file) => file.path),
  ])].slice(0, AGENT_SCAN_LIMITS.maxRelevantFiles)
  const reportBase = {
    totalProjectFiles: input.paths.length,
    filesRead: input.files.length,
    totalBytesRead: input.totalBytesRead,
    files: input.files,
    dependencies,
    imports,
    search,
    relevantPaths,
    omitted: input.omitted,
    omittedCount: input.omittedCount,
  }
  return {
    ...reportBase,
    summary: summarizeReport(reportBase),
  }
}

export async function inspectProjectForAgent(input: ScanProjectInput): Promise<AgentProjectReport> {
  const paths = flattenFiles(input.nodes)
  const entries = await listStoredEntries(input.project.id)
  const sizeByPath = new Map(entries.map((entry) => [entry.path, entry.sizeBytes]))
  const candidates = prioritizedPaths(paths, input.activePath, input.query)
  const excludedCount = paths.length - candidates.length
  const files: AgentProjectFile[] = []
  const omitted: AgentProjectReport['omitted'] = excludedCount
    ? [{ path: '(security and file-type policy)', reason: `${excludedCount} path(s) excluded` }]
    : []
  let omittedCount = excludedCount
  let totalBytesRead = 0
  let scannedCount = 0

  for (const path of candidates) {
    if (scannedCount >= AGENT_SCAN_LIMITS.maxFiles) {
      omittedCount += 1
      if (omitted.length < 30) {
        omitted.push({ path, reason: `scan limit ${AGENT_SCAN_LIMITS.maxFiles} files` })
      }
      continue
    }
    scannedCount += 1
    const storedSize = sizeByPath.get(path) ?? 0
    if (storedSize > AGENT_SCAN_LIMITS.maxFileBytes) {
      omittedCount += 1
      omitted.push({ path, reason: `stored size exceeds ${AGENT_SCAN_LIMITS.maxFileBytes} bytes` })
      continue
    }
    const file = await loadProjectFile(input, path)
    if (!file) {
      omittedCount += 1
      omitted.push({ path, reason: 'content unavailable from the active workspace sources' })
      continue
    }
    const size = byteLength(file.content)
    if (size > AGENT_SCAN_LIMITS.maxFileBytes) {
      omittedCount += 1
      omitted.push({ path, reason: `content exceeds ${AGENT_SCAN_LIMITS.maxFileBytes} bytes` })
      continue
    }
    if (totalBytesRead + size > AGENT_SCAN_LIMITS.maxTotalBytes) {
      omittedCount += 1
      omitted.push({ path, reason: `total scan limit ${AGENT_SCAN_LIMITS.maxTotalBytes} bytes reached` })
      continue
    }
    totalBytesRead += size
    files.push(file)
  }

  return createProjectReport({
    paths,
    files,
    query: input.query,
    omitted,
    omittedCount,
    totalBytesRead,
  })
}

export type ProjectExecutionSnapshot = {
  files: { path: string; content: string }[]
  includedPaths: string[]
  externalImports: string[]
}

export function buildProjectExecutionSnapshot(
  report: AgentProjectReport,
  entryPath: string,
  language: string,
): ProjectExecutionSnapshot {
  if (!['python', 'javascript', 'typescript'].includes(language)) {
    throw new Error('Project test execution currently supports Python, JavaScript and TypeScript entries only.')
  }
  const filesByPath = new Map(report.files.map((file) => [file.path, file]))
  if (!filesByPath.has(entryPath)) {
    const omission = report.omitted.find((item) => item.path === entryPath)
    throw new Error(
      omission
        ? `${entryPath} was not read: ${omission.reason}.`
        : `${entryPath} is not available in the active project scan.`,
    )
  }

  const referencesByPath = new Map<string, AgentImportReference[]>()
  for (const reference of report.imports) {
    const list = referencesByPath.get(reference.path) ?? []
    list.push(reference)
    referencesByPath.set(reference.path, list)
  }

  const visited = new Set<string>()
  const externalImports = new Set<string>()
  const visit = (path: string) => {
    if (visited.has(path)) {
      return
    }
    visited.add(path)
    for (const reference of referencesByPath.get(path) ?? []) {
      if (reference.kind === 'local' && reference.resolvedPath) {
        visit(reference.resolvedPath)
      } else if (reference.kind === 'unresolved') {
        throw new Error(
          `Cannot build a complete test snapshot: ${reference.path}:${reference.line} imports ${reference.specifier}, but that local file was not read.`,
        )
      } else if (reference.kind === 'external') {
        externalImports.add(reference.specifier)
      }
    }
  }
  visit(entryPath)

  const manifest = filesByPath.get('package.json')
  if (manifest && ['javascript', 'typescript'].includes(language)) {
    visited.add(manifest.path)
  }

  const selected = [...visited]
    .map((path) => filesByPath.get(path))
    .filter((file): file is AgentProjectFile => file !== undefined)
    .map(({ path, content }) => ({ path, content }))
  if (!selected.some((file) => file.path === entryPath)) {
    throw new Error('The selected test entry was not included in the execution snapshot.')
  }
  return {
    files: selected,
    includedPaths: selected.map((file) => file.path),
    externalImports: [...externalImports].sort(),
  }
}

export function findTestEntryPaths(nodes: FileTreeNode[]): string[] {
  return flattenFiles(nodes)
    .filter((path) => {
      if (!/\.(?:[cm]?[jt]sx?|py)$/i.test(path) || isExcludedPath(path)) {
        return false
      }
      return (
        /(^|\/)(?:__tests__|tests?|specs?)\//i.test(path) ||
        /(?:^|[._-])(?:test|spec)(?:[._-]|$)/i.test(fileName(path)) ||
        /(^|\/)test_[^/]+\.py$/i.test(path)
      )
    })
    .sort((left, right) => left.localeCompare(right))
}
