import { createContext, type Dispatch } from 'react'

import type { ProjectRecord } from '../../../lib/db'
import type { WorkspaceAction, WorkspaceState, WorkspaceStats } from './types'

export type WorkspaceController = {
  project: ProjectRecord
  state: WorkspaceState
  dispatch: Dispatch<WorkspaceAction>
  stats: WorkspaceStats
}

export const WorkspaceContext = createContext<WorkspaceController | null>(null)
