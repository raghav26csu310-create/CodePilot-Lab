import { ArrowUpRight, CircleSlash, FolderInput, FolderOpen, FolderPlus, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../design-system/primitives/Button'
import { Skeleton } from '../../design-system/primitives/Skeleton'
import { listRecentProjects, type ProjectRecord } from '../../lib/db'
import { relativeTime } from '../../lib/format'
import styles from './CommandCenter.module.css'

type ProjectRow = ProjectRecord & {
  openedLabel: string
  modifiedLabel: string
}

type ProjectsState =
  | { status: 'loading' }
  | { status: 'ready'; projects: ProjectRow[] }
  | { status: 'error'; message: string }

type RecentProjectsProps = {
  onCreate: () => void
  onImport: () => void
  onOpen: (project: ProjectRecord) => void
}

function statusLabel(project: ProjectRecord): string {
  if (project.source === 'created') {
    return 'No files yet'
  }
  return project.directoryHandle ? 'Folder linked' : 'Manifest only'
}

export function RecentProjects({ onCreate, onImport, onOpen }: RecentProjectsProps) {
  const [state, setState] = useState<ProjectsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    listRecentProjects(6)
      .then((rows) => {
        if (cancelled) {
          return
        }

        const now = Date.now()
        setState({
          status: 'ready',
          projects: rows.map((project) => ({
            ...project,
            openedLabel: relativeTime(project.lastOpenedAt, now),
            modifiedLabel: relativeTime(project.modifiedAt, now),
          })),
        })
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

  const retry = () => setAttempt((current) => current + 1)

  return (
    <section className={styles.panel} aria-labelledby="recent-projects-title">
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelKicker}>Project activity</p>
          <h2 id="recent-projects-title" className={styles.panelTitle}>
            Recent projects
          </h2>
        </div>
        <span className={styles.panelMeta}>
          {state.status === 'loading'
            ? 'Reading registry'
            : state.status === 'error'
              ? 'Unavailable'
              : `${state.projects.length} local ${
                  state.projects.length === 1 ? 'record' : 'records'
                }`}
        </span>
      </div>

      {state.status === 'loading' ? (
        <div className={styles.skeletonList} aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className={styles.skeletonRow}>
              <Skeleton className={styles.skeletonIndex} />
              <span className={styles.skeletonBody}>
                <Skeleton className={styles.skeletonName} />
                <Skeleton className={styles.skeletonMeta} />
              </span>
              <Skeleton className={styles.skeletonChip} />
            </div>
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} data-tone="warn" aria-hidden="true">
            <CircleSlash size={20} />
          </span>
          <p className={styles.emptyTitle}>Local registry unavailable</p>
          <p className={styles.emptyCopy}>
            {state.message} Private browsing or blocked site data can prevent IndexedDB access.
          </p>
          <div className={styles.emptyActions}>
            <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={retry}>
              Try again
            </Button>
            <Button size="sm" icon={<FolderPlus size={14} />} onClick={onCreate}>
              Create project
            </Button>
          </div>
        </div>
      ) : state.projects.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <FolderOpen size={20} />
          </span>
          <p className={styles.emptyTitle}>No local projects yet</p>
          <p className={styles.emptyCopy}>
            Create a project record or import a folder. Nothing is seeded — this list stays empty
            until you add something real.
          </p>
          <div className={styles.emptyActions}>
            <Button size="sm" icon={<FolderPlus size={14} />} onClick={onCreate}>
              Create project
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<FolderInput size={14} />}
              onClick={onImport}
            >
              Import folder
            </Button>
          </div>
        </div>
      ) : (
        <ul className={styles.projectList}>
          {state.projects.map((project, index) => (
            <li key={project.id}>
              <button
                type="button"
                className={styles.projectRow}
                onClick={() => onOpen(project)}
                title={`Last opened ${project.openedLabel}`}
              >
                <span className={styles.rowIndex}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.rowBody}>
                  <span className={styles.rowName}>{project.name}</span>
                  <span className={styles.rowMeta}>
                    <span>{project.language}</span>
                    <span className={styles.rowDot} aria-hidden="true" />
                    <span>
                      {project.fileCount > 0
                        ? `${project.fileCount} files`
                        : 'No file manifest'}
                    </span>
                    <span className={styles.rowDot} aria-hidden="true" />
                    <span>Modified {project.modifiedLabel}</span>
                  </span>
                </span>
                <span className={styles.rowChip}>{statusLabel(project)}</span>
                <ArrowUpRight size={15} className={styles.rowArrow} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.panelFoot}>
        <span className={styles.panelFootNote}>
          {state.status === 'error'
            ? 'Storage blocked in this browser'
            : state.status === 'ready' && state.projects.length > 0
              ? 'Sorted by last opened · stored in this browser'
              : 'Local registry · IndexedDB'}
        </span>
        {state.status === 'ready' && state.projects.length > 0 ? (
          <button type="button" className={styles.footAction} onClick={onCreate}>
            New project
          </button>
        ) : null}
      </div>
    </section>
  )
}
