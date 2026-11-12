import { MotionConfig } from 'framer-motion'
import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { CommandCenterPage } from '../features/command-center/CommandCenterPage'
import { FeedbackPage } from '../features/feedback/FeedbackPage'
import { NotFoundPage } from '../features/placeholder/NotFoundPage'
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage'
import { AppShell } from './AppShell'

/*
 * Every Monaco-bearing or data-heavy module is a separate chunk. The Command
 * Center stays eager because it is the landing route; the 3D stage inside it is
 * still behind its own React.lazy boundary.
 */
const ConverterPage = lazy(() =>
  import('../features/converter/ConverterPage').then((module) => ({
    default: module.ConverterPage,
  })),
)
const CopilotOverviewPage = lazy(() =>
  import('../features/copilot/CopilotOverviewPage').then((module) => ({
    default: module.CopilotOverviewPage,
  })),
)
const ExecutionLabPage = lazy(() =>
  import('../features/execution/ExecutionLabPage').then((module) => ({
    default: module.ExecutionLabPage,
  })),
)
const PracticeLibraryPage = lazy(() =>
  import('../features/practice/PracticeLibraryPage').then((module) => ({
    default: module.PracticeLibraryPage,
  })),
)
const PracticeWorkspacePage = lazy(() =>
  import('../features/practice/PracticeWorkspacePage').then((module) => ({
    default: module.PracticeWorkspacePage,
  })),
)
const AiSettingsPage = lazy(() =>
  import('../features/settings/AiSettingsPage').then((module) => ({
    default: module.AiSettingsPage,
  })),
)
const ProjectOverviewRoute = lazy(() =>
  import('../features/workspace/ProjectOverviewPage').then((module) => ({
    default: module.ProjectOverviewRoute,
  })),
)
const ProjectPickerPage = lazy(() =>
  import('../features/workspace/ProjectPickerPage').then((module) => ({
    default: module.ProjectPickerPage,
  })),
)
const ProjectWorkspaceRoute = lazy(() =>
  import('../features/workspace/ProjectWorkspacePage').then((module) => ({
    default: module.ProjectWorkspaceRoute,
  })),
)

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<CommandCenterPage />} />
            <Route path="vault" element={<PlaceholderPage path="/vault" />} />
            <Route path="workspace" element={<ProjectPickerPage />} />
            <Route path="workspace/:projectId" element={<ProjectWorkspaceRoute />} />
            <Route path="workspace/:projectId/overview" element={<ProjectOverviewRoute />} />
            <Route path="copilot" element={<CopilotOverviewPage />} />
            <Route path="atlas" element={<PlaceholderPage path="/atlas" />} />
            <Route path="lab" element={<ExecutionLabPage />} />
            <Route path="convert" element={<ConverterPage />} />
            <Route path="practice" element={<PracticeLibraryPage />} />
            <Route path="practice/:problemId" element={<PracticeWorkspacePage />} />
            <Route path="activity" element={<PlaceholderPage path="/activity" />} />
            <Route path="settings" element={<AiSettingsPage />} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  )
}
