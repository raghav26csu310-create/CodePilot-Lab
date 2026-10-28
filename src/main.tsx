import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'

import './design-system/tokens.css'
import './design-system/base.css'

import { ErrorBoundary } from './app/ErrorBoundary'
import { App } from './app/App'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Application root element was not found.')
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
