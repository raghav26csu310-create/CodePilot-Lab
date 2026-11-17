import {
  Activity,
  ArrowLeftRight,
  Code2,
  FlaskConical,
  Network,
  Radar,
  Settings2,
  Sparkles,
  Trophy,
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
      'GitHub-backed source control inside the workspace',
      'Hosted multi-user project sharing through the API',
    ],
  },
  {
    path: '/copilot',
    label: 'AI Copilot',
    icon: Sparkles,
    status: 'live',
    tagline: 'Provider-independent help grounded in the files you choose to share.',
    planned: [],
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
    status: 'live',
    tagline: 'Run and trace real programs on the local execution service.',
    planned: [],
  },
  {
    path: '/convert',
    label: 'Code Converter',
    icon: ArrowLeftRight,
    status: 'live',
    tagline: 'Translate between nine languages with a reviewable diff.',
    planned: [],
  },
  {
    path: '/practice',
    label: 'Practice Arena',
    icon: Trophy,
    status: 'live',
    tagline: 'Original problems graded against private local test suites.',
    planned: [],
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
    status: 'live',
    tagline: 'Provider credentials, context budget and local data controls.',
    planned: [],
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
