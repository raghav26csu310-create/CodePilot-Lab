import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'

import './design-system/tokens.css'
import './design-system/base.css'

import { ErrorBoundary } from './app/ErrorBoundary'
import { App } from './app/App'
import { loadAiSettings } from './features/copilot/settingsStore'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Application root element was not found.')
}

// Restore provider settings once at startup. Nothing is sent; this is a local
// IndexedDB read.
void loadAiSettings()

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
