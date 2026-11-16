/**
 * Prettier configuration resolution and formatting for the workspace.
 *
 * The browser never executes project code, so only declarative configuration is
 * read: JSON Prettier configs, a `prettier` key in package.json and
 * `.editorconfig`. JavaScript Prettier configs (`prettier.config.js` and the
 * `.prettierrc.js` family) are detected and reported as unsupported rather than
 * imported, which would run project code inside the editor.
 */

export type ProjectFile = { path: string; content: string }

export type ResolvedFormatConfig = {
  options: Record<string, unknown>
  /** Config files that contributed, in resolution order. */
  sources: string[]
  /** Honest notes about files that exist but were not applied. */
  warnings: string[]
}

export type FormatResult =
  | { ok: true; text: string; changed: boolean; warnings: string[] }
  | { ok: false; message: string; warnings: string[] }

const PARSER_BY_EXTENSION: Record<string, string> = {
  js: 'babel',
  jsx: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  yaml: 'yaml',
  yml: 'yaml',
}

const UNSUPPORTED_LABELS: Record<string, string> = {
  py: 'Python',
  pyw: 'Python',
  java: 'Java',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  hh: 'C++',
  hxx: 'C++',
  go: 'Go',
  rs: 'Rust',
  rb: 'Ruby',
  php: 'PHP',
  sh: 'shell',
  ps1: 'PowerShell',
}

/** Config file names in the order Prettier itself searches them. */
const CONFIG_CANDIDATES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.toml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
]

const JS_CONFIG = /\.(js|cjs|mjs)$/i

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Prettier parser for a path, or null when Prettier has no parser for it. */
export function parserForPath(path: string): string | null {
  return PARSER_BY_EXTENSION[extensionOf(path)] ?? null
}

export function isPrettierSupported(path: string): boolean {
  return parserForPath(path) !== null
}

/** Human label for a language Prettier genuinely cannot format. */
export function unsupportedLanguageLabel(path: string): string | null {
  return UNSUPPORTED_LABELS[extensionOf(path)] ?? null
}

export function supportedExtensions(): string[] {
  return Object.keys(PARSER_BY_EXTENSION)
}

/**
 * Resolve the project's formatting options the same way Prettier documents it:
 * the first config file found wins, and package.json's `prettier` key is a
 * supported location.
 */
export function resolveFormatConfig(files: ProjectFile[]): ResolvedFormatConfig {
  const byPath = new Map(files.map((file) => [normalize(file.path), file.content]))
  const warnings: string[] = []
  const editorconfig = byPath.get('.editorconfig')
  const base = editorconfig ? parseEditorconfig(editorconfig) : {}

  const options: Record<string, unknown> = { ...base }
  const sources: string[] = editorconfig ? ['.editorconfig'] : []

  const packageJson = byPath.get('package.json')
  if (packageJson) {
    const parsed = parseJson(packageJson, 'package.json', warnings)
    const section = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).prettier : null
    if (section && typeof section === 'object' && !Array.isArray(section)) {
      Object.assign(options, stripSchema(section as Record<string, unknown>))
      sources.push('package.json#prettier')
    }
  }

  for (const candidate of CONFIG_CANDIDATES) {
    const content = byPath.get(candidate)
    if (content === undefined) {
      continue
    }

    if (JS_CONFIG.test(candidate)) {
      warnings.push(
        `${candidate} is a JavaScript Prettier config. It was not executed inside the editor; use .prettierrc.json or the Formatting settings instead.`,
      )
      continue
    }

    if (candidate.endsWith('.yaml') || candidate.endsWith('.yml')) {
      warnings.push(
        `${candidate} is YAML. This build reads JSON Prettier configs only, so those options were not applied.`,
      )
      continue
    }

    if (candidate.endsWith('.toml')) {
      warnings.push(
        `${candidate} is TOML. This build reads JSON Prettier configs only, so those options were not applied.`,
      )
      continue
    }

    const parsed = parseJson(content, candidate, warnings)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.assign(options, stripSchema(parsed as Record<string, unknown>))
      sources.push(candidate)
      break
    }
  }

  return { options, sources, warnings }
}

