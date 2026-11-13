import { motion } from 'framer-motion'
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  CircleSlash,
  Code2,
  Copy,
  FileText,
  FolderGit2,
  FolderOpen,
  HardDrive,
  ListTree,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { getRouteInfo } from '../../app/routes'
import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { Skeleton } from '../../design-system/primitives/Skeleton'
import { getProject, type ProjectRecord } from '../../lib/db'
import { saveBinaryFile } from '../../lib/diskAccess'
import { formatBytes, formatDate, formatDateTime, relativeTime } from '../../lib/format'
import { archiveFileName, createProjectArchive } from '../../lib/projectArchive'
import {
  collectProjectFiles,
  probeLinkedFolder,
  reconnectLinkedFolder,
  type LinkedFolderProbe,
} from '../../lib/projectStorage'
import styles from './ProjectOverview.module.css'

const MANIFEST_PREVIEW = 24

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; project: ProjectRecord }
  | { status: 'missing' }
  | { status: 'error'; message: string }

type CopyState = 'idle' | 'copied' | 'failed'

export function ProjectOverviewRoute() {
  const { projectId } = useParams<{ projectId: string }>()

  if (!projectId) {
    return <Navigate to="/workspace" replace />
  }

  return <ProjectOverviewPage key={projectId} projectId={projectId} />
}

