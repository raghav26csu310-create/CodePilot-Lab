const KEY = 'codepilot.sidebar.collapsed'

export function readSidebarPreference(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeSidebarPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? '1' : '0')
  } catch {
    // Preference persistence is best-effort; the control still works per session.
  }
}