function normalize(path: string): string {
  return path.replace(/^\.?\//, '')
}

function stripSchema(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value }
  delete copy.$schema
  return copy
}

function parseJson(
  content: string,
  source: string,
  warnings: string[],
): unknown {
  try {
    return JSON.parse(content) as unknown
  } catch {
    warnings.push(`${source} is not valid JSON, so its formatting options were ignored.`)
    return null
  }
}

/**
 * `.editorconfig` support is limited to the keys Prettier documents as
 * equivalent: indentation, line endings and print width.
 */
export function parseEditorconfig(content: string): Record<string, unknown> {
  const values = new Map<string, string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) {
      continue
    }
    const index = line.indexOf('=')
    if (index <= 0) continue
    values.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim())
  }

  const options: Record<string, unknown> = {}
  const indentStyle = values.get('indent_style')
  if (indentStyle === 'tab') options.useTabs = true
  if (indentStyle === 'space') options.useTabs = false

  const indentSize = values.get('indent_size')
  if (indentSize && /^\d+$/.test(indentSize)) options.tabWidth = Number(indentSize)

  const endOfLine = values.get('end_of_line')
  if (endOfLine === 'lf' || endOfLine === 'crlf' || endOfLine === 'cr') {
    options.endOfLine = endOfLine
  }

  const maxLineLength = values.get('max_line_length')
  if (maxLineLength && /^\d+$/.test(maxLineLength) && maxLineLength !== 'off') {
    options.printWidth = Number(maxLineLength)
  }

  return options
}

type Standalone = typeof import('prettier/standalone')

let standalonePromise: Promise<Standalone> | null = null
const pluginCache = new Map<string, Promise<unknown>>()
let supportedOptionNames: Set<string> | null = null

function loadStandalone(): Promise<Standalone> {
  standalonePromise ??= import('prettier/standalone')
  return standalonePromise
}

function loadPlugin(name: string, loader: () => Promise<unknown>): Promise<unknown> {
  let cached = pluginCache.get(name)
  if (!cached) {
    cached = loader()
    pluginCache.set(name, cached)
  }
  return cached
}

async function pluginsForParser(parser: string): Promise<unknown[]> {
  switch (parser) {
    case 'babel':
    case 'json':
      return [
        await loadPlugin('babel', () => import('prettier/plugins/babel')),
        await loadPlugin('estree', () => import('prettier/plugins/estree')),
      ]
    case 'typescript':
      return [
        await loadPlugin('typescript', () => import('prettier/plugins/typescript')),
        await loadPlugin('estree', () => import('prettier/plugins/estree')),
      ]
    case 'css':
    case 'scss':
    case 'less':
      return [await loadPlugin('postcss', () => import('prettier/plugins/postcss'))]
    case 'html':
      return [
        await loadPlugin('html', () => import('prettier/plugins/html')),
        await loadPlugin('babel', () => import('prettier/plugins/babel')),
        await loadPlugin('estree', () => import('prettier/plugins/estree')),
        await loadPlugin('postcss', () => import('prettier/plugins/postcss')),
      ]
    case 'markdown':
      return [await loadPlugin('markdown', () => import('prettier/plugins/markdown'))]
    case 'mdx':
      return [await loadPlugin('markdown', () => import('prettier/plugins/markdown'))]
    case 'yaml':
      return [await loadPlugin('yaml', () => import('prettier/plugins/yaml'))]
    default:
      return []
  }
}

