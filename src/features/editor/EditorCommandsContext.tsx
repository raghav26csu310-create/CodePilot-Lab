import { createContext, useContext, useRef, type MutableRefObject, type ReactNode } from 'react'

export type SaveOutcome = {
  path: string
  ok: boolean
  message?: string
}

export type FormatOutcome = {
  /** The request reached a formatter that could act on this file. */
  ok: boolean
  /** The formatter actually changed the buffer. */
  changed: boolean
  message: string
}

export type EditorCommandApi = {
  /** Live Monaco draft, or null when no model is mounted for the path. */
  getDraft(path: string): string | null
  /** Current non-empty selection, or null when the cursor is collapsed. */
  getSelection(): {
    path: string
    text: string
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  } | null
  /** Replaces a whole buffer with an undoable edit. Never writes storage. */
  applyContent(path: string, content: string): Promise<{ ok: boolean; message?: string }>
  save(path: string): Promise<boolean>
  saveAll(): Promise<{ saved: number; failed: number }>
  format(path: string): Promise<FormatOutcome>
  focusFind(): void
  reveal(path: string, line?: number, column?: number): void
}

const EditorCommandsContext = createContext<MutableRefObject<EditorCommandApi | null> | null>(null)

export function EditorCommandsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<EditorCommandApi | null>(null)
  return <EditorCommandsContext.Provider value={ref}>{children}</EditorCommandsContext.Provider>
}

export function useEditorCommands(): MutableRefObject<EditorCommandApi | null> {
  const context = useContext(EditorCommandsContext)
  if (!context) {
    throw new Error('useEditorCommands must be used inside EditorCommandsProvider')
  }
  return context
}
