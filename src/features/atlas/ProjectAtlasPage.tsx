import {
  Code2,
  FolderTree,
  Network,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { listProjects, type ProjectRecord } from '../../lib/db'
import { formatBytes } from '../../lib/format'
import { logActivity } from '../../lib/activityService'
import { useAiSettings } from '../copilot/settingsStore'
import { streamAssistant } from '../copilot/quickAsk'
import {
  analyzeProjectArchitecture,
  type ArchitectureSummary,
  type ModuleKind,
  type ModuleNode,
} from './projectAnalysis'
import styles from './ProjectAtlas.module.css'

const LAYER_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f7df1e',
  Python: '#3572a5',
  C: '#555555',
  'C++': '#f34b7d',
  HTML: '#e34c26',
  CSS: '#563d7c',
  JSON: '#292929',
  Markdown: '#083fa1',
}

export function ProjectAtlasPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedProjectId = searchParams.get('project')

  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [summary, setSummary] = useState<ArchitectureSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null)
  const [filterKind, setFilterKind] = useState<ModuleKind | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // AI Analysis state
  const aiSettings = useAiSettings()
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiResponse, setAiResponse] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  // 1. Load project list
  useEffect(() => {
    let active = true
    listProjects()
      .then((list) => {
        if (!active) return
        setProjects(list)
        if (list.length > 0) {
          const target = requestedProjectId && list.some((p) => p.id === requestedProjectId)
            ? requestedProjectId
            : list[0]!.id
          setSelectedProjectId(target)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [requestedProjectId])

  // 2. Analyze project architecture
  const runAnalysis = useCallback(async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return

    try {
      const res = await analyzeProjectArchitecture(project.id, project.name)
      setSummary(res)
      setSelectedNodePath((prev) => (res.modules.some((m) => m.path === prev) ? prev : res.modules[0]?.path ?? null))
    } finally {
      setAnalyzing(false)
    }
  }, [projects])

  useEffect(() => {
    if (selectedProjectId) {
      void runAnalysis(selectedProjectId)
    }
  }, [selectedProjectId, runAnalysis])

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id)
    setSearchParams({ project: id })
    setAiResponse(null)
    setAiError(null)
    setAnalyzing(true)
  }

  // Filter modules
  const filteredModules = useMemo(() => {
    if (!summary) return []
    const q = searchQuery.trim().toLowerCase()
    return summary.modules.filter((mod) => {
      if (filterKind !== 'all' && mod.kind !== filterKind) return false
      if (q && !mod.path.toLowerCase().includes(q)) return false
      return true
    })
  }, [summary, filterKind, searchQuery])

  // Group modules by directory
  const groupedModules = useMemo(() => {
    const groups = new Map<string, ModuleNode[]>()
    for (const mod of filteredModules) {
      const list = groups.get(mod.directory) || []
      list.push(mod)
      groups.set(mod.directory, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filteredModules])

  const selectedNode = useMemo(() => {
    if (!summary || !selectedNodePath) return null
    return summary.modules.find((m) => m.path === selectedNodePath) ?? null
  }, [summary, selectedNodePath])

  // AI Architecture Insight
  const handleAiInsight = async (promptType: 'overview' | 'bottlenecks' | 'dependencies') => {
    if (!summary) return
    setAiGenerating(true)
    setAiError(null)
    setAiResponse('')

    const filesList = summary.modules.map((m) => `${m.path} (${m.linesOfCode} lines, imports: [${m.imports.join(', ')}])`).join('\n')
    const instruction =
      promptType === 'overview'
        ? `Provide a concise, professional architecture overview of the project "${summary.projectName}". Identify key entry points, core responsibilities, and modular structure based on these files:\n${filesList}`
        : promptType === 'bottlenecks'
          ? `Inspect this project dependency graph for circular dependencies, tight coupling, and architectural bottlenecks:\n${filesList}`
          : `Analyze the module dependency relationships and data flow in "${summary.projectName}". Suggest clean dependency boundaries:\n${filesList}`

    try {
      const abortController = new AbortController()
      await streamAssistant({
        settings: aiSettings.settings,
        system: 'You are an expert Principal Software Architect analyzing a real codebase architecture.',
        user: instruction,
        signal: abortController.signal,
        onDelta: (chunk) => {
          setAiResponse((prev) => prev + chunk)
        },
      })

      void logActivity({
        type: 'ai:explain',
        description: `Generated AI Architecture insight (${promptType}) for “${summary.projectName}”`,
        projectId: summary.projectId,
        projectName: summary.projectName,
        status: 'success',
      })
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI generation failed.')
    } finally {
      setAiGenerating(false)
    }
  }

  return (
    <section className={styles.page} aria-labelledby="atlas-title">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/" className={styles.crumbLink}>Command Center</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Project Atlas</span>
      </nav>

      <header className={styles.header}>
        <div className={styles.headCopy}>
          <div className={styles.kicker}>
            <Network size={14} aria-hidden="true" />
            <span>Project Atlas</span>
            <span>·</span>
            <span>Software Architecture &amp; Dependency Intelligence</span>
          </div>
          <h1 id="atlas-title" className={styles.title}>
            Project <span className={styles.titleAccent}>Atlas</span>
          </h1>
          <p className={styles.lead}>
            Analyze the real structural topology, file relationships, module dependencies, and entry points
            extracted directly from stored project source files without fabricated relationships.
          </p>
        </div>

        <div className={styles.headSelector}>
          <select
            aria-label="Active Project"
            className={styles.projectSelect}
            value={selectedProjectId}
            onChange={(e) => handleSelectProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.language})
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={12} className={analyzing ? 'animate-spin' : ''} />}
            onClick={() => selectedProjectId && void runAnalysis(selectedProjectId)}
            disabled={analyzing || !selectedProjectId}
          >
            Refresh
          </Button>
        </div>
      </header>

      {loading ? (
        <p style={{ marginTop: 28, color: 'var(--text-3)' }}>Loading projects…</p>
      ) : projects.length === 0 ? (
        <div className={styles.statCard} style={{ marginTop: 28, textAlign: 'center', padding: 48 }}>
          <FolderTree size={32} style={{ margin: '0 auto 16px', color: 'var(--text-3)' }} />
          <h3>No projects stored in this browser</h3>
          <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 8 }}>
            Create or import a project in Project Vault or the Command Center to analyze its architecture.
          </p>
          <div style={{ marginTop: 20 }}>
            <Link to="/vault" style={{ color: 'var(--cyan)' }}>Go to Project Vault</Link>
          </div>
        </div>
      ) : summary ? (
        <>
          {/* Key Metrics Ribbon */}
          <div className={styles.statsRibbon}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Lines of Code</span>
              <span className={styles.statValue}>{summary.totalLinesOfCode.toLocaleString()}</span>
              <span className={styles.statHint}>Across all stored files</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Project Modules</span>
              <span className={styles.statValue}>{summary.totalFiles}</span>
              <span className={styles.statHint}>{summary.totalFolders} directories</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Entry Points</span>
              <span className={styles.statValue}>{summary.entryPoints.length}</span>
              <span className={styles.statHint}>
                {summary.entryPoints.map((e) => e.name).slice(0, 2).join(', ') || 'Standard files'}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Dependency Density</span>
              <span className={styles.statValue}>{summary.dependencyDensity}</span>
              <span className={styles.statHint}>Average imports per module</span>
            </div>
          </div>

          {/* Languages Breakdown */}
          {summary.languages.length > 0 && (
            <div className={styles.langBarWrap}>
              <div className={styles.langBarHeader}>
                <span className={styles.langBarTitle}>Language Composition</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  {formatBytes(summary.totalSizeBytes)} total
                </span>
              </div>
              <div className={styles.langSegments}>
                {summary.languages.map((l) => (
                  <div
                    key={l.language}
                    className={styles.langSegment}
                    style={{
                      width: `${Math.max(l.percentage, 2)}%`,
                      backgroundColor: LAYER_COLORS[l.language] || 'var(--cyan)',
                    }}
                    title={`${l.language}: ${l.count} files (${l.percentage}%)`}
                  />
                ))}
              </div>
              <div className={styles.langLegend}>
                {summary.languages.map((l) => (
                  <div key={l.language} className={styles.legendItem}>
                    <span
                      className={styles.legendDot}
                      style={{ backgroundColor: LAYER_COLORS[l.language] || 'var(--cyan)' }}
                    />
                    <span>{l.language}</span>
                    <span style={{ color: 'var(--text-3)' }}>{l.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Atlas Canvas & Inspector */}
          <div className={styles.atlasLayout}>
            {/* Left: Interactive Modules Canvas */}
            <div className={styles.canvasCard}>
              <div className={styles.canvasToolbar}>
                <div className={styles.filterGroup}>
                  {(['all', 'entry', 'source', 'config', 'test', 'asset'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={styles.filterChip}
                      data-active={filterKind === kind}
                      onClick={() => setFilterKind(kind)}
                    >
                      {kind === 'all' ? `All (${summary.modules.length})` : kind}
                    </button>
                  ))}
                </div>

                <div className={styles.searchWrap}>
                  <Search size={12} style={{ position: 'absolute', left: 9, color: 'var(--text-3)' }} />
                  <input
                    className={styles.searchInput}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search modules…"
                  />
                </div>
              </div>

              <div className={styles.canvasBody}>
                {groupedModules.length === 0 ? (
                  <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: 32 }}>
                    No modules match the filter.
                  </p>
                ) : (
                  groupedModules.map(([dir, mods]) => (
                    <div key={dir} className={styles.directoryGroup}>
                      <span className={styles.directoryTitle}>
                        <FolderTree size={12} />
                        {dir}/
                      </span>
                      <div className={styles.nodeGrid}>
                        {mods.map((mod) => (
                          <div
                            key={mod.path}
                            className={styles.nodeCard}
                            data-selected={selectedNodePath === mod.path}
                            onClick={() => setSelectedNodePath(mod.path)}
                          >
                            <div className={styles.nodeHead}>
                              <span className={styles.nodeName} title={mod.name}>
                                {mod.name}
                              </span>
                              <span className={styles.nodeKindBadge} data-kind={mod.kind}>
                                {mod.kind}
                              </span>
                            </div>
                            <div className={styles.nodeMeta}>
                              <span>{mod.linesOfCode} lines</span>
                              <div className={styles.nodeDepCount}>
                                <span title="Imports">↑ {mod.imports.length}</span>
                                <span title="Imported by">↓ {mod.importedBy.length}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right: Selected Node Inspector */}
            <aside className={styles.inspectorCard} aria-label="Module inspector">
              {selectedNode ? (
                <>
                  <div className={styles.inspectorHead}>
                    <h3 className={styles.inspectorTitle}>{selectedNode.name}</h3>
                    <span className={styles.inspectorPath}>{selectedNode.path}</span>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <Badge tone="live">{selectedNode.language}</Badge>
                      <Badge tone="planned">{selectedNode.kind}</Badge>
                    </div>
                  </div>

                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Lines of Code</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedNode.linesOfCode}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Size</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{formatBytes(selectedNode.sizeBytes)}</span>
                  </div>

                  <Link
                    to={`/workspace/${summary.projectId}`}
                    className={styles.linkItem}
                    style={{ textAlign: 'center', background: 'var(--cyan-wash)', color: 'var(--ice)', borderColor: 'var(--cyan)' }}
                  >
                    <Code2 size={12} style={{ display: 'inline', marginRight: 6 }} />
                    Open in Editor
                  </Link>

                  {/* Imports */}
                  <div className={styles.sectionBlock}>
                    <span className={styles.sectionTitle}>
                      Direct Dependencies ({selectedNode.imports.length})
                    </span>
                    {selectedNode.imports.length === 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No relative internal imports</span>
                    ) : (
                      <div className={styles.linkList}>
                        {selectedNode.imports.map((imp) => (
                          <button
                            key={imp}
                            type="button"
                            className={styles.linkItem}
                            onClick={() => setSelectedNodePath(imp)}
                            title={`Jump to ${imp}`}
                          >
                            ↑ {imp}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Imported By */}
                  <div className={styles.sectionBlock}>
                    <span className={styles.sectionTitle}>
                      Imported By ({selectedNode.importedBy.length})
                    </span>
                    {selectedNode.importedBy.length === 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No modules import this</span>
                    ) : (
                      <div className={styles.linkList}>
                        {selectedNode.importedBy.map((dep) => (
                          <button
                            key={dep}
                            type="button"
                            className={styles.linkItem}
                            onClick={() => setSelectedNodePath(dep)}
                            title={`Jump to ${dep}`}
                          >
                            ↓ {dep}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Exported Symbols */}
                  {selectedNode.exports.length > 0 && (
                    <div className={styles.sectionBlock}>
                      <span className={styles.sectionTitle}>
                        Exported Symbols ({selectedNode.exports.length})
                      </span>
                      <div className={styles.exportTagList}>
                        {selectedNode.exports.map((exp) => (
                          <span key={exp} className={styles.exportTag}>
                            {exp}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: 'var(--text-3)', fontSize: 12 }}>Select a module to inspect its architecture details.</p>
              )}
            </aside>
          </div>

          {/* AI Project Architecture Understanding */}
          <div className={styles.aiSection}>
            <div className={styles.aiHead}>
              <div className={styles.aiTitleRow}>
                <Sparkles size={16} style={{ color: 'var(--cyan)' }} />
                <h3 className={styles.aiTitle}>AI Architecture Understanding</h3>
              </div>
              <div className={styles.aiButtons}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleAiInsight('overview')}
                  disabled={aiGenerating}
                >
                  Explain Architecture
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleAiInsight('bottlenecks')}
                  disabled={aiGenerating}
                >
                  Analyze Bottlenecks
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleAiInsight('dependencies')}
                  disabled={aiGenerating}
                >
                  Review Dependencies
                </Button>
              </div>
            </div>

            {aiGenerating && !aiResponse && (
              <p style={{ color: 'var(--text-3)', fontSize: 12 }}>Analyzing project architecture topology…</p>
            )}

            {aiError && (
              <p style={{ color: 'var(--danger)', fontSize: 12 }}>{aiError}</p>
            )}

            {aiResponse && (
              <div className={styles.aiOutput}>{aiResponse}</div>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
