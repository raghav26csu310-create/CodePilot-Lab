import {
  Activity,
  Code2,
  FlaskConical,
  FolderKanban,
  Gauge,
  Network,
  Settings2,
  type LucideIcon,
} from 'lucide-react'

export type RoutePhase = 'Live' | 'Phase 2' | 'Phase 3' | 'Phase 4'

export type RouteInfo = {
  path: string
  label: string
  icon: LucideIcon
  phase: RoutePhase
  tagline: string
  planned: string[]
}

export const ROUTES: RouteInfo[] = [
  {
    path: '/',
    label: 'Command',
    icon: Gauge,
    phase: 'Live',
    tagline: 'Workspace overview, system state and the way in.',
    planned: [],
  },
  {
    path: '/vault',
    label: 'Vault',
    icon: FolderKanban,
    phase: 'Phase 3',
    tagline: 'Create, open and manage locally stored projects.',
    planned: [
      'Project creation, rename and deletion backed by IndexedDB',
      'Search, import and export of project archives',
      'Storage usage reporting and quota handling',
    ],
  },
  {
    path: '/workspace',
    label: 'Workspace',
    icon: Code2,
    phase: 'Phase 2',
    tagline: 'Files, tabs, editor and the copilot surface.',
    planned: [
      'File explorer with create, rename and delete',
      'Monaco editor, tabs and unsaved-change tracking',
      'Collapsible copilot and console panels',
      'Command palette wired to project actions',
    ],
  },
  {
    path: '/atlas',
    label: 'Atlas',
    icon: Network,
    phase: 'Phase 4',
    tagline: "A map of how the project's modules reference each other.",
    planned: [
      'Import graph extracted from the real project files',
      'Pan, zoom and focus on a module',
      'Dependency inspection without inventing relationships',
    ],
  },
  {
    path: '/lab',
    label: 'Lab',
    icon: FlaskConical,
    phase: 'Phase 4',
    tagline: 'Run and trace a file, keeping real output separate from simulation.',
    planned: [
      'JavaScript execution in a local Web Worker',
      'Captured console output, errors and timeouts',
      'Instrumented step visualisation, clearly labelled as simulated',
      'No claimed test or build results that were not performed',
    ],
  },
  {
    path: '/activity',
    label: 'Activity',
    icon: Activity,
    phase: 'Phase 4',
    tagline: 'Captured events, problems and storage health.',
    planned: [
      'Event log written only by real application actions',
      'Editor diagnostics collected from Monaco',
      'Storage health and persistence status',
      'No fabricated metrics or synthetic build results',
    ],
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: Settings2,
    phase: 'Phase 3',
    tagline: 'Local preferences, AI provider and storage.',
    planned: [
      'Opt-in connection to a local model provider',
      'Motion and interface preferences',
      'Export, import and clear local data',
    ],
  },
]

export const NAV_ROUTES = ROUTES.filter((route) => route.path !== '/settings')

export function getRouteInfo(path: string): RouteInfo {
  return ROUTES.find((route) => route.path === path) ?? ROUTES[0]!
}
