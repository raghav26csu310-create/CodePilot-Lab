import { ArrowLeft, CircleSlash, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { Button } from '../../design-system/primitives/Button'
import { Skeleton } from '../../design-system/primitives/Skeleton'
import { getProject, type ProjectRecord } from '../../lib/db'
import { listStoredEntries, prepareProjectStorage } from '../../lib/projectStorage'
import type { TreeEntry } from './state/fileTree'
import { WorkspaceShell } from './components/WorkspaceShell'
import { WorkspaceProvider } from './state/WorkspaceProvider'
import styles from './ProjectWorkspace.module.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; project: ProjectRecord; entries: TreeEntry[] }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export function ProjectWorkspaceRoute() {
  const { projectId } = useParams<{ projectId: string }>()

  if (!projectId) {
    return <Navigate to="/workspace" replace />
  }

  return <ProjectWorkspaceLoader key={projectId} projectId={projectId} />
}

function ProjectWorkspaceLoader({ projectId }: { projectId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    getProject(projectId)
      .then(async (project) => {
        if (cancelled) {
          return
        }

        if (!project) {
          setState({ status: 'missing' })
          return
        }

        await prepareProjectStorage(project)
        const entries = await listStoredEntries(projectId)
        if (cancelled) {
          return
        }

        setState({
          status: 'ready',
          project,
          entries: entries.map((entry) => ({ path: entry.path, kind: entry.kind })),
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
    <WorkspaceProvider project={state.project} entries={state.entries}>
      <WorkspaceShell />
    </WorkspaceProvider>
  )
}

function WorkspaceSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading workspace">
      <div className={styles.skeletonTop}>
        <Skeleton style={{ width: 120, height: 10 }} />
        <Skeleton style={{ width: 210, height: 14 }} />
        <Skeleton style={{ width: 150, height: 28, marginLeft: 'auto' }} />
      </div>
      <div className={styles.skeletonBody}>
        <div className={styles.skeletonRail}>
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <Skeleton key={row} style={{ width: `${64 + (row % 3) * 10}%`, height: 11 }} />
          ))}
        </div>
        <div className={styles.skeletonCenter}>
          <Skeleton style={{ width: '62%', height: 42, marginTop: '6%' }} />
          <Skeleton style={{ width: '80%', height: 12, marginTop: 16 }} />
          <Skeleton style={{ width: '74%', height: 12, marginTop: 8 }} />
          <Skeleton style={{ width: '54%', height: 120, marginTop: 24 }} />
        </div>
        <div className={styles.skeletonRail} />
      </div>
    </div>
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
    <div className={styles.messageWrap}>
      <div className={styles.message} data-tone={tone}>
        <span className={styles.messageIcon} aria-hidden="true">
          <CircleSlash size={20} />
        </span>
        <h1>{title}</h1>
        <p>{copy}</p>
        <div className={styles.messageActions}>
          <Button to="/workspace" variant="secondary" size="sm" icon={<FolderOpen size={14} />}>
            Browse local projects
          </Button>
          <Button to="/" variant="secondary" size="sm" icon={<ArrowLeft size={14} />}>
            Command Center
          </Button>
        </div>
      </div>
    </div>
  )
}
