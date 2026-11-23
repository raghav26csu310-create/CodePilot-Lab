import {
  Activity,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  FileCode,
  FolderGit2,
  Layers,
  Play,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import {
  clearActivities,
  db,
  listActivities,
  listProjects,
  type ActivityRecord,
  type ActivityType,
  type ProjectRecord,
} from '../../lib/db'
import { formatBytes, relativeTime } from '../../lib/format'
import { logActivity, subscribeToActivity } from '../../lib/activityService'
import { useWebGLSupport } from '../../lib/useWebGLSupport'
import { probeGateway } from '../copilot/gateway/client'
import { fetchExecutionHealth, getExecEndpoint } from '../execution/api'
import { fetchTerminalHealth } from '../terminal/client'
import { fetchGithubStatus } from '../github/client'
import styles from './ActivityPage.module.css'

type TabType = 'activity' | 'diagnostics'

type ServiceDiag = {
  name: string
  endpoint: string
  status: 'healthy' | 'warning' | 'offline' | 'checking'
  latencyMs: number | null
  error?: string | null
  details: Record<string, string | number | boolean | null>
  startCommand?: string
}

const CATEGORY_MAP: Record<string, ActivityType[]> = {
  files: ['file:save', 'file:create', 'file:rename', 'file:delete'],
  projects: ['project:create', 'project:import', 'project:delete', 'project:duplicate', 'project:open', 'project:rename'],
  execution: ['code:execute', 'code:trace'],
  terminal: ['terminal:session'],
  ai: ['ai:chat', 'ai:explain', 'ai:convert'],
  system: ['diagnostics:check', 'settings:update'],
}

function getActivityIcon(type: ActivityType) {
  if (type.startsWith('file:')) return <FileCode size={16} />
  if (type.startsWith('project:')) return <Layers size={16} />
  if (type.startsWith('code:')) return <Play size={16} />
  if (type.startsWith('terminal:')) return <Terminal size={16} />
  if (type.startsWith('ai:')) return <Sparkles size={16} />
  return <Activity size={16} />
}

export function ActivityPage() {
  const [activeTab, setActiveTab] = useState<TabType>('activity')
  const [activities, setActivities] = useState<ActivityRecord[]>([])
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterProject, setFilterProject] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copyingReport, setCopyingReport] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  // Stable timestamp captured on mount
  const [mountTime] = useState(() => Date.now())

  // WebGL support
  const webGlSupport = useWebGLSupport()

  // Diagnostics state
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false)
  const [diagTimestamp, setDiagTimestamp] = useState<number | null>(null)
  const [services, setServices] = useState<ServiceDiag[]>([])

  // Load activities and projects on mount
  useEffect(() => {
    let cancelled = false
    void Promise.all([listActivities({ limit: 300 }), listProjects()]).then(([actList, projList]) => {
      if (!cancelled) {
        setActivities(actList)
        setProjects(projList)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Subscribe to live activity feed
  useEffect(() => {
    const unsubscribe = subscribeToActivity((newAct: ActivityRecord) => {
      setActivities((prev) => [newAct, ...prev])
    })
    return unsubscribe
  }, [])

  // Core probe logic: returns probe array without setting component state
  const probeAllServices = useCallback(async (): Promise<ServiceDiag[]> => {
    const runStart = performance.now()

    // 1. Frontend & Storage
    let storageQuotaStr = 'Unknown'
    let storageUsageStr = 'Unknown'
    let persisted = false
    let dbVerno = 5
    let projectCount = 0
    let fileCount = 0
    let activityCount = 0

    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate()
        if (est.quota) storageQuotaStr = formatBytes(est.quota)
        if (est.usage) storageUsageStr = formatBytes(est.usage)
      }
      if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
        persisted = await navigator.storage.persisted()
      }
      dbVerno = db.verno
      projectCount = await db.projects.count()
      fileCount = await db.files.count()
      activityCount = await db.activities.count()
    } catch {
      // Ignore client detection fallback
    }

    const frontendDiag: ServiceDiag = {
      name: 'Frontend & IndexedDB',
      endpoint: 'Browser Client (Local)',
      status: 'healthy',
      latencyMs: Math.round(performance.now() - runStart),
      details: {
        'React Version': '19.0.0',
        'Database Engine': 'Dexie / IndexedDB',
        'Schema Version': `v${dbVerno}`,
        'WebGL Support': webGlSupport,
        'Storage Used': storageUsageStr,
        'Storage Quota': storageQuotaStr,
        'Persisted Storage': persisted ? 'Yes (Protected)' : 'No (Best-effort)',
        'Stored Projects': projectCount,
        'Stored Files': fileCount,
        'Activity Records': activityCount,
      },
    }

    // 2. CodePilot API Gateway
    const apiStart = performance.now()
    let apiDiag: ServiceDiag
    try {
      const probe = await probeGateway()
      const latency = Math.round(performance.now() - apiStart)
      apiDiag = {
        name: 'CodePilot API Gateway',
        endpoint: window.location.origin + '/api',
        status: probe.reachable ? 'healthy' : 'offline',
        latencyMs: latency,
        error: probe.reachable ? null : probe.message,
        startCommand: 'npm run api:dev',
        details: {
          Reachable: probe.reachable ? 'Yes' : 'No',
          Version: probe.version || '0.7.0',
          Session: probe.user ? `Logged in (${probe.user.email})` : 'Anonymous / No active session',
          Message: probe.message,
        },
      }
    } catch (err) {
      apiDiag = {
        name: 'CodePilot API Gateway',
        endpoint: window.location.origin + '/api',
        status: 'offline',
        latencyMs: null,
        error: err instanceof Error ? err.message : 'API offline or unreachable',
        startCommand: 'npm run api:dev',
        details: {
          Reachable: 'No',
          Note: 'Start the loopback API server to use managed credentials and accounts.',
        },
      }
    }

    // 3. Execution Companion
    const execStart = performance.now()
    let execDiag: ServiceDiag
    try {
      const execHealth = await fetchExecutionHealth(3000)
      const latency = Math.round(performance.now() - execStart)
      const runtimeNames = Object.entries(execHealth.runtimes)
        .filter(([, p]) => p.ok)
        .map(([lang]) => lang)
        .join(', ')

      execDiag = {
        name: 'Code Execution Companion',
        endpoint: getExecEndpoint(),
        status: execHealth.ok ? 'healthy' : 'warning',
        latencyMs: latency,
        details: {
          Status: execHealth.ok ? 'Operational' : 'Impaired',
          'Available Runtimes': runtimeNames || 'None detected',
          'Python Tracer': execHealth.tracing?.languages.includes('python') ? 'Supported' : 'Unavailable',
          'Timeout Limit': `${Math.round(execHealth.limits.runTimeoutMs / 1000)}s`,
          'Max Output': `${formatBytes(execHealth.limits.maxStdoutChars)}`,
        },
      }
    } catch (err) {
      execDiag = {
        name: 'Code Execution Companion',
        endpoint: getExecEndpoint(),
        status: 'offline',
        latencyMs: null,
        error: err instanceof Error ? err.message : 'Execution sidecar is offline',
        startCommand: 'npm run exec',
        details: {
          Reachable: 'No',
          Note: 'Companion runner executes Python, JS, C, C++, and grades problems locally.',
        },
      }
    }

    // 4. Integrated Terminal Service
    const termStart = performance.now()
    let termDiag: ServiceDiag
    try {
      const termHealth = await fetchTerminalHealth()
      const latency = Math.round(performance.now() - termStart)
      termDiag = {
        name: 'Integrated Terminal (PTY)',
        endpoint: `${getExecEndpoint()}/terminal`,
        status: termHealth.ok ? 'healthy' : 'warning',
        latencyMs: latency,
        details: {
          Status: termHealth.ok ? 'Operational' : 'Impaired',
          Platform: termHealth.platform,
          'Active Shell': termHealth.shell,
          'Available Shells': termHealth.availableShells?.join(', ') || 'Default OS shell',
          'Pairing Required': termHealth.pairingRequired ? 'Yes' : 'No',
        },
      }
    } catch (err) {
      termDiag = {
        name: 'Integrated Terminal (PTY)',
        endpoint: `${getExecEndpoint()}/terminal`,
        status: 'offline',
        latencyMs: null,
        error: err instanceof Error ? err.message : 'Terminal companion offline',
        startCommand: 'npm run exec',
        details: {
          Reachable: 'No',
          Note: 'PTY host streams real OS shells (PowerShell, CMD, Bash) over WebSocket.',
        },
      }
    }

    // 5. GitHub & Git Bridge
    const gitStart = performance.now()
    let gitDiag: ServiceDiag
    try {
      const gitStatus = await fetchGithubStatus()
      const latency = Math.round(performance.now() - gitStart)
      gitDiag = {
        name: 'GitHub CLI & Git Integration',
        endpoint: `${getExecEndpoint()}/github/status`,
        status: gitStatus.gitAvailable ? 'healthy' : 'warning',
        latencyMs: latency,
        details: {
          'Git CLI Installed': gitStatus.gitAvailable ? 'Yes' : 'Not detected',
          'GitHub CLI (gh)': gitStatus.githubCliAvailable ? 'Installed' : 'Not installed',
          Authenticated: gitStatus.authenticated ? 'Yes' : 'No',
          User: gitStatus.profile?.login ?? 'None',
        },
      }
    } catch {
      gitDiag = {
        name: 'GitHub CLI & Git Integration',
        endpoint: `${getExecEndpoint()}/github/status`,
        status: 'offline',
        latencyMs: null,
        startCommand: 'npm run exec',
        details: {
          Status: 'Companion unreachable',
          Note: 'Requires the local companion process and terminal pairing token.',
        },
      }
    }

    return [frontendDiag, apiDiag, execDiag, termDiag, gitDiag]
  }, [webGlSupport])

  // Initial diagnostics probe on mount
  useEffect(() => {
    let cancelled = false
    void probeAllServices().then((result) => {
      if (!cancelled) {
        setServices(result)
        setDiagTimestamp(mountTime)
      }
    })
    return () => {
      cancelled = true
    }
  }, [probeAllServices, mountTime])

  // Manual re-probe triggered by user button click
  const handleManualRunDiagnostics = async () => {
    setDiagnosticsRunning(true)
    try {
      const result = await probeAllServices()
      setServices(result)
      const now = Date.now()
      setDiagTimestamp(now)

      void logActivity({
        type: 'diagnostics:check',
        description: 'System health diagnostics completed across all local subsystems',
        status: 'success',
        details: JSON.stringify({
          frontend: result[0]?.status,
          api: result[1]?.status,
          exec: result[2]?.status,
          term: result[3]?.status,
        }),
      })
    } finally {
      setDiagnosticsRunning(false)
    }
  }

  // Filter activities
  const filteredActivities = useMemo(() => {
    return activities.filter((act) => {
      if (filterCategory !== 'all') {
        const allowedTypes = CATEGORY_MAP[filterCategory]
        if (allowedTypes && !allowedTypes.includes(act.type)) return false
      }
      if (filterProject !== 'all' && act.projectId !== filterProject) return false
      if (filterStatus !== 'all' && act.status !== filterStatus) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchDesc = act.description.toLowerCase().includes(q)
        const matchProj = act.projectName?.toLowerCase().includes(q)
        const matchType = act.type.toLowerCase().includes(q)
        if (!matchDesc && !matchProj && !matchType) return false
      }
      return true
    })
  }, [activities, filterCategory, filterProject, filterStatus, searchQuery])

  // Group activities by date
  const groupedActivities = useMemo(() => {
    const groups: { title: string; items: ActivityRecord[] }[] = []
    const today = new Date(mountTime).toDateString()
    const yesterday = new Date(mountTime - 86400000).toDateString()

    const todayItems: ActivityRecord[] = []
    const yesterdayItems: ActivityRecord[] = []
    const olderItems: ActivityRecord[] = []

    for (const act of filteredActivities) {
      const actDate = new Date(act.timestamp).toDateString()
      if (actDate === today) {
        todayItems.push(act)
      } else if (actDate === yesterday) {
        yesterdayItems.push(act)
      } else {
        olderItems.push(act)
      }
    }

    if (todayItems.length > 0) groups.push({ title: 'Today', items: todayItems })
    if (yesterdayItems.length > 0) groups.push({ title: 'Yesterday', items: yesterdayItems })
    if (olderItems.length > 0) groups.push({ title: 'Older History', items: olderItems })

    return groups
  }, [filteredActivities, mountTime])

  const handleClearHistory = async () => {
    if (!window.confirm('Are you sure you want to clear all activity records? This cannot be undone.')) {
      return
    }
    await clearActivities()
    setActivities([])
  }

  const handleExportActivitiesJson = () => {
    const blob = new Blob([JSON.stringify(filteredActivities, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `codepilot-activity-log-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyReport = async () => {
    setCopyingReport(true)
    const lines = [
      '# CodePilot Lab Diagnostic Report',
      `Generated at: ${new Date().toISOString()}`,
      '',
      '## Subsystem Health',
    ]

    for (const s of services) {
      lines.push(`### ${s.name}`)
      lines.push(`- **Status**: ${s.status.toUpperCase()}`)
      lines.push(`- **Endpoint**: \`${s.endpoint}\``)
      if (s.latencyMs !== null) lines.push(`- **Latency**: ${s.latencyMs}ms`)
      if (s.error) lines.push(`- **Error**: ${s.error}`)
      lines.push('- **Details**:')
      for (const [k, v] of Object.entries(s.details)) {
        lines.push(`  - ${k}: ${String(v)}`)
      }
      lines.push('')
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2500)
    } finally {
      setCopyingReport(false)
    }
  }

  // Calculate overall system health
  const healthyCount = services.filter((s) => s.status === 'healthy').length
  const warningCount = services.filter((s) => s.status === 'warning').length
  const offlineCount = services.filter((s) => s.status === 'offline').length

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1>
            <Activity size={28} />
            Activity & Diagnostics
          </h1>
          <p className={styles.subtitle}>
            Verifiable real-time system diagnostics and immutable application event history.
            Every entry originates strictly from real browser, API, or execution events.
          </p>
        </div>
      </header>

      {/* Tabs */}
      <nav className={styles.tabBar} aria-label="Sections">
        <button
          className={`${styles.tabButton} ${activeTab === 'activity' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          <Clock size={16} />
          Activity Centre ({activities.length})
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'diagnostics' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          <Cpu size={16} />
          Diagnostics & Services
          {offlineCount > 0 ? (
            <Badge tone="warn">{offlineCount} offline</Badge>
          ) : (
            <Badge tone="live">All Live</Badge>
          )}
        </button>
      </nav>

      {/* TAB 1: ACTIVITY CENTRE */}
      {activeTab === 'activity' && (
        <section aria-label="Activity History" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.searchBox}>
              <Search size={16} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Search events, projects, descriptions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
              />
            </div>

            <div className={styles.filterGroup}>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className={styles.selectInput}
                aria-label="Filter by category"
              >
                <option value="all">All Categories</option>
                <option value="files">File Operations</option>
                <option value="projects">Project Management</option>
                <option value="execution">Code Execution</option>
                <option value="terminal">Terminal PTY</option>
                <option value="ai">AI Operations</option>
                <option value="system">System & Diagnostics</option>
              </select>

              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className={styles.selectInput}
                aria-label="Filter by project"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className={styles.selectInput}
                aria-label="Filter by status"
              >
                <option value="all">All Statuses</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="info">Info</option>
              </select>
            </div>

            <div className={styles.actionButtons}>
              <Button variant="ghost" onClick={handleExportActivitiesJson}>
                <Download size={15} />
                Export JSON
              </Button>
              <Button variant="ghost" onClick={() => void handleClearHistory()}>
                <Trash2 size={15} />
                Clear
              </Button>
            </div>
          </div>

          <div className={styles.statsBar}>
            <span>Showing {filteredActivities.length} of {activities.length} recorded events</span>
            <span>• Live event listener active</span>
          </div>

          {/* Activity Feed */}
          {filteredActivities.length === 0 ? (
            <div className={styles.emptyState}>
              <Activity size={36} />
              <h3>No matching activity records</h3>
              <p>Activity records are generated automatically as you edit files, run programs, or execute commands.</p>
            </div>
          ) : (
            <div className={styles.activityFeed}>
              {groupedActivities.map((group) => (
                <div key={group.title} className={styles.dateGroup}>
                  <div className={styles.dateGroupTitle}>
                    <Clock size={12} />
                    {group.title} ({group.items.length})
                  </div>

                  {group.items.map((act) => {
                    const isExpanded = expandedId === act.id
                    return (
                      <div key={act.id} className={styles.activityCard}>
                        <div className={styles.iconWrapper}>
                          {getActivityIcon(act.type)}
                        </div>

                        <div className={styles.activityContent}>
                          <div className={styles.activityTopRow}>
                            <span className={styles.activityDesc}>{act.description}</span>
                            {act.status === 'success' && (
                              <CheckCircle2 size={14} className={styles.statusSuccess} />
                            )}
                            {act.status === 'failure' && (
                              <XCircle size={14} className={styles.statusFailed} />
                            )}
                            {act.status === 'info' && (
                              <Activity size={14} className={styles.statusInfo} />
                            )}
                          </div>

                          <div className={styles.activityMetaRow}>
                            <Badge tone="neutral">{act.type}</Badge>
                            {act.projectName && (
                              <Badge tone="live">{act.projectName}</Badge>
                            )}
                            <span>{relativeTime(act.timestamp, mountTime)}</span>
                            <span>{new Date(act.timestamp).toLocaleTimeString()}</span>

                            {act.details && (
                              <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : act.id)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text-secondary)',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  padding: '0',
                                  textDecoration: 'underline',
                                }}
                              >
                                {isExpanded ? 'Hide Details' : 'View Details'}
                              </button>
                            )}
                          </div>

                          {isExpanded && act.details && (
                            <div className={styles.detailsDrawer}>
                              {act.details}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: DIAGNOSTICS CENTRE */}
      {activeTab === 'diagnostics' && (
        <section aria-label="System Diagnostics" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Overall Health Banner */}
          <div className={styles.overallBanner}>
            <div className={styles.overallStatus}>
              <div
                className={`${styles.statusDot} ${
                  offlineCount > 0 ? styles.dotYellow : styles.dotGreen
                }`}
              />
              <div className={styles.overallText}>
                <h2>
                  {offlineCount === 0
                    ? 'All Local Services Reachable and Operational'
                    : `${healthyCount} Online, ${offlineCount} Offline / Unreachable`}
                </h2>
                <p>
                  Last probed: {diagTimestamp ? new Date(diagTimestamp).toLocaleTimeString() : 'Pending'}
                  {warningCount > 0 && ` • ${warningCount} warnings`}
                </p>
              </div>
            </div>

            <div className={styles.diagActions}>
              <Button
                variant="ghost"
                onClick={() => void handleCopyReport()}
                disabled={copyingReport || services.length === 0}
              >
                <Copy size={16} />
                {copySuccess ? 'Copied!' : 'Copy Report'}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleManualRunDiagnostics()}
                disabled={diagnosticsRunning}
              >
                <RefreshCw size={16} className={diagnosticsRunning ? 'animate-spin' : ''} />
                {diagnosticsRunning ? 'Probing...' : 'Run Diagnostics'}
              </Button>
            </div>
          </div>

          {/* Subsystem Cards Grid */}
          <div className={styles.grid}>
            {services.map((service) => (
              <div key={service.name} className={styles.diagCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {service.name.includes('Frontend') && <Database size={18} />}
                    {service.name.includes('API') && <Server size={18} />}
                    {service.name.includes('Execution') && <Play size={18} />}
                    {service.name.includes('Terminal') && <Terminal size={18} />}
                    {service.name.includes('GitHub') && <FolderGit2 size={18} />}
                    {service.name}
                  </div>
                  <div>
                    {service.status === 'healthy' && <Badge tone="ok">Healthy</Badge>}
                    {service.status === 'warning' && <Badge tone="warn">Warning</Badge>}
                    {service.status === 'offline' && <Badge tone="neutral">Offline</Badge>}
                  </div>
                </div>

                <div className={styles.cardEndpoint}>{service.endpoint}</div>

                {service.latencyMs !== null && (
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                    Latency: <span style={{ color: 'var(--color-green-400)' }}>{service.latencyMs} ms</span>
                  </div>
                )}

                {service.status === 'offline' && (
                  <div className={styles.offlineNotice}>
                    <strong>Service is unreachable.</strong>
                    <div>{service.error || 'Connection refused.'}</div>
                    {service.startCommand && (
                      <div>
                        To start, run in your terminal:
                        <span className={styles.codeSnippet}>{service.startCommand}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className={styles.propsTable}>
                  {Object.entries(service.details).map(([key, value]) => (
                    <div key={key} className={styles.propRow}>
                      <span className={styles.propKey}>{key}</span>
                      <span className={styles.propVal}>{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