function ProjectOverviewPage({ projectId }: { projectId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    getProject(projectId)
      .then((project) => {
        if (cancelled) {
          return
        }
        setState(project ? { status: 'ready', project } : { status: 'missing' })
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
  }, [projectId])

  if (state.status === 'loading') {
    return <WorkspaceSkeleton />
  }

  if (state.status === 'missing') {
    return (
      <WorkspaceMessage
        tone="warn"
        title="Project record not found"
        copy="This record does not exist in this browser's IndexedDB. It may have been removed, or the link may come from another profile."
      />
    )
  }

  if (state.status === 'error') {
    return (
      <WorkspaceMessage
        tone="danger"
        title="Local registry unavailable"
        copy={`${state.message} Private browsing or blocked site data can prevent IndexedDB access.`}
      />
    )
  }

  return (
    <ProjectDossier
      project={state.project}
      onProjectChange={(project) => setState({ status: 'ready', project })}
    />
  )
}

function ProjectDossier({
  project,
  onProjectChange,
}: {
  project: ProjectRecord
  onProjectChange: (project: ProjectRecord) => void
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [now] = useState(() => Date.now())
  const [folderState, setFolderState] = useState<LinkedFolderProbe | { status: 'probing' }>({
    status: 'probing',
  })
  const [reconnecting, setReconnecting] = useState(false)
  const [folderMessage, setFolderMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<{
    tone: 'ok' | 'warn' | 'danger'
    text: string
  } | null>(null)
  const workspaceRoute = getRouteInfo('/workspace')

  useEffect(() => {
    let cancelled = false

    probeLinkedFolder(project)
      .then((probe) => {
        if (!cancelled) {
          setFolderState(probe)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFolderState({
            status: 'unsupported',
            reason: 'The browser refused to report folder permissions for this record.',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [project])

  const sourceLabel = project.source === 'created' ? 'Created locally' : 'Imported folder'
  const filesLabel =
    project.fileCount > 0 ? `${project.fileCount} files` : 'No files scanned'
  const preview = project.manifest.slice(0, MANIFEST_PREVIEW)
  const remaining = project.manifest.length - preview.length
  const folderLabel = project.directoryHandle
    ? 'Folder handle stored'
    : project.fileCount > 0
      ? 'Manifest only'
      : 'No folder linked'

  const permissionLabel =
    folderState.status === 'linked'
      ? `Read ${permissionText(folderState.read)} · write ${permissionText(folderState.write)}`
      : folderState.status === 'none'
        ? 'No device folder linked'
        : folderState.status === 'probing'
          ? 'Checking folder permission…'
          : folderState.reason

  const storageOrigin = project.directoryHandle
    ? folderState.status === 'linked' && folderState.write === 'granted'
      ? 'IndexedDB browser copy + linked device folder (writes enabled)'
      : 'IndexedDB browser copy + linked device folder (write access not granted)'
    : 'IndexedDB browser copy only — no device folder linked'

  const copyRecordId = async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard unavailable')
      }
      await navigator.clipboard.writeText(project.id)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const reconnect = async () => {
    if (reconnecting) {
      return
    }

    setReconnecting(true)
    setFolderMessage(null)

    try {
      const result = await reconnectLinkedFolder(project)
      if (result.status === 'cancelled') {
        return
      }
      if (result.status === 'unsupported' || result.status === 'failed') {
        setFolderMessage(result.reason)
        return
      }

      onProjectChange(result.project)
      setFolderMessage(
        result.writeAccess
          ? 'Folder relinked with read and write access. Saving a file now writes the browser copy and the device copy.'
          : `Folder relinked, but write access was not granted. ${
              result.reason ??
              'Saving a file updates the browser copy only; grant write access to write the device copy.'
            }`,
      )
    } catch (cause) {
      setFolderMessage(
        cause instanceof Error && cause.message
          ? cause.message
          : 'The folder could not be relinked.',
      )
    } finally {
      setReconnecting(false)
    }
  }

  const exportArchive = async () => {
    if (exporting) {
      return
    }

    setExporting(true)
    setExportMessage(null)

    try {
      const bundle = await collectProjectFiles(project)
      if (bundle.files.length === 0) {
        setExportMessage({
          tone: 'warn',
          text:
            bundle.unavailable[0]?.reason ??
            'This project has no saved text files to export yet. Save a file in the workspace first.',
        })
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

      if (saved.status === 'cancelled') {
        setExportMessage({ tone: 'warn', text: 'Archive export was cancelled. Nothing was written.' })
        return
      }
      if (saved.status === 'failed') {
        setExportMessage({ tone: 'danger', text: saved.reason })
        return
      }

      const notes: string[] = []
      if (bundle.unavailable.length > 0) {
        notes.push(
          `${bundle.unavailable.length} file${bundle.unavailable.length === 1 ? '' : 's'} unavailable`,
        )
      }
      if (archive.skipped.length > 0) {
        notes.push(
          `${archive.skipped.length} invalid path${archive.skipped.length === 1 ? '' : 's'} skipped`,
        )
      }

      setExportMessage({
        tone: bundle.unavailable.length > 0 ? 'warn' : 'ok',
        text: `${saved.status === 'saved' ? 'Exported' : 'Downloaded'} ${saved.fileName} · ${bundle.files.length} file${bundle.files.length === 1 ? '' : 's'}${notes.length > 0 ? ` · ${notes.join(' · ')}` : ''}`,
      })
    } catch (cause) {
      setExportMessage({
        tone: 'danger',
        text:
          cause instanceof Error && cause.message
            ? cause.message
            : 'The archive could not be created. Nothing was written.',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className={styles.page} aria-labelledby="project-title">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/" className={styles.crumbLink}>
          Command center
        </Link>
        <ChevronRight size={12} aria-hidden="true" />
        <Link to="/workspace" className={styles.crumbLink}>
          Code workspace
        </Link>
        <ChevronRight size={12} aria-hidden="true" />
        <Link to={`/workspace/${project.id}`} className={styles.crumbLink}>
          {project.name}
        </Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span aria-current="page">Overview</span>
      </nav>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className={styles.header}>
          <div className={styles.headCopy}>
            <p className={styles.kicker}>
              Project dossier
              <span className={styles.kickerSep} aria-hidden="true">
                ·
              </span>
              <span className={styles.recordId}>{project.id.slice(0, 8)}</span>
            </p>
            <h1 id="project-title" className={styles.title}>
              {project.name}
            </h1>
            <p className={styles.description}>
              {project.description ||
                'No description was recorded. The record still holds real metadata from this browser.'}
            </p>
            <div className={styles.badges}>
              <Badge tone="live">{sourceLabel}</Badge>
              <Badge tone="live">Workspace live</Badge>
              <Badge tone="planned">GitHub scheduled</Badge>
              <Badge tone="neutral" withDot={false}>
                {project.language}
              </Badge>
            </div>
          </div>

          <div className={styles.headActions}>
            <Button to="/" variant="secondary" size="sm" icon={<ArrowLeft size={14} />}>
              Command center
            </Button>
            <Button
              to={`/workspace/${project.id}`}
              size="sm"
              icon={<Code2 size={13} />}
            >
              Open workspace
            </Button>
          </div>
        </header>

        <dl className={styles.facts}>
          <Fact icon={<FolderGit2 size={14} />} label="Source" value={sourceLabel} />
          <Fact icon={<ListTree size={14} />} label="Files" value={filesLabel} />
          <Fact icon={<HardDrive size={14} />} label="Size" value={formatBytes(project.sizeBytes)} />
          <Fact
            icon={<CalendarDays size={14} />}
            label="Modified"
            value={formatDate(project.modifiedAt)}
            note={relativeTime(project.modifiedAt, now)}
          />
          <Fact
            icon={<FolderOpen size={14} />}
            label="Last opened"
            value={relativeTime(project.lastOpenedAt, now)}
            note={`${project.openCount} ${project.openCount === 1 ? 'open' : 'opens'} recorded`}
          />
          <Fact
            icon={<CalendarDays size={14} />}
            label="Created"
            value={formatDate(project.createdAt)}
            note={formatDateTime(project.createdAt)}
          />
        </dl>

        <div className={styles.grid}>
          <section className={styles.panel} aria-labelledby="manifest-title">
            <div className={styles.panelHead}>
              <div>
                <p className={styles.panelKicker}>Imported manifest</p>
                <h2 id="manifest-title" className={styles.panelTitle}>
                  Project files
                </h2>
              </div>
              <span className={styles.panelMeta}>
                {project.manifest.length > 0
                  ? `${project.manifest.length} recorded`
                  : 'Empty'}
              </span>
            </div>

            {preview.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyIcon} aria-hidden="true">
                  <FileText size={19} />
                </span>
                <p className={styles.emptyTitle}>No file manifest</p>
                <p className={styles.emptyCopy}>
                  {project.source === 'created'
                    ? 'This project was created as a local record. Its workspace starts with an empty session tree — create files and folders there to begin. Entries and saves live in IndexedDB; a linked device folder also receives saves when it grants write access.'
                    : 'The import produced no readable files, so the record has no manifest to display.'}
                </p>
              </div>
            ) : (
              <>
                <ol className={styles.manifest}>
                  {preview.map((path, index) => (
                    <li key={`${path}-${String(index)}`} className={styles.manifestRow}>
                      <span className={styles.manifestIndex}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <FileText size={13} className={styles.manifestIcon} aria-hidden="true" />
                      <code className={styles.manifestPath}>{path}</code>
                    </li>
                  ))}
                </ol>
                <div className={styles.panelFoot}>
                  <span>
                    {remaining > 0
                      ? `Showing first ${MANIFEST_PREVIEW} of ${project.manifest.length} files`
                      : `All ${project.manifest.length} files shown`}
                  </span>
                  {project.truncated ? (
                    <span className={styles.warnChip}>Manifest capped</span>
                  ) : null}
                </div>
              </>
            )}
          </section>

          <div className={styles.aside}>
            <section className={styles.panel} aria-labelledby="editor-state-title">
              <div className={styles.panelHead}>
                <div>
                  <p className={styles.panelKicker}>Workspace surface</p>
                  <h2 id="editor-state-title" className={styles.panelTitle}>
                    Session workspace live
                  </h2>
                </div>
                <Badge tone="live">Device files</Badge>
              </div>
              <div className={styles.panelBody}>
                <p className={styles.panelCopy}>
                  The project explorer, tabs, Copilot dock and development panel are mounted and
                  driven by this record, with a real Monaco editor that saves to IndexedDB and, when
                  the linked folder grants write access, to the device copy. Run and trace go through
                  the loopback execution sidecar; the terminal is a guarded local PTY. GitHub and
                  hosted team features are not configured in this build.
                </p>
                <ol className={styles.planned}>
                  {workspaceRoute.planned.slice(0, 3).map((entry, index) => (
                    <li key={entry}>
                      <span className={styles.plannedNum}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      {entry}
                    </li>
                  ))}
                </ol>
                <Button
                  to={`/workspace/${project.id}`}
                  variant="secondary"
                  size="sm"
                  icon={<Code2 size={13} />}
                  className={styles.panelAction}
                >
                  Open workspace
                </Button>
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="storage-title">
              <div className={styles.panelHead}>
                <div>
                  <p className={styles.panelKicker}>Local record</p>
                  <h2 id="storage-title" className={styles.panelTitle}>
                    Registry facts
                  </h2>
                </div>
              </div>
              <dl className={styles.registry}>
                <div className={styles.registryRow}>
                  <dt>Storage</dt>
                  <dd>{storageOrigin}</dd>
                </div>
                <div className={styles.registryRow}>
                  <dt>Folder</dt>
                  <dd>{folderLabel}</dd>
                </div>
                <div className={styles.registryRow}>
                  <dt>Permission</dt>
                  <dd>{permissionLabel}</dd>
                </div>
                <div className={styles.registryRow}>
                  <dt>Manifest</dt>
                  <dd>
                    {project.truncated
                      ? 'Capped during scan'
                      : project.fileCount > 0
                        ? 'Complete scan'
                        : 'Nothing scanned'}
                  </dd>
                </div>
                <div className={styles.registryRow}>
                  <dt>Excluded</dt>
                  <dd>
                    {project.excluded.length > 0
                      ? project.excluded.join(', ')
                      : 'No excluded folders encountered'}
                  </dd>
                </div>
                <div className={styles.registryRow}>
                  <dt>Record ID</dt>
                  <dd>
                    <code className={styles.registryId}>{project.id}</code>
                    <button
                      type="button"
                      className={styles.copy}
                      onClick={copyRecordId}
                      aria-label="Copy project record ID"
                    >
                      {copyState === 'copied' ? (
                        <>
                          <Check size={12} aria-hidden="true" /> Copied
                        </>
                      ) : copyState === 'failed' ? (
                        <>
                          <CircleSlash size={12} aria-hidden="true" /> Unavailable
                        </>
                      ) : (
                        <>
                          <Copy size={12} aria-hidden="true" /> Copy
                        </>
                      )}
                    </button>
                  </dd>
                </div>
              </dl>
              <div className={styles.storageActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={project.directoryHandle ? <RefreshCw size={13} /> : <FolderOpen size={13} />}
                  onClick={() => void reconnect()}
                  disabled={reconnecting}
                >
                  {reconnecting
                    ? 'Choosing folder…'
                    : project.directoryHandle
                      ? 'Reconnect folder'
                      : 'Link device folder'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Archive size={13} />}
                  onClick={() => void exportArchive()}
                  disabled={exporting}
                >
                  {exporting ? 'Exporting…' : 'Export archive'}
                </Button>
              </div>
              {folderMessage ? (
                <p className={styles.panelNote} role="status">
                  {folderMessage}
                </p>
              ) : null}
              {exportMessage ? (
                <p className={styles.panelNote} data-tone={exportMessage.tone} role="status">
                  {exportMessage.text}
                </p>
              ) : null}
              {project.truncated ? (
                <p className={styles.panelNote}>
                  The manifest hit the import cap. The record is genuine but incomplete.
                </p>
              ) : null}
            </section>
          </div>
        </div>
      </motion.div>
    </section>
  )
}

function permissionText(state: 'granted' | 'prompt' | 'denied' | 'unsupported'): string {
  if (state === 'granted') {
    return 'granted'
  }
  if (state === 'denied') {
    return 'denied'
  }
  if (state === 'unsupported') {
    return 'unsupported'
  }
  return 'asks on use'
}

function Fact({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode
  label: string
  value: string
  note?: string
}) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>
        <span className={styles.factIcon} aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd className={styles.factValue}>{value}</dd>
      {note ? <dd className={styles.factNote}>{note}</dd> : null}
    </div>
  )
}

function WorkspaceSkeleton() {
  return (
    <section className={styles.page} aria-busy="true" aria-label="Loading project record">
      <div className={styles.crumbs}>
        <Skeleton style={{ width: 92, height: 9 }} />
        <Skeleton style={{ width: 110, height: 9 }} />
      </div>
      <div className={styles.header}>
        <div className={styles.headCopy}>
          <Skeleton style={{ width: 160, height: 9 }} />
          <Skeleton style={{ width: 'min(420px, 70%)', height: 42, marginTop: 18 }} />
          <Skeleton style={{ width: 'min(520px, 88%)', height: 11, marginTop: 16 }} />
        </div>
      </div>
      <div className={styles.facts}>
        {[0, 1, 2, 3, 4, 5].map((cell) => (
          <div key={cell} className={styles.fact}>
            <Skeleton style={{ width: 52, height: 8 }} />
            <Skeleton style={{ width: '72%', height: 13, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className={styles.grid}>
        <Skeleton style={{ height: 300 }} />
        <Skeleton style={{ height: 300 }} />
      </div>
    </section>
  )
}

function WorkspaceMessage({
  tone,
  title,
  copy,
}: {
  tone: 'warn' | 'danger'
  title: string
  copy: string
}) {
  return (
    <section className={styles.page} aria-labelledby="workspace-message-title">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/" className={styles.crumbLink}>
          Command center
        </Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span aria-current="page">Workspace</span>
      </nav>

      <div className={styles.message} data-tone={tone}>
        <span className={styles.messageIcon} aria-hidden="true">
          <CircleSlash size={20} />
        </span>
        <h1 id="workspace-message-title" className={styles.messageTitle}>
          {title}
        </h1>
        <p className={styles.messageCopy}>{copy}</p>
        <div className={styles.messageActions}>
          <Button to="/" variant="secondary" size="sm" icon={<ArrowLeft size={14} />}>
            Return to command center
          </Button>
        </div>
      </div>
    </section>
  )
}
