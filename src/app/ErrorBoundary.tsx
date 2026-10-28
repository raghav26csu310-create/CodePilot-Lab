import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '../design-system/primitives/Button'
import styles from './ErrorBoundary.module.css'

type ErrorBoundaryProps = { children: ReactNode }
type ErrorBoundaryState = { error: Error | null }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CodePilot Lab crashed while rendering.', error, info)
  }

  render() {
    const { error } = this.state

    if (!error) {
      return this.props.children
    }

    return (
      <div className={styles.panel}>
        <div className={styles.card} role="alert">
          <p className={styles.eyebrow}>Unhandled error</p>
          <h1 className={styles.title}>The interface stopped rendering.</h1>
          <p className={styles.copy}>
            Nothing was sent anywhere. Reload to restore the application; local data stored by
            later phases is not affected by this screen.
          </p>
          <pre className={styles.detail}>{error.message}</pre>
          <div className={styles.actions}>
            <Button onClick={() => window.location.reload()}>Reload application</Button>
          </div>
        </div>
      </div>
    )
  }
}
