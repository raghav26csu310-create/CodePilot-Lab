import { listStoredEntries, readStoredContent } from '../../lib/projectStorage'
import { languageForPath } from '../editor/languageRegistry'

export type ModuleKind = 'entry' | 'source' | 'config' | 'test' | 'asset' | 'doc'

export type ModuleNode = {
  id: string
  path: string
  name: string
  directory: string
  kind: ModuleKind
  language: string
  linesOfCode: number
  sizeBytes: number
  imports: string[]
  importedBy: string[]
  exports: string[]
}

export type ArchitectureSummary = {
  projectId: string
  projectName: string
  totalFiles: number
  totalFolders: number
  totalLinesOfCode: number
  totalSizeBytes: number
  languages: { language: string; count: number; percentage: number }[]
  entryPoints: ModuleNode[]
  modules: ModuleNode[]
  dependencyDensity: number
}

function resolveRelativeImport(currentPath: string, importTarget: string, allPaths: Set<string>): string | null {
  if (!importTarget.startsWith('.')) {
    return null
  }
  const currentDir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''
  const parts = currentDir ? currentDir.split('/') : []
  const segments = importTarget.split('/')

  for (const seg of segments) {
    if (seg === '.') continue
    if (seg === '..') {
      parts.pop()
    } else {
      parts.push(seg)
    }
  }

  const base = parts.join('/')
  const candidateExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.py', '.h', '.hpp']
  for (const ext of candidateExtensions) {
    const candidate = `${base}${ext}`
    if (allPaths.has(candidate)) {
      return candidate
    }
    const indexCandidate = `${base}/index${ext}`
    if (allPaths.has(indexCandidate)) {
      return indexCandidate
    }
  }

  return null
}

function detectKind(path: string): ModuleKind {
  const lower = path.toLowerCase()
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()

  if (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.startsWith('tests/') ||
    lower.startsWith('test/')
  ) {
    return 'test'
  }

  if (
    name === 'package.json' ||
    name === 'tsconfig.json' ||
    name.startsWith('.prettier') ||
    name.startsWith('.eslint') ||
    name === 'makefile' ||
    name === 'cmakelists.txt' ||
    name.includes('config')
  ) {
    return 'config'
  }

  if (
    name === 'main.py' ||
    name === 'index.ts' ||
    name === 'index.js' ||
    name === 'index.html' ||
    name === 'app.tsx' ||
    name === 'app.jsx' ||
    name === 'main.c' ||
    name === 'main.cpp' ||
    name === 'main.java' ||
    name === 'server.ts' ||
    name === 'server.js'
  ) {
    return 'entry'
  }

  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.doc')) {
    return 'doc'
  }

  if (lower.endsWith('.svg') || lower.endsWith('.png') || lower.endsWith('.css') || lower.endsWith('.json')) {
    return 'asset'
  }

  return 'source'
}

function extractImports(path: string, content: string, allPaths: Set<string>): string[] {
  const imports = new Set<string>()
  const lower = path.toLowerCase()

  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) {
    const importRegex = /(?:import\s+(?:[\w*\s{},$]+from\s+)?['"](.*?)['"]|require\(['"](.*?)['"]\)|import\(['"](.*?)['"]\))/g
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(content)) !== null) {
      const target = match[1] || match[2] || match[3]
      if (target) {
        const resolved = resolveRelativeImport(path, target, allPaths)
        if (resolved) {
          imports.add(resolved)
        }
      }
    }
  } else if (lower.endsWith('.py')) {
    const pyImportRegex = /(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/g
    let match: RegExpExecArray | null
    while ((match = pyImportRegex.exec(content)) !== null) {
      const target = match[1] || match[2]
      if (target && target.startsWith('.')) {
        const relPath = target.startsWith('..')
          ? `../${target.slice(2).replace(/\./g, '/')}`
          : `./${target.slice(1).replace(/\./g, '/')}`
        const resolved = resolveRelativeImport(path, relPath, allPaths)
        if (resolved) {
          imports.add(resolved)
        }
      }
    }
  } else if (lower.endsWith('.c') || lower.endsWith('.cpp') || lower.endsWith('.h') || lower.endsWith('.hpp')) {
    const cIncludeRegex = /#include\s+["'](.*?)["']/g
    let match: RegExpExecArray | null
    while ((match = cIncludeRegex.exec(content)) !== null) {
      const target = match[1]
      if (target) {
        const resolved = resolveRelativeImport(path, `./${target}`, allPaths)
        if (resolved) {
          imports.add(resolved)
        }
      }
    }
  }

  return [...imports]
}

