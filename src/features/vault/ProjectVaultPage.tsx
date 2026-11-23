import { AnimatePresence, motion } from 'framer-motion'
import {
  Archive,
  Code2,
  Copy,
  FolderGit2,
  FolderInput,
  FolderPlus,
  Network,
  Pencil,
  Search,
  Star,
  Trash2,
  Vault,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { ProjectDialog } from '../command-center/ProjectDialog'
import {
  deleteProjectCascade,
  duplicateProjectCascade,
  listProjects,
  probeStorage,
  renameProjectRecord,
  toggleProjectPin,
  type ProjectRecord,
  type StorageSnapshot,
} from '../../lib/db'
import { formatBytes, formatDate, relativeTime } from '../../lib/format'
import { logActivity } from '../../lib/activityService'
import { saveBinaryFile } from '../../lib/diskAccess'
import { archiveFileName, createProjectArchive } from '../../lib/projectArchive'
import { collectProjectFiles } from '../../lib/projectStorage'
import styles from './ProjectVault.module.css'

type SortOption = 'lastOpened' | 'modified' | 'created' | 'name' | 'size' | 'files'
type FilterOption = 'all' | 'pinned' | 'created' | 'imported' | 'linked'

type ModalAction =
  | { type: 'rename'; project: ProjectRecord }
  | { type: 'duplicate'; project: ProjectRecord }
  | { type: 'delete'; project: ProjectRecord }

export function ProjectVaultPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [storage, setStorage] = useState<StorageSnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('lastOpened')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [dialogMode, setDialogMode] = useState<'create' | 'import' | null>(null)
  const [modalAction, setModalAction] = useState<ModalAction | null>(null)
  const [actionInput, setActionInput] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  const loadData = useCallback(async () => {
    try {
      const [list, storageInfo] = await Promise.all([listProjects(), probeStorage()])
      setProjects(list)
      setStorage(storageInfo)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects
      .filter((project) => {
        if (q) {
          const matchName = project.name.toLowerCase().includes(q)
          const matchDesc = project.description.toLowerCase().includes(q)
          const matchLang = project.language.toLowerCase().includes(q)
          if (!matchName && !matchDesc && !matchLang) return false
        }
        if (filterBy === 'pinned') return project.pinned === true
        if (filterBy === 'created') return project.source === 'created'
        if (filterBy === 'imported') return project.source === 'imported'
        if (filterBy === 'linked') return Boolean(project.directoryHandle)
        return true
      })
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1
        if (!a.pinned && b.pinned) return 1
        switch (sortBy) {
          case 'name':
            return a.name.localeCompare(b.name)
          case 'created':
            return b.createdAt - a.createdAt
          case 'modified':
            return b.modifiedAt - a.modifiedAt
          case 'size':
            return b.sizeBytes - a.sizeBytes
          case 'files':
            return b.fileCount - a.fileCount
          case 'lastOpened':
          default:
            return b.lastOpenedAt - a.lastOpenedAt
        }
      })
  }, [projects, query, filterBy, sortBy])

  const handleTogglePin = async (project: ProjectRecord) => {
    const nextPinned = await toggleProjectPin(project.id)
    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, pinned: nextPinned } : p)),
    )
    showToast(nextPinned ? `Pinned “${project.name}”` : `Unpinned “${project.name}”`)
  }

  const handleExportZip = async (project: ProjectRecord) => {
    try {
      showToast('Collecting project files for export…')
      const bundle = await collectProjectFiles(project)
      if (bundle.files.length === 0) {
        showToast('No saved files to export.')
        return
      }
      const archive = await createProjectArchive({
        name: project.name,
        description: project.description,
        language: project.language,
        source: project.source,
        files: bundle.files,
      })
      const saved = await saveBinaryFile({
        suggestedName: archiveFileName(project.name),
        bytes: archive.bytes,
        mimeType: 'application/zip',
        description: 'CodePilot Lab project archive',
        extensions: ['.zip'],
      })
      if (saved.status === 'saved' || saved.status === 'downloaded') {
        showToast(`Exported ${project.name} archive`)
        void logActivity({
          type: 'project:open',
          description: `Exported ZIP archive for “${project.name}”`,
          projectId: project.id,
          projectName: project.name,
          status: 'success',
        })
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  const handleExecuteModalAction = async () => {
    if (!modalAction || busy) return
    setBusy(true)
    setActionError(null)

    try {
      if (modalAction.type === 'rename') {
        const trimmed = actionInput.trim()
        if (trimmed.length < 2) {
          setActionError('Project name must be at least 2 characters.')
          return
        }
        const updated = await renameProjectRecord(modalAction.project.id, trimmed)
        if (updated) {
          setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
          void logActivity({
            type: 'project:rename',
            description: `Renamed “${modalAction.project.name}” to “${trimmed}”`,
            projectId: updated.id,
            projectName: updated.name,
            status: 'success',
          })
          showToast(`Renamed project to “${trimmed}”`)
        }
      } else if (modalAction.type === 'duplicate') {
        const trimmed = actionInput.trim()
        if (trimmed.length < 2) {
          setActionError('Project name must be at least 2 characters.')
          return
        }
        const duplicated = await duplicateProjectCascade(modalAction.project.id, trimmed)
        setProjects((prev) => [duplicated, ...prev])
        showToast(`Created duplicate project “${trimmed}”`)
      } else if (modalAction.type === 'delete') {
        await deleteProjectCascade(modalAction.project.id)
        setProjects((prev) => prev.filter((p) => p.id !== modalAction.project.id))
        void logActivity({
          type: 'project:delete',
          description: `Deleted project “${modalAction.project.name}” and all stored entries`,
          status: 'success',
        })
        showToast(`Deleted “${modalAction.project.name}”`)
      }
      setModalAction(null)
      setActionInput('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }

  const totalFiles = projects.reduce((acc, p) => acc + (p.fileCount || 0), 0)
  const totalBytes = projects.reduce((acc, p) => acc + (p.sizeBytes || 0), 0)
  const pinnedCount = projects.filter((p) => p.pinned).length

  return (
    <section className={styles.page} aria-labelledby="vault-title">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/" className={styles.crumbLink}>Command Center</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Project Vault</span>
      </nav>

      <header className={styles.header}>
        <div className={styles.headCopy}>
          <div className={styles.kicker}>
            <Vault size={14} aria-hidden="true" />
            <span>Project Vault</span>
            <span className={styles.kickerSep}>·</span>
            <span className={styles.kickerMeta}>Persistent Storage &amp; Archive Management</span>
          </div>
          <h1 id="vault-title" className={styles.title}>
            Project <span className={styles.titleAccent}>Vault</span>
          </h1>
          <p className={styles.lead}>
            Manage all local-first projects, templates, archives and linked directory handles.
            All projects are persisted in IndexedDB and load directly into the IDE workspace.
          </p>
        </div>

        <div className={styles.headActions}>
          <Button
            type="button"
            variant="primary"
            icon={<FolderPlus size={14} />}
            onClick={() => setDialogMode('create')}
          >
            Create project
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={<FolderInput size={14} />}
            onClick={() => setDialogMode('import')}
          >
            Import project
          </Button>
        </div>
      </header>

      {/* Summary Ribbon */}
      <div className={styles.statsRibbon}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Projects</span>
          <span className={styles.statValue}>{projects.length}</span>
          <span className={styles.statHint}>{pinnedCount} pinned / favourite</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Stored Files</span>
          <span className={styles.statValue}>{totalFiles}</span>
          <span className={styles.statHint}>Across all workspaces</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Project Data</span>
          <span className={styles.statValue}>{formatBytes(totalBytes)}</span>
          <span className={styles.statHint}>
            {storage?.usage ? `${formatBytes(storage.usage)} browser total` : 'IndexedDB managed'}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Persistence</span>
          <span className={styles.statValue}>Local-First</span>
          <span className={styles.statHint}>Private, durable offline storage</span>
        </div>
      </div>

      {/* Controls Bar */}
      <div className={styles.controlsBar}>
        <div className={styles.searchWrap}>
          <Search size={14} />
          <input
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, languages, descriptions..."
          />
        </div>

        <div className={styles.filterGroup}>
          <button
            type="button"
            className={styles.filterChip}
            data-active={filterBy === 'all'}
            onClick={() => setFilterBy('all')}
          >
            All ({projects.length})
          </button>
          <button
            type="button"
            className={styles.filterChip}
            data-active={filterBy === 'pinned'}
            onClick={() => setFilterBy('pinned')}
          >
            ★ Pinned ({pinnedCount})
          </button>
          <button
            type="button"
            className={styles.filterChip}
            data-active={filterBy === 'created'}
            onClick={() => setFilterBy('created')}
          >
            Created Locally
          </button>
          <button
            type="button"
            className={styles.filterChip}
            data-active={filterBy === 'imported'}
            onClick={() => setFilterBy('imported')}
          >
            Imported Folders
          </button>
          <button
            type="button"
            className={styles.filterChip}
            data-active={filterBy === 'linked'}
            onClick={() => setFilterBy('linked')}
          >
            Folder Linked
          </button>
        </div>

        <div className={styles.sortGroup}>
          <label htmlFor="vault-sort" className={styles.sortLabel}>
            Sort:
          </label>
          <select
            id="vault-sort"
            className={styles.sortSelect}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
          >
            <option value="lastOpened">Last Opened</option>
            <option value="modified">Recently Modified</option>
            <option value="created">Created Date</option>
            <option value="name">Name (A-Z)</option>
            <option value="size">Size (Largest)</option>
            <option value="files">File Count</option>
          </select>
        </div>
      </div>

      {/* Project Cards Grid */}
      {loading ? (
        <div className={styles.grid}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.card} style={{ height: 260, opacity: 0.5 }}>
              Loading workspace metadata…
            </div>
          ))}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Vault size={24} />
          </div>
          <h2 className={styles.emptyTitle}>
            {query || filterBy !== 'all' ? 'No matching projects' : 'No projects in vault yet'}
          </h2>
          <p className={styles.emptyCopy}>
            {query || filterBy !== 'all'
              ? 'Try adjusting your search terms or filter selections.'
              : 'Create a new project from standard templates or import an existing codebase directory.'}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button
              type="button"
              variant="primary"
              icon={<FolderPlus size={14} />}
              onClick={() => setDialogMode('create')}
            >
              Create project
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon={<FolderInput size={14} />}
              onClick={() => setDialogMode('import')}
            >
              Import folder
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredProjects.map((project) => (
            <motion.article
              key={project.id}
              className={styles.card}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className={styles.cardHead}>
                <div className={styles.cardIdentity}>
                  <div className={styles.cardTitleRow}>
                    <h2 className={styles.cardTitle} title={project.name}>
                      {project.name}
                    </h2>
                    <button
                      type="button"
                      className={styles.pinButton}
                      data-pinned={project.pinned}
                      onClick={() => handleTogglePin(project)}
                      title={project.pinned ? 'Unpin project' : 'Pin project as favourite'}
                      aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
                    >
                      <Star size={14} fill={project.pinned ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <p className={styles.cardDesc}>
                    {project.description || 'No description provided.'}
                  </p>
                </div>
              </div>

              <div className={styles.cardBadges}>
                <Badge tone="live">{project.language}</Badge>
                <Badge tone={project.directoryHandle ? 'live' : 'planned'}>
                  {project.directoryHandle ? 'Folder linked' : 'Browser copy'}
                </Badge>
                <Badge tone="planned">
                  {project.source === 'created' ? 'Template' : 'Import'}
                </Badge>
              </div>

              <div className={styles.metaGrid}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Files &amp; Size</span>
                  <span className={styles.metaValue}>
                    {project.fileCount} files · {formatBytes(project.sizeBytes)}
                  </span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Last Opened</span>
                  <span className={styles.metaValue}>{relativeTime(project.lastOpenedAt, now)}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Modified</span>
                  <span className={styles.metaValue}>{formatDate(project.modifiedAt)}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Created</span>
                  <span className={styles.metaValue}>{formatDate(project.createdAt)}</span>
                </div>
              </div>

              <div className={styles.cardActions}>
                <div className={styles.actionRow}>
                  <Link
                    to={`/workspace/${project.id}`}
                    className={styles.openLink}
                    title="Open in Main IDE Workspace"
                  >
                    <Code2 size={13} />
                    Open IDE
                  </Link>
                  <Link
                    to={`/atlas?project=${project.id}`}
                    className={styles.iconButton}
                    title="Open in Project Atlas (Architecture Map)"
                  >
                    <Network size={13} />
                  </Link>
                  <Link
                    to={`/workspace/${project.id}/overview`}
                    className={styles.iconButton}
                    title="View Project Dossier"
                  >
                    <FolderGit2 size={13} />
                  </Link>
                </div>

                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => handleExportZip(project)}
                    title="Export as ZIP archive"
                  >
                    <Archive size={13} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => {
                      setModalAction({ type: 'duplicate', project })
                      setActionInput(`${project.name} Copy`)
                      setActionError(null)
                    }}
                    title="Duplicate project"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => {
                      setModalAction({ type: 'rename', project })
                      setActionInput(project.name)
                      setActionError(null)
                    }}
                    title="Rename project"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    data-tone="danger"
                    onClick={() => {
                      setModalAction({ type: 'delete', project })
                      setActionError(null)
                    }}
                    title="Delete project"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      )}

      {/* Creation / Import Dialog */}
      <AnimatePresence>
        {dialogMode ? (
          <ProjectDialog
            mode={dialogMode}
            onClose={() => setDialogMode(null)}
            onCompleted={(newProject) => {
              setDialogMode(null)
              void loadData()
              void logActivity({
                type: 'project:create',
                description: `Created new project “${newProject.name}”`,
                projectId: newProject.id,
                projectName: newProject.name,
                status: 'success',
              })
              navigate(`/workspace/${newProject.id}`)
            }}
          />
        ) : null}
      </AnimatePresence>

      {/* Rename / Duplicate / Delete Modal */}
      <AnimatePresence>
        {modalAction ? (
          <div className={styles.modalBackdrop}>
            <div className={styles.modal} role="dialog" aria-modal="true">
              <div className={styles.modalHead}>
                <h3 className={styles.modalTitle}>
                  {modalAction.type === 'rename' && `Rename “${modalAction.project.name}”`}
                  {modalAction.type === 'duplicate' && `Duplicate “${modalAction.project.name}”`}
                  {modalAction.type === 'delete' && `Delete “${modalAction.project.name}”?`}
                </h3>
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={() => setModalAction(null)}
                >
                  <X size={15} />
                </button>
              </div>

              <div className={styles.modalBody}>
                {modalAction.type === 'delete' ? (
                  <p className={styles.modalCopy}>
                    Are you sure you want to delete <strong>{modalAction.project.name}</strong>?
                    All {modalAction.project.fileCount} stored files and contents in IndexedDB will be
                    permanently removed. This cannot be undone.
                  </p>
                ) : (
                  <>
                    <label htmlFor="modal-name-input" className={styles.statLabel}>
                      {modalAction.type === 'rename' ? 'New Project Name' : 'Duplicate Project Name'}
                    </label>
                    <input
                      id="modal-name-input"
                      className={styles.modalInput}
                      value={actionInput}
                      onChange={(e) => setActionInput(e.target.value)}
                      placeholder="Project name"
                      autoFocus
                    />
                  </>
                )}

                {actionError ? (
                  <p style={{ color: 'var(--danger)', fontSize: 12 }}>{actionError}</p>
                ) : null}
              </div>

              <div className={styles.modalActions}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setModalAction(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleExecuteModalAction}
                  disabled={busy || (modalAction.type !== 'delete' && !actionInput.trim())}
                >
                  {busy
                    ? 'Working…'
                    : modalAction.type === 'delete'
                      ? 'Delete project'
                      : modalAction.type === 'rename'
                        ? 'Rename'
                        : 'Duplicate'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* Vault Toast Notification */}
      {toastMessage ? (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1000,
            padding: '10px 18px',
            borderRadius: 6,
            background: 'var(--midnight)',
            border: '1px solid var(--hairline-accent)',
            color: 'var(--ice)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          {toastMessage}
        </div>
      ) : null}
    </section>
  )
}
