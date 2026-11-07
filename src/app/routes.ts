import {
  Activity,
  Code2,
  FlaskConical,
  Network,
  Radar,
  Settings2,
  Sparkles,
  Vault,
  type LucideIcon,
} from 'lucide-react'

export type RouteStatus = 'live' | 'scheduled'

export type RouteInfo = {
  path: string
  label: string
  icon: LucideIcon
  status: RouteStatus
  tagline: string
  planned: string[]
}

export const ROUTES: RouteInfo[] = [
  {
    path: '/',
    label: 'Command Center',
    icon: Radar,
    status: 'live',
    tagline: 'Local projects, dispatch and verifiable system state.',
    planned: [],
  },
  {
    path: '/workspace',
    label: 'Code Workspace',
    icon: Code2,
    status: 'live',
    tagline: 'A real Monaco editor over a persisted local project tree.',
    planned: [
      'Writing file changes through to a linked folder handle',
      'A local model bridge for the Copilot dock',
      'Terminal, task and output channels',
    ],
  },
  {
    path: '/copilot',
    label: 'AI Copilot',
    icon: Sparkles,
    status: 'scheduled',
    tagline: 'A local model bridge with its limits on the table.',
    planned: [
      'Opt-in connection to a local model provider',
      'Context assembled from files you explicitly select',
      'Streamed responses with cancellation',
      'No hidden provider calls and no simulated answers',
    ],
  },
  {
    path: '/atlas',
    label: 'Project Atlas',
    icon: Network,
    status: 'scheduled',
    tagline: 'Module relationships extracted from real project files.',
    planned: [
      'Import graph extracted from real files',
      'Pan, zoom and focus on a module',
      'Dependency inspection without inventing relationships',
    ],
  },
  {
    path: '/lab',
    label: 'Execution Lab',
    icon: FlaskConical,
    status: 'scheduled',
    tagline: 'Run and trace a file, keeping real output separate from simulation.',
    planned: [
      'JavaScript execution in a local Web Worker',
      'Captured console output, errors and timeouts',
      'Instrumented step visualisation, clearly labelled as simulated',
      'No claimed results that were not performed',
    ],
  },
  {
    path: '/vault',
    label: 'Project Vault',
    icon: Vault,
    status: 'scheduled',
    tagline: 'The local project archive and storage controls.',
    planned: [
      'Project archive and move',
      'Export and import of project archives',
      'Storage usage reporting and quota handling',
    ],
  },
  {
    path: '/activity',
    label: 'Activity & Diagnostics',
    icon: Activity,
    status: 'scheduled',
    tagline: 'An event log written only by real application actions.',
    planned: [
      'An event log backed by real application actions',
      'Storage health and persistence status',
      'No fabricated metrics or synthetic build results',
    ],
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: Settings2,
    status: 'scheduled',
    tagline: 'Local preferences, provider and data controls.',
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

/** Longest-prefix match so nested routes keep the correct section active. */
export function getSectionRoute(pathname: string): RouteInfo {
  const matches = ROUTES.filter(
    (route) =>
      route.path !== '/' &&
      (pathname === route.path || pathname.startsWith(`${route.path}/`)),
  ).sort((a, b) => b.path.length - a.path.length)

  return matches[0] ?? ROUTES[0]!
}
