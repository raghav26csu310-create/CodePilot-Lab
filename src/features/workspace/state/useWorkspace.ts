import { useContext } from 'react'

import { WorkspaceContext } from './WorkspaceContext'

export function useWorkspace() {
  const controller = useContext(WorkspaceContext)
  if (!controller) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider')
  }
  return controller
}
