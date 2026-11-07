import { createContext, useContext, useRef, type MutableRefObject, type ReactNode } from 'react'

export type SaveOutcome = {
  path: string
  ok: boolean
  message?: string
}

export type EditorCommandApi = {
  /** Live Monaco draft, or null when no model is mounted for the path. */
  getDraft(path: string): string | null
  save(path: string): Promise<boolean>
  saveAll(): Promise<{ saved: number; failed: number }>
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
