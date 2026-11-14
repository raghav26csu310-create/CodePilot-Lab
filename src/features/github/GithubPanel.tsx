import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { describeGatewayError, GatewayError } from '../copilot/gateway/client'
import { useGateway } from '../copilot/gateway/store'
import { fetchGithubStatus, type GithubStatus } from './client'
import styles from './GithubPanel.module.css'

type PanelState =
  | { status: 'loading' }
  | { status: 'ready'; data: GithubStatus }
  | { status: 'error'; message: string }

/**
 * Read-only GitHub App configuration report. It never offers a Connect,
 * repository or commit control: those actions need a registered GitHub App and
 * are not implemented in this build. The only control re-checks the real
 * status endpoint.
 */
export function GithubPanel() {
  const gateway = useGateway()
  const signedIn = gateway.user !== null
  const apiReachable = gateway.reachable !== false
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!signedIn || !apiReachable) {
      return
    }

    let cancelled = false
    const controller = new AbortController()

    fetchGithubStatus(controller.signal)
      .then((data) => {
        if (!cancelled) {
          setState({ status: 'ready', data })
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
        setState({
          status: 'error',
          message:
            cause instanceof GatewayError
              ? describeGatewayError(cause)
              : cause instanceof Error && cause.message
                ? cause.message
                : 'The GitHub status request failed.',
        })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [apiReachable, attempt, signedIn])

  const refresh = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }, [])

  if (!apiReachable) {
    return (
      <p className={styles.message}>
        The CodePilot API is unreachable, so the server-side GitHub configuration cannot be
        checked.
      </p>
    )
  }

  if (!signedIn) {
    return (
      <p className={styles.message}>
        Sign in to the CodePilot Cloud account above to check whether the API process has GitHub
        App credentials.
      </p>
    )
  }

  if (state.status === 'loading') {
    return (
      <p className={styles.message} role="status">
        Checking the API process for GitHub App credentials…
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <div className={styles.stack}>
        <p className={styles.message} role="alert">
          {state.message}
        </p>
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={12} />}
          onClick={refresh}
        >
          Re-check
        </Button>
      </div>
    )
  }

  const { data } = state

  return (
    <div className={styles.stack}>
      <Badge tone={data.configured ? 'warn' : 'planned'}>
        {data.configured ? 'Credentials present' : 'Not configured'}
      </Badge>

      {data.missing.length > 0 ? (
        <div>
          <p className={styles.message}>Missing from the API environment:</p>
          <ul className={styles.missing}>
            {data.missing.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className={styles.message}>{data.note}</p>
      <p className={styles.foot}>
        Repository, commit and pull-request actions available: {data.actionsAvailable ? 'yes' : 'no'}.
        This build does not connect to GitHub.
      </p>

      <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={refresh}>
        Re-check
      </Button>
    </div>
  )
}