async function knownOptions(): Promise<Set<string>> {
  if (supportedOptionNames) {
    return supportedOptionNames
  }
  // `getSupportInfo()` in the standalone build only reports the core options;
  // language plugins add theirs. The static list below covers the documented
  // core options so a real `.prettierrc` is not silently discarded.
  supportedOptionNames = new Set(CORE_OPTION_NAMES)
  try {
    const prettier = await loadStandalone()
    const info = await prettier.getSupportInfo()
    for (const option of info.options) {
      if (option.name) {
        supportedOptionNames.add(option.name)
      }
    }
  } catch {
    // The static list is enough; formatting still validates the values.
  }
  return supportedOptionNames
}

const CORE_OPTION_NAMES = [
  'printWidth',
  'tabWidth',
  'useTabs',
  'semi',
  'singleQuote',
  'quoteProps',
  'jsxSingleQuote',
  'trailingComma',
  'bracketSpacing',
  'bracketSameLine',
  'arrowParens',
  'proseWrap',
  'htmlWhitespaceSensitivity',
  'vueIndentScriptAndStyle',
  'endOfLine',
  'embeddedLanguageFormatting',
  'singleAttributePerLine',
  'objectWrap',
  'experimentalOperatorPosition',
  'experimentalTernaries',
  'insertPragma',
  'requirePragma',
  'rangeStart',
  'rangeEnd',
  'filepath',
  'parser',
  'plugins',
]

export type FormatRequest = {
  path: string
  text: string
  config?: ResolvedFormatConfig
  /** Format only this range (1-based lines, 0-based columns, like Monaco). */
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }
}

const RANGE_PARSERS = new Set(['babel', 'typescript'])

export async function formatWithPrettier(request: FormatRequest): Promise<FormatResult> {
  const parser = parserForPath(request.path)
  const warnings = [...(request.config?.warnings ?? [])]

  if (!parser) {
    const label = unsupportedLanguageLabel(request.path) ?? 'This file type'
    return {
      ok: false,
      message: `${label} is not supported by Prettier. A language-specific formatter would be needed; the buffer is unchanged.`,
      warnings,
    }
  }

  const prettier = await loadStandalone()
  const plugins = await pluginsForParser(parser)
  if (plugins.length === 0) {
    return {
      ok: false,
      message: `Prettier has no parser loaded for ${parser}. The buffer is unchanged.`,
      warnings,
    }
  }

  const allowed = await knownOptions()
  const options: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(request.config?.options ?? {})) {
    if (allowed.has(key)) {
      options[key] = value
    } else {
      warnings.push(`Unknown Prettier option "${key}" was ignored.`)
    }
  }

  if (request.range) {
    if (!RANGE_PARSERS.has(parser)) {
      return {
        ok: false,
        message: `Formatting a selection is only supported for JavaScript and TypeScript. ${request.path} needs a full document format.`,
        warnings,
      }
    }
    const lines = request.text.split(/\r?\n/)
    const offset = (line: number, column: number) => {
      const clampedLine = Math.min(Math.max(line, 1), lines.length)
      let total = 0
      for (let index = 0; index < clampedLine - 1; index += 1) {
        total += (lines[index]?.length ?? 0) + 1
      }
      return total + Math.max(0, Math.min(column, lines[clampedLine - 1]?.length ?? 0))
    }
    const start = offset(request.range.startLine, request.range.startColumn)
    const end = offset(request.range.endLine, request.range.endColumn)
    if (end > start) {
      options.rangeStart = start
      options.rangeEnd = end
    }
  }

  try {
    const text = await prettier.format(request.text, {
      ...options,
      parser,
      plugins: plugins as never,
    })
    return {
      ok: true,
      text,
      changed: text !== request.text,
      warnings,
    }
  } catch (error) {
    return {
      ok: false,
      message: prettierErrorMessage(error, request.path),
      warnings,
    }
  }
}

function prettierErrorMessage(error: unknown, path: string): string {
  if (!(error instanceof Error)) {
    return `Prettier could not format ${path}. The buffer is unchanged.`
  }
  // Prettier syntax errors already carry a line/column and a caret.
  const firstLine = error.message.split('\n').slice(0, 6).join('\n')
  return `Prettier could not format ${path}: ${firstLine}`
}
