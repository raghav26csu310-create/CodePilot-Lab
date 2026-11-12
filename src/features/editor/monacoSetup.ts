import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

import type { EditorThemeId } from './editorPreferences'

type MonacoEnvironmentShape = {
  getWorker(moduleId: string, label: string): Worker
}

let configured = false

export const MONACO_THEMES: Record<EditorThemeId, string> = {
  midnight: 'codepilot-midnight',
  graphite: 'codepilot-graphite',
}

const SHARED_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '5d718c', fontStyle: 'italic' },
  { token: 'keyword', foreground: '7fd8ff' },
  { token: 'keyword.control', foreground: '7fd8ff' },
  { token: 'operator', foreground: 'a9bdd6' },
  { token: 'string', foreground: 'b7e2a8' },
  { token: 'string.escape', foreground: 'f0c46a' },
  { token: 'number', foreground: 'f0c46a' },
  { token: 'number.hex', foreground: 'f0c46a' },
  { token: 'regexp', foreground: 'd9a6f5' },
  { token: 'type', foreground: '9ac7ff' },
  { token: 'type.identifier', foreground: '9ac7ff' },
  { token: 'class', foreground: '9ac7ff' },
  { token: 'function', foreground: 'e6efff' },
  { token: 'identifier', foreground: 'dbe6f5' },
  { token: 'variable', foreground: 'dbe6f5' },
  { token: 'variable.predefined', foreground: 'f0c46a' },
  { token: 'constant', foreground: 'f0c46a' },
  { token: 'tag', foreground: '7fd8ff' },
  { token: 'metatag', foreground: '7fd8ff' },
  { token: 'attribute.name', foreground: 'a7b6cc' },
  { token: 'attribute.value', foreground: 'b7e2a8' },
  { token: 'delimiter', foreground: '8fa3bd' },
  { token: 'delimiter.bracket', foreground: '8fa3bd' },
  { token: 'key', foreground: '9ac7ff' },
  { token: 'invalid', foreground: 'ff8f9b' },
]

const MIDNIGHT_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: SHARED_RULES,
  colors: {
    'editor.background': '#070b12',
    'editor.foreground': '#dbe6f5',
    'editorGutter.background': '#070b12',
    'editorLineNumber.foreground': '#3d4b61',
    'editorLineNumber.activeForeground': '#8fa3bd',
    'editorCursor.foreground': '#57e2e6',
    'editor.selectionBackground': '#57e2e633',
    'editor.inactiveSelectionBackground': '#57e2e61a',
    'editor.selectionHighlightBackground': '#57e2e624',
    'editor.wordHighlightBackground': '#57e2e61a',
    'editor.wordHighlightStrongBackground': '#57e2e62b',
    'editor.findMatchBackground': '#57e2e640',
    'editor.findMatchHighlightBackground': '#57e2e622',
    'editor.findRangeHighlightBackground': '#57e2e612',
    'editor.lineHighlightBackground': '#0c1522',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#141e2d',
    'editorIndentGuide.activeBackground1': '#2a3d55',
    'editorBracketMatch.background': '#57e2e61f',
    'editorBracketMatch.border': '#57e2e666',
    'editorBracketHighlight.foreground1': '#57e2e6',
    'editorBracketHighlight.foreground2': '#9ac7ff',
    'editorBracketHighlight.foreground3': '#f0c46a',
    'editorBracketHighlight.foreground4': '#d9a6f5',
    'editorBracketHighlight.foreground5': '#b7e2a8',
    'editorBracketHighlight.foreground6': '#8fa3bd',
    'editorOverviewRuler.border': '#00000000',
    'editorOverviewRuler.findMatchForeground': '#57e2e6aa',
    'editorError.foreground': '#ff8f9b',
    'editorWarning.foreground': '#f0c46a',
    'editorInfo.foreground': '#7fd8ff',
    'editorHint.foreground': '#5d718c',
    'editorWidget.background': '#0b1320',
    'editorWidget.border': '#1b2a3d',
    'editorSuggestWidget.background': '#0b1320',
    'editorSuggestWidget.border': '#1b2a3d',
    'editorSuggestWidget.selectedBackground': '#122436',
    'editorSuggestWidget.highlightForeground': '#57e2e6',
    'editorHoverWidget.background': '#0b1320',
    'editorHoverWidget.border': '#1b2a3d',
    'editorGutter.modifiedBackground': '#57e2e6',
    'editorGutter.addedBackground': '#7ddba3',
    'editorGutter.deletedBackground': '#ff8f9b',
    'minimap.background': '#060a11',
    'minimap.selectionHighlight': '#57e2e640',
    'minimap.findMatchHighlight': '#57e2e680',
    'scrollbarSlider.background': '#26385066',
    'scrollbarSlider.hoverBackground': '#334a6677',
    'scrollbarSlider.activeBackground': '#57e2e64d',
    'editor.selectionForeground': '#f4fbff',
    'editorLink.activeForeground': '#57e2e6',
    'editorCodeLens.foreground': '#5d718c',
    'editorInlayHint.foreground': '#5d718c',
    'editorInlayHint.background': '#0c1522',
    'peekView.border': '#1b2a3d',
    'peekViewEditor.background': '#08101a',
    'peekViewResult.background': '#0b1320',
    'peekViewResult.selectionBackground': '#122436',
    'peekViewTitle.background': '#0b1320',
  },
}

const GRAPHITE_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: SHARED_RULES,
  colors: {
    ...MIDNIGHT_THEME.colors,
    'editor.background': '#0b111a',
    'editorGutter.background': '#0b111a',
    'editor.lineHighlightBackground': '#111a27',
    'minimap.background': '#090f17',
  },
}

function configureTypeScriptDefaults() {
  const compilerOptions: monaco.typescript.CompilerOptions = {
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    strict: true,
  }

  monaco.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  monaco.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)

  // The editor has no project-wide module graph yet, so import resolution
  // diagnostics would be guesses rather than findings. In-file syntax and
  // semantic checks stay enabled and are disclosed in the Problems panel.
  const diagnostics: monaco.typescript.DiagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
    diagnosticCodesToIgnore: [2307, 2792, 6133],
  }

  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics)
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics)
  monaco.typescript.typescriptDefaults.setEagerModelSync(true)
  monaco.typescript.javascriptDefaults.setEagerModelSync(true)
}

export function ensureMonacoSetup(): void {
  if (configured) {
    return
  }

  ;(self as unknown as { MonacoEnvironment: MonacoEnvironmentShape }).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      switch (label) {
        case 'json':
          return new jsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker()
        case 'typescript':
        case 'javascript':
          return new tsWorker()
        default:
          return new editorWorker()
      }
    },
  }

  monaco.editor.defineTheme(MONACO_THEMES.midnight, MIDNIGHT_THEME)
  monaco.editor.defineTheme(MONACO_THEMES.graphite, GRAPHITE_THEME)
  configureTypeScriptDefaults()
  monaco.editor.setTheme(MONACO_THEMES.midnight)

  configured = true
}

export { monaco }