function extractExports(path: string, content: string): string[] {
  const exports = new Set<string>()
  const lower = path.toLowerCase()

  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) {
    const exportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+([a-zA-Z0-9_$]+)/g
    let match: RegExpExecArray | null
    while ((match = exportRegex.exec(content)) !== null) {
      if (match[1]) exports.add(match[1])
    }
    if (/export\s+default\b/.test(content)) {
      exports.add('default')
    }
  } else if (lower.endsWith('.py')) {
    const defRegex = /^\s*(?:def|class)\s+([a-zA-Z0-9_]+)/gm
    let match: RegExpExecArray | null
    while ((match = defRegex.exec(content)) !== null) {
      if (match[1] && !match[1].startsWith('_')) exports.add(match[1])
    }
  }

  return [...exports].slice(0, 20)
}

export async function analyzeProjectArchitecture(
  projectId: string,
  projectName: string,
): Promise<ArchitectureSummary> {
  const entries = await listStoredEntries(projectId)
  const fileEntries = entries.filter((e) => e.kind === 'file')
  const folderEntries = entries.filter((e) => e.kind === 'folder')

  const allPaths = new Set(fileEntries.map((e) => e.path))
  const languageCounts = new Map<string, number>()
  let totalLines = 0
  let totalBytes = 0

  const nodes: ModuleNode[] = []

  for (const entry of fileEntries) {
    const content = (await readStoredContent(projectId, entry.path)) ?? ''
    const lang = languageForPath(entry.path)
    const lines = content ? content.split(/\r?\n/).length : 0
    totalLines += lines
    totalBytes += entry.sizeBytes || new TextEncoder().encode(content).length

    languageCounts.set(lang.label, (languageCounts.get(lang.label) || 0) + 1)

    const imports = extractImports(entry.path, content, allPaths)
    const exports = extractExports(entry.path, content)
    const kind = detectKind(entry.path)
    const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : 'root'

    nodes.push({
      id: entry.path,
      path: entry.path,
      name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
      directory: dir,
      kind,
      language: lang.label,
      linesOfCode: lines,
      sizeBytes: entry.sizeBytes || content.length,
      imports,
      importedBy: [],
      exports,
    })
  }

  // Backfill reverse importedBy references
  const nodeMap = new Map(nodes.map((n) => [n.path, n]))
  for (const node of nodes) {
    for (const imp of node.imports) {
      const target = nodeMap.get(imp)
      if (target && !target.importedBy.includes(node.path)) {
        target.importedBy.push(node.path)
      }
    }
  }

  // Calculate languages breakdown
  const languages = [...languageCounts.entries()]
    .map(([language, count]) => ({
      language,
      count,
      percentage: Math.round((count / Math.max(1, fileEntries.length)) * 100),
    }))
    .sort((a, b) => b.count - a.count)

  const entryPoints = nodes.filter((n) => n.kind === 'entry')
  const totalImports = nodes.reduce((sum, n) => sum + n.imports.length, 0)
  const dependencyDensity = fileEntries.length > 0 ? Number((totalImports / fileEntries.length).toFixed(2)) : 0

  return {
    projectId,
    projectName,
    totalFiles: fileEntries.length,
    totalFolders: folderEntries.length,
    totalLinesOfCode: totalLines,
    totalSizeBytes: totalBytes,
    languages,
    entryPoints,
    modules: nodes,
    dependencyDensity,
  }
}

export { extractImports, extractExports, detectKind, resolveRelativeImport }

