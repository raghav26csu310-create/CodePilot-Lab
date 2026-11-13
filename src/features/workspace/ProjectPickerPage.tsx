import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  CircleSlash,
  FileUp,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  ListFilter,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { Skeleton } from '../../design-system/primitives/Skeleton'
import { ProjectDialog } from '../command-center/ProjectDialog'
import {
  createProjectRecord,
  deleteProjectCascade,
  findProjectByName,
  listProjects,
  renameProjectRecord,
  touchProject,
  type ProjectRecord,
} from '../../lib/db'
import { pickTextFile } from '../../lib/diskAccess'
import { formatBytes, formatDate, relativeTime } from '../../lib/format'
import { languageForFile } from '../../lib/projectImport'
import { createStoredEntry, writeStoredContent } from '../../lib/projectStorage'
import { useFocusTrap } from '../../lib/useFocusTrap'
import styles from './ProjectPicker.module.css'

type PickerState =
  | { status: 'loading' }
  | { status: 'ready'; projects: ProjectRecord[] }
  | { status: 'error'; message: string }

type DialogMode = 'create' | 'import'

type RowAction =
  | { mode: 'rename'; project: ProjectRecord }
  | { mode: 'delete'; project: ProjectRecord }

export function ProjectPickerPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<PickerState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  const [rowAction, setRowAction] = useState<RowAction | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false

    listProjects()
      .then((projects) => {
        if (!cancelled) {
          setState({ status: 'ready', projects })
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
        setState({
          status: 'error',
          message:
            cause instanceof Error && cause.message
              ? cause.message
              : 'The local registry could not be read in this browser.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  const closeDialog = useCallback(() => {
    setDialog(null)
    // The dialog may have created a record before the user cancelled elsewhere.
    setAttempt((current) => current + 1)
  }, [])
  const openCreate = useCallback(() => setDialog('create'), [])
  const openImport = useCallback(() => setDialog('import'), [])
  const retry = useCallback(() => setAttempt((current) => current + 1), [])

  const openProject = useCallback(
    async (project: ProjectRecord) => {
      try {
        await touchProject(project.id)
      } catch {
        // The record can still be opened; only the last-opened stamp failed.
      }
      navigate(`/workspace/${project.id}`)
    },
    [navigate],
  )

  const completed = useCallback(
    async (project: ProjectRecord) => {
      setDialog(null)
      try {
        await touchProject(project.id)
      } catch {
        // The new record still opens; only the last-opened stamp failed.
      }
      navigate(`/workspace/${project.id}`)
    },
    [navigate],
  )

  /**
   * Opens one real text file from the device as a single-file project. The
   * browser reads the exact bytes; nothing is linked back to the original path,
   * so the record is honestly a browser copy.
   */
  const openDeviceFile = useCallback(async () => {
    if (opening) {
      return
    }

    setDeviceError(null)
    setOpening(true)
    let createdId: string | null = null

    try {
      const picked = await pickTextFile()
      if (picked.status === 'cancelled') {
        return
      }
      if (picked.status === 'failed') {
        setDeviceError(picked.reason)
        return
      }

      const fileName = picked.name.trim()
      const stem = fileName.replace(/\.[^.]+$/, '').trim() || fileName
      let name = stem
      let suffix = 2
      while (await findProjectByName(name)) {
        name = `${stem} (${suffix})`
        suffix += 1
      }

      const language = languageForFile(fileName) ?? 'Unknown'
      const now = Date.now()

      const project = await createProjectRecord({
        name,
        description: `Opened from the device file “${fileName}”.`,
        language,
        source: 'created',
        modifiedAt: now,
        fileCount: 1,
        sizeBytes: new TextEncoder().encode(picked.content).length,
        manifest: [fileName],
      })
      createdId = project.id

      await createStoredEntry(project.id, '', fileName, 'file')
      await writeStoredContent(project.id, fileName, picked.content)

      try {
        await touchProject(project.id)
      } catch {
        // Opening still works; only the last-opened stamp failed.
      }

      navigate(`/workspace/${project.id}`)
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message
          ? cause.message
          : 'The file could not be turned into a project record.'
      setDeviceError(message)

      if (createdId) {
        try {
          await deleteProjectCascade(createdId)
        } catch {
          // The failed record stays visible rather than silently vanishing.
        }
      }
    } finally {
      setOpening(false)
    }
  }, [navigate, opening])

  const projects = useMemo(
    () => (state.status === 'ready' ? state.projects : []),
    [state],
  )

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) {
      return projects
    }

    return projects.filter((project) => {
      const haystack = `${project.name} ${project.description} ${project.language} ${project.id}`
        .toLocaleLowerCase()
        .trim()
      return haystack.includes(normalized)
    })
  }, [projects, query])

  const totalFiles = projects.reduce((sum, project) => sum + project.fileCount, 0)

  return (
    <section className={styles.page} aria-labelledby="picker-title">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/" className={styles.crumbLink}>
          Command center
        </Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span aria-current="page">Code workspace</span>
      </nav>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className={styles.header}>
          <div className={styles.headCopy}>
            <p className={styles.kicker}>
              Workspace registry
              <span className={styles.kickerSep} aria-hidden="true">
                ·
              </span>
              <span className={styles.kickerMeta}>IndexedDB · this browser</span>
            </p>
            <h1 id="picker-title" className={styles.title}>
              Choose a project<span className={styles.titleAccent}>.</span>
            </h1>
            <p className={styles.lead}>
              Every workspace starts from a record you created or imported. Select one to mount its
              session tree, tabs and panels — or add a new local project.
            </p>
          </div>

          <div className={styles.headActions}>
            <Button size="sm" icon={<FolderPlus size={14} />} onClick={openCreate}>
              New project
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<FolderInput size={14} />}
              onClick={openImport}
            >
              Import folder
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<FileUp size={14} />}
              onClick={() => void openDeviceFile()}
              disabled={opening}
            >
              {opening ? 'Opening…' : 'Open file'}
            </Button>
          </div>
        </header>

        {deviceError ? (
          <div className={styles.deviceError} role="alert">
            <p className={styles.deviceErrorText}>
              <strong>Open file failed.</strong> {deviceError}
            </p>
            <button
              type="button"
              className={styles.deviceErrorClose}
              onClick={() => setDeviceError(null)}
              aria-label="Dismiss open-file error"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search size={14} className={styles.searchIcon} aria-hidden="true" />
            <input
              type="search"
              className={styles.searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search local projects by name, language or description…"
              aria-label="Search local projects"
              spellCheck={false}
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setQuery('')}
                aria-label="Clear project search"
              >
                <X size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className={styles.registryMeta} aria-live="polite">
            <span className={styles.registryCount}>
              {state.status === 'loading'
                ? 'Reading registry'
                : state.status === 'error'
                  ? 'Unavailable'
                  : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
            </span>
            <span className={styles.registrySep} aria-hidden="true" />
            <span>
              {state.status === 'ready' && projects.length > 0
                ? `${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} recorded`
                : 'No seeded data'}
            </span>
          </div>
        </div>

        {state.status === 'loading' ? (
          <div className={styles.list} aria-busy="true" aria-label="Loading local projects">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className={styles.skeletonRow}>
                <Skeleton className={styles.skeletonIndex} />
                <span className={styles.skeletonBody}>
                  <Skeleton style={{ width: '42%', height: 14 }} />
                  <Skeleton style={{ width: '68%', height: 10, marginTop: 9 }} />
                </span>
                <Skeleton className={styles.skeletonChip} />
              </div>
            ))}
          </div>
        ) : state.status === 'error' ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} data-tone="warn" aria-hidden="true">
              <CircleSlash size={21} />
            </span>
            <p className={styles.emptyKicker}>Registry exception</p>
            <h2 className={styles.emptyTitle}>Local registry unavailable</h2>
            <p className={styles.emptyCopy}>
              {state.message} Private browsing or blocked site data can prevent IndexedDB access.
              No project data is invented to fill the gap.
            </p>
            <div className={styles.emptyActions}>
              <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={retry}>
                Try again
              </Button>
              <Button to="/" variant="secondary" size="sm" icon={<ArrowLeft size={14} />}>
                Command center
              </Button>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <FolderOpen size={21} />
            </span>
            <p className={styles.emptyKicker}>Empty registry</p>
            <h2 className={styles.emptyTitle}>No local projects yet</h2>
            <p className={styles.emptyCopy}>
              Create a project record or import a folder from this machine. The registry is never
              seeded — this workspace stays empty until something real exists in it.
            </p>
            <div className={styles.emptyActions}>
              <Button size="sm" icon={<FolderPlus size={14} />} onClick={openCreate}>
                Create project
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<FolderInput size={14} />}
                onClick={openImport}
              >
                Import folder
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<FileUp size={14} />}
                onClick={() => void openDeviceFile()}
                disabled={opening}
              >
                {opening ? 'Opening…' : 'Open file'}
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <ListFilter size={20} />
            </span>
            <p className={styles.emptyKicker}>No matches</p>
            <h2 className={styles.emptyTitle}>Nothing matches “{query.trim()}”</h2>
            <p className={styles.emptyCopy}>
              {projects.length} local {projects.length === 1 ? 'record exists' : 'records exist'},
              but none contain that text in the fields this workspace can search.
            </p>
            <div className={styles.emptyActions}>
              <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                Clear search
              </Button>
            </div>
          </div>
        ) : (
          <ul className={styles.list}>
            {filtered.map((project, index) => (
              <li key={project.id} className={styles.rowItem}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => void openProject(project)}
                  title={`Open ${project.name}`}
                >
                  <span className={styles.rowIndex}>{String(index + 1).padStart(2, '0')}</span>

                  <span className={styles.rowBody}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowName}>{project.name}</span>
                      <span className={styles.rowBadges}>
                        <Badge tone="live" withDot={false}>
                          {project.source === 'created' ? 'Created' : 'Imported'}
                        </Badge>
                        <Badge
                          tone={project.directoryHandle ? 'ok' : 'neutral'}
                          withDot={false}
                        >
                          {project.directoryHandle
                            ? 'Folder linked'
                            : project.fileCount > 0
                              ? 'Manifest only'
                              : 'No files'}
                        </Badge>
                      </span>
                    </span>

                    <span className={styles.rowDescription}>
                      {project.description ||
                        'No description recorded — the metadata below is still real.'}
                    </span>

                    <span className={styles.rowMeta}>
                      <span>{project.language}</span>
                      <span className={styles.rowDot} aria-hidden="true" />
                      <span>
                        {project.fileCount > 0
                          ? `${project.fileCount} manifest files`
                          : 'No manifest files'}
                      </span>
                      <span className={styles.rowDot} aria-hidden="true" />
                      <span>{formatBytes(project.sizeBytes)}</span>
                      <span className={styles.rowDot} aria-hidden="true" />
                      <span>Modified {formatDate(project.modifiedAt)}</span>
                      <span className={styles.rowDot} aria-hidden="true" />
                      <span>Opened {relativeTime(project.lastOpenedAt, now)}</span>
                    </span>
                  </span>

                  <span className={styles.rowSide}>
                    <span className={styles.rowOpens}>
                      <HardDrive size={11} aria-hidden="true" />
                      {project.openCount} {project.openCount === 1 ? 'open' : 'opens'}
                    </span>
                    {project.truncated ? (
                      <span className={styles.rowCap}>Manifest capped</span>
                    ) : null}
                  </span>

                  <span className={styles.rowArrow} aria-hidden="true">
                    <ArrowUpRight size={15} />
                  </span>
                </button>

                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.rowActionButton}
                    disabled={rowAction !== null}
                    onClick={() => setRowAction({ mode: 'rename', project })}
                    aria-label={`Rename ${project.name}`}
                    title={`Rename ${project.name}`}
                  >
                    <Pencil size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`${styles.rowActionButton} ${styles.rowActionDanger}`}
                    disabled={rowAction !== null}
                    onClick={() => setRowAction({ mode: 'delete', project })}
                    aria-label={`Delete ${project.name}`}
                    title={`Delete ${project.name}`}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <footer className={styles.foot}>
          <span className={styles.footNote}>
            <span className={styles.footDot} aria-hidden="true" />
            Projects persist in IndexedDB · run, convert and practise entirely on this machine
          </span>
          <Link to="/" className={styles.footLink}>
            <ArrowLeft size={12} aria-hidden="true" />
            Command center
          </Link>
        </footer>
      </motion.div>

      {createPortal(
        <AnimatePresence>
          {dialog ? (
            <ProjectDialog mode={dialog} onClose={closeDialog} onCompleted={completed} />
          ) : null}
          {rowAction?.mode === 'rename' ? (
            <RenameProjectDialog
              project={rowAction.project}
              onClose={() => setRowAction(null)}
              onRenamed={() => {
                setRowAction(null)
                setAttempt((current) => current + 1)
              }}
            />
          ) : null}
          {rowAction?.mode === 'delete' ? (
            <DeleteProjectDialog
              project={rowAction.project}
              onClose={() => setRowAction(null)}
              onDeleted={() => {
                setRowAction(null)
                setAttempt((current) => current + 1)
              }}
            />
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  )
}

function RenameProjectDialog({
  project,
  onClose,
  onRenamed,
}: {
  project: ProjectRecord
  onClose: () => void
  onRenamed: () => void
}) {
  const [name, setName] = useState(project.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(true, panelRef, onClose)

  const trimmed = name.trim()
  const validation =
    trimmed.length === 0
      ? 'A project needs a name.'
      : trimmed === project.name
        ? null
        : undefined

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) {
      return
    }

    if (trimmed.length === 0) {
      return
    }

    if (trimmed === project.name) {
      onClose()
      return
    }

    setBusy(true)
    setError('')
    try {
      const clash = await findProjectByName(trimmed)
      if (clash && clash.id !== project.id) {
        setError('Another project with this name already exists.')
        setBusy(false)
        return
      }

      const updated = await renameProjectRecord(project.id, trimmed)
      if (!updated) {
        setError('The record disappeared while renaming. Reload the registry.')
        setBusy(false)
        return
      }
      onRenamed()
    } catch {
      setError('IndexedDB rejected this rename. The original name is intact.')
      setBusy(false)
    }
  }

  return (
    <motion.div
      className={styles.modalOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <motion.div
        ref={panelRef}
        className={styles.modalPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-project-title"
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.995 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.modalHead}>
          <div>
            <p className={styles.modalKicker}>Registry · rename project</p>
            <h2 id="rename-project-title" className={styles.modalTitle}>
              Rename “{project.name}”
            </h2>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close dialog">
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <form className={styles.modalForm} onSubmit={submit}>
          <label htmlFor="rename-project-name" className={styles.modalLabel}>
            Project name
          </label>
          <input
            id="rename-project-name"
            className={styles.modalInput}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            data-autofocus
            onFocus={(event) => event.currentTarget.select()}
            aria-invalid={Boolean(validation) || Boolean(error)}
            aria-describedby={error ? 'rename-project-error' : 'rename-project-hint'}
          />

          {error ? (
            <p id="rename-project-error" className={styles.modalError} role="alert">
              {error}
            </p>
          ) : (
            <p id="rename-project-hint" className={styles.modalHint}>
              Renaming updates the registry record and its timestamps. Stored files, tabs and the
              folder link are untouched.
            </p>
          )}

          <div className={styles.modalFoot}>
            <span className={styles.modalNote}>{busy ? 'Renaming…' : 'Writes to IndexedDB'}</span>
            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" icon={<Pencil size={13} />} disabled={busy || Boolean(validation)}>
                Rename
              </Button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: ProjectRecord
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(true, panelRef, onClose)

  const confirm = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await deleteProjectCascade(project.id)
      onDeleted()
    } catch {
      setError('IndexedDB rejected this delete. Nothing was removed.')
      setBusy(false)
    }
  }

  return (
    <motion.div
      className={styles.modalOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <motion.div
        ref={panelRef}
        className={styles.modalPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.995 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.modalHead}>
          <div>
            <p className={styles.modalKicker}>Registry · destructive</p>
            <h2 id="delete-project-title" className={styles.modalTitle}>
              Delete “{project.name}”?
            </h2>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close dialog">
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.modalForm}>
          <div className={styles.modalDangerCard}>
            <span className={styles.modalDangerIcon} aria-hidden="true">
              <Trash2 size={17} />
            </span>
            <div>
              <p className={styles.modalDangerCopy}>
                This permanently removes the project record along with its stored file tree and
                every saved file content from this browser. If a folder is linked, the original
                files on disk are never touched.
              </p>
              <code className={styles.modalDangerPath}>{project.id}</code>
            </div>
          </div>

          {error ? (
            <p className={styles.modalError} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.modalFoot}>
            <span className={styles.modalNote}>{busy ? 'Deleting…' : 'This cannot be undone'}</span>
            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                Keep project
              </Button>
              <button
                type="button"
                className={styles.modalDangerButton}
                onClick={() => void confirm()}
                disabled={busy}
              >
                <Trash2 size={13} aria-hidden="true" />
                Delete from registry
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
