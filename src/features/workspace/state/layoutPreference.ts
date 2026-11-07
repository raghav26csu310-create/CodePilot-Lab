import type { BottomPanelTab, WorkspaceLayout } from './types'

const KEY = 'codepilot.workspace.layout.v1'

export const EXPLORER_MIN = 208
export const EXPLORER_MAX = 420
export const COPILOT_MIN = 272
export const COPILOT_MAX = 480
export const BOTTOM_MIN = 132
export const BOTTOM_MAX = 440

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  explorerWidth: 272,
  copilotWidth: 336,
  bottomHeight: 224,
}

const BOTTOM_TABS: BottomPanelTab[] = ['terminal', 'output', 'problems', 'diagnostics']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampExplorerWidth(value: number): number {
  return clamp(value, EXPLORER_MIN, EXPLORER_MAX)
}

export function clampCopilotWidth(value: number): number {
  return clamp(value, COPILOT_MIN, COPILOT_MAX)
}

export function clampBottomHeight(value: number): number {
  return clamp(value, BOTTOM_MIN, BOTTOM_MAX)
}

type StoredPreference = {
  explorerWidth?: unknown
  copilotWidth?: unknown
  bottomHeight?: unknown
  bottomTab?: unknown
}

export type LayoutPreference = {
  layout: WorkspaceLayout
  bottomTab: BottomPanelTab
}

export function readLayoutPreference(): LayoutPreference {
  const fallback: LayoutPreference = {
    layout: { ...DEFAULT_LAYOUT },
    bottomTab: 'terminal',
  }

  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw) as StoredPreference
    const bottomTab =
      typeof parsed.bottomTab === 'string' &&
      BOTTOM_TABS.includes(parsed.bottomTab as BottomPanelTab)
        ? (parsed.bottomTab as BottomPanelTab)
        : fallback.bottomTab

    return {
      layout: {
        explorerWidth:
          typeof parsed.explorerWidth === 'number'
            ? clampExplorerWidth(parsed.explorerWidth)
            : fallback.layout.explorerWidth,
        copilotWidth:
          typeof parsed.copilotWidth === 'number'
            ? clampCopilotWidth(parsed.copilotWidth)
            : fallback.layout.copilotWidth,
        bottomHeight:
          typeof parsed.bottomHeight === 'number'
            ? clampBottomHeight(parsed.bottomHeight)
            : fallback.layout.bottomHeight,
      },
      bottomTab,
    }
  } catch {
    return fallback
  }
}

export function writeLayoutPreference(layout: WorkspaceLayout, bottomTab: BottomPanelTab): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...layout, bottomTab }))
  } catch {
    // Layout persistence is best-effort; the workspace still works per session.
  }
}
