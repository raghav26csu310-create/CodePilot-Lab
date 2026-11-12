import { useEffect, useRef } from 'react'

import { ensureMonacoSetup, monaco } from '../editor/monacoSetup'
import { MONACO_THEMES } from '../editor/monacoSetup'
import { readEditorPreferences } from '../editor/editorPreferences'
import styles from './StandaloneEditor.module.css'

type StandaloneEditorProps = {
  value: string
  language: string
  onChange?: (value: string) => void
  readOnly?: boolean
  ariaLabel: string
  /** 1-based line to highlight with the real-trace decoration, or null. */
  currentLine?: number | null
  className?: string
  options?: monaco.editor.IStandaloneEditorConstructionOptions
}

let modelCounter = 0

/**
 * Shared Monaco surface for pages outside the workspace: Execution Lab,
 * Converter and Practice. It owns its model and decorations, reports every
 * real edit upward, and disposes everything on unmount.
 */
export function StandaloneEditor({
  value,
  language,
  onChange,
  readOnly = false,
  ariaLabel,
  currentLine = null,
  className,
  options,
}: StandaloneEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const onChangeRef = useRef(onChange)
  const suppressRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    ensureMonacoSetup()
    const preferences = readEditorPreferences()
    monaco.editor.setTheme(MONACO_THEMES[preferences.theme])

    modelCounter += 1
    const model = monaco.editor.createModel(
      value,
      language,
      monaco.Uri.parse(`inmemory://codepilot/standalone-${modelCounter}.${extensionFor(language)}`),
    )
    modelRef.current = model

    const editor = monaco.editor.create(host, {
      model,
      automaticLayout: false,
      readOnly,
      ariaLabel,
      fontSize: preferences.fontSize,
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
      fontLigatures: true,
      minimap: { enabled: false },
      wordWrap: preferences.wordWrap ? 'on' : 'off',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: 'line',
      roundedSelection: true,
      tabSize: 4,
      lineNumbersMinChars: 3,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
      ...options,
    })
    editorRef.current = editor
    const collection = editor.createDecorationsCollection([])
    decorationsRef.current = collection

    if (readOnly) {
      editor.updateOptions({ readOnly: true, domReadOnly: true })
    }

    const subscription = model.onDidChangeContent(() => {
      if (!suppressRef.current) {
        onChangeRef.current?.(model.getValue())
      }
    })

    const observer = new ResizeObserver(() => editor.layout())
    observer.observe(host)

    return () => {
      observer.disconnect()
      subscription.dispose()
      collection.clear()
      editor.dispose()
      model.dispose()
      editorRef.current = null
      modelRef.current = null
      decorationsRef.current = null
    }
    // The editor is created once. Value/language/readOnly changes are applied
    // by the effects below without tearing down the model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    const model = modelRef.current
    if (!editor || !model) {
      return
    }
    if (model.getValue() === value) {
      return
    }
    suppressRef.current = true
    model.setValue(value)
    suppressRef.current = false
    // An external reset should not leave a misleading undo stack behind.
    editor.setScrollTop(0)
  }, [value])

  useEffect(() => {
    const model = modelRef.current
    if (!model) {
      return
    }
    if (model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language)
    }
  }, [language])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, domReadOnly: readOnly })
  }, [readOnly])

  useEffect(() => {
    const collection = decorationsRef.current
    if (!collection) {
      return
    }
    if (!currentLine || currentLine < 1) {
      collection.clear()
      return
    }
    collection.set([
      {
        range: new monaco.Range(currentLine, 1, currentLine, 1),
        options: {
          isWholeLine: true,
          className: 'codepilot-trace-line',
          overviewRuler: {
            color: '#57e2e6',
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      },
    ])
    editorRef.current?.revealLineInCenterIfOutsideViewport(currentLine)
  }, [currentLine])

  return (
    <div
      ref={hostRef}
      className={[styles.host, className].filter(Boolean).join(' ')}
      data-editor-language={language}
    />
  )
}

function extensionFor(language: string): string {
  switch (language) {
    case 'python':
      return 'py'
    case 'javascript':
      return 'js'
    case 'typescript':
      return 'ts'
    case 'java':
      return 'java'
    case 'c':
      return 'c'
    case 'cpp':
      return 'cpp'
    case 'html':
      return 'html'
    case 'css':
      return 'css'
    case 'json':
      return 'json'
    default:
      return 'txt'
  }
}
