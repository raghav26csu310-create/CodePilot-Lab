import { describe, expect, it } from 'vitest'
import {
  createInitialWorkspaceState,
  workspaceReducer,
} from './workspaceReducer'

describe('workspaceReducer', () => {
  it('creates initial workspace state with default layout and cursor null', () => {
    const state = createInitialWorkspaceState([
      { path: 'src/main.ts', kind: 'file' },
      { path: 'README.md', kind: 'file' },
    ])
    expect(state.tree.nodes.length).toBeGreaterThan(0)
    expect(state.ui.cursor).toBeNull()
  })

  it('updates cursor coordinates on editor/set-cursor', () => {
    const state = createInitialWorkspaceState()
    const next = workspaceReducer(state, {
      type: 'editor/set-cursor',
      cursor: { line: 12, column: 5, selected: 0 },
    })
    expect(next.ui.cursor).toEqual({ line: 12, column: 5, selected: 0 })
  })

  it('toggles bottom and explorer panels correctly', () => {
    const state = createInitialWorkspaceState()
    const bottomToggled = workspaceReducer(state, { type: 'ui/toggle-bottom' })
    expect(bottomToggled.ui.bottomOpen).toBe(!state.ui.bottomOpen)

    const explorerToggled = workspaceReducer(state, { type: 'ui/toggle-explorer' })
    expect(explorerToggled.ui.explorerOpen).toBe(!state.ui.explorerOpen)
  })

  it('handles tab open and activate', () => {
    const state = createInitialWorkspaceState([{ path: 'index.ts', kind: 'file' }])
    const withOpened = workspaceReducer(state, { type: 'file/open', path: 'index.ts' })
    expect(withOpened.tree.tabs).toHaveLength(1)
    expect(withOpened.tree.activeTabPath).toBe('index.ts')
  })
})
