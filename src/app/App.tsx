import { MotionConfig } from 'framer-motion'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { CommandCenterPage } from '../features/command-center/CommandCenterPage'
import { NotFoundPage } from '../features/placeholder/NotFoundPage'
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage'
import { AppShell } from './AppShell'

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<CommandCenterPage />} />
            <Route path="vault" element={<PlaceholderPage path="/vault" />} />
            <Route path="workspace" element={<PlaceholderPage path="/workspace" />} />
            <Route path="atlas" element={<PlaceholderPage path="/atlas" />} />
            <Route path="lab" element={<PlaceholderPage path="/lab" />} />
            <Route path="activity" element={<PlaceholderPage path="/activity" />} />
            <Route path="settings" element={<PlaceholderPage path="/settings" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  )
}
