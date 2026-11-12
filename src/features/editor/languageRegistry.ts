export type EditorValidationLevel = 'language-service' | 'syntax-only'

export type EditorLanguage = {
  /** Monaco language id. */
  id: string
  /** Human-readable label used in the workspace chrome. */
  label: string
  validation: EditorValidationLevel
}

type LanguageDefinition = EditorLanguage & {
  extensions: string[]
  fileNames?: string[]
}

const DEFINITIONS: LanguageDefinition[] = [
  { id: 'typescript', label: 'TypeScript', validation: 'language-service', extensions: ['ts', 'tsx', 'mts', 'cts'] },
  { id: 'javascript', label: 'JavaScript', validation: 'language-service', extensions: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'python', label: 'Python', validation: 'syntax-only', extensions: ['py', 'pyw'] },
  { id: 'java', label: 'Java', validation: 'syntax-only', extensions: ['java'] },
  { id: 'c', label: 'C', validation: 'syntax-only', extensions: ['c', 'h'] },
  { id: 'cpp', label: 'C++', validation: 'syntax-only', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'] },
  { id: 'html', label: 'HTML', validation: 'language-service', extensions: ['html', 'htm'] },
  { id: 'css', label: 'CSS', validation: 'language-service', extensions: ['css'] },
  { id: 'scss', label: 'SCSS', validation: 'language-service', extensions: ['scss'] },
  { id: 'less', label: 'Less', validation: 'language-service', extensions: ['less'] },
  { id: 'json', label: 'JSON', validation: 'language-service', extensions: ['json', 'jsonc', 'json5'] },
  { id: 'markdown', label: 'Markdown', validation: 'syntax-only', extensions: ['md', 'markdown'] },
  { id: 'yaml', label: 'YAML', validation: 'syntax-only', extensions: ['yml', 'yaml'] },
  { id: 'xml', label: 'XML', validation: 'syntax-only', extensions: ['xml', 'svg', 'plist'] },
  { id: 'shell', label: 'Shell', validation: 'syntax-only', extensions: ['sh', 'bash', 'zsh'] },
  { id: 'powershell', label: 'PowerShell', validation: 'syntax-only', extensions: ['ps1', 'psm1'] },
  { id: 'sql', label: 'SQL', validation: 'syntax-only', extensions: ['sql'] },
  { id: 'rust', label: 'Rust', validation: 'syntax-only', extensions: ['rs'] },
  { id: 'go', label: 'Go', validation: 'syntax-only', extensions: ['go'] },
  { id: 'ruby', label: 'Ruby', validation: 'syntax-only', extensions: ['rb'] },
  { id: 'php', label: 'PHP', validation: 'syntax-only', extensions: ['php'] },
  { id: 'swift', label: 'Swift', validation: 'syntax-only', extensions: ['swift'] },
  { id: 'kotlin', label: 'Kotlin', validation: 'syntax-only', extensions: ['kt', 'kts'] },
  { id: 'csharp', label: 'C#', validation: 'syntax-only', extensions: ['cs'] },
  { id: 'dockerfile', label: 'Dockerfile', validation: 'syntax-only', extensions: ['dockerfile'], fileNames: ['dockerfile'] },
  { id: 'plaintext', label: 'Plain text', validation: 'syntax-only', extensions: [] },
]

const BY_EXTENSION = new Map<string, EditorLanguage>()
const BY_FILE_NAME = new Map<string, EditorLanguage>()

for (const definition of DEFINITIONS) {
  const language: EditorLanguage = {
    id: definition.id,
    label: definition.label,
    validation: definition.validation,
  }

  for (const extension of definition.extensions) {
    BY_EXTENSION.set(extension, language)
  }
  for (const fileName of definition.fileNames ?? []) {
    BY_FILE_NAME.set(fileName, language)
  }
}

const PLAIN_TEXT: EditorLanguage = {
  id: 'plaintext',
  label: 'Plain text',
  validation: 'syntax-only',
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLocaleLowerCase() : ''
}

export function languageForPath(path: string): EditorLanguage {
  const fileName = path.slice(path.lastIndexOf('/') + 1).toLocaleLowerCase()
  const byName = BY_FILE_NAME.get(fileName)
  if (byName) {
    return byName
  }

  return BY_EXTENSION.get(extensionOf(path)) ?? PLAIN_TEXT
}

export function monacoLanguageId(path: string): string {
  return languageForPath(path).id
}

/**
 * Monaco ships document formatters for its bundled language services only.
 * Every other language is highlighted without a formatter, so the Format
 * action must say so instead of claiming it reformatted the buffer.
 */
const FORMATTER_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'json',
  'css',
  'scss',
  'less',
  'html',
])

export function supportsDocumentFormatting(languageId: string): boolean {
  return FORMATTER_LANGUAGES.has(languageId)
}
