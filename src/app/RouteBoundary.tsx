import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import styles from './RouteBoundary.module.css'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Keeps a route-level failure inside the shell: navigation stays usable and the
 * user gets the real error text plus a reload path instead of a blank screen.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[route] render failed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.boundary} role="alert">
          <p className={styles.kicker}>Route error</p>
          <h1>This screen stopped rendering.</h1>
          <p className={styles.lead}>
            The failure was contained here; the rest of the app is still running. Nothing was
            saved on your behalf. Reload the route to try again.
          </p>
          <pre className={styles.error}>{this.state.error.message}</pre>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.reload}
              onClick={() => window.location.reload()}
            >
              Reload application
            </button>
            <Link className={styles.home} to="/">
              Back to Command Center
            </Link>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export function RouteFallback() {
  return (
    <div className={styles.fallback} aria-live="polite" aria-busy="true">
      <span className={styles.spinner} aria-hidden="true" />
      <span>Loading module…</span>
    </div>
  )
}
