import { CircleAlert, Loader2, LogIn, LogOut, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '../../../design-system/primitives/Button'
import { describeGatewayError, GatewayError } from './client'
import { gatewayRegister, gatewaySignIn, gatewaySignOut, useGateway } from './store'
import styles from './AccountPanel.module.css'

type Mode = 'signin' | 'register'

/**
 * Minimal account surface for the CodePilot API. It covers exactly what the
 * gateway needs today — sign in, create an account, sign out — and shows the
 * real usage the API reports. Password reset, email verification and MFA are
 * not implemented and are not implied here.
 */
export function GatewayAccountPanel() {
  const gateway = useGateway()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signedIn = gateway.user !== null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') {
        await gatewayRegister(email, password, displayName)
      } else {
        await gatewaySignIn(email, password)
      }
      setPassword('')
    } catch (cause) {
      setError(
        cause instanceof GatewayError
          ? describeGatewayError(cause)
          : cause instanceof Error
            ? cause.message
            : 'The account request failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    setError(null)
    try {
      await gatewaySignOut()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign out failed.')
    } finally {
      setBusy(false)
    }
  }

  if (gateway.reachable === false) {
    return (
      <div className={styles.panel} data-state="offline">
        <p className={styles.heading}>CodePilot Cloud is unreachable</p>
        <p className={styles.body}>{gateway.error ?? 'The API did not answer.'}</p>
        <p className={styles.foot}>
          Start the API with <code>npm run api:dev</code>, or set <code>VITE_API_BASE_URL</code> to
          the deployed API origin.
        </p>
      </div>
    )
  }

  if (signedIn) {
    const usage = gateway.status?.usage
    return (
      <div className={styles.panel}>
        <div className={styles.row}>
          <div>
            <p className={styles.heading}>{gateway.user?.displayName}</p>
            <p className={styles.body}>{gateway.user?.email}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void signOut()}
            disabled={busy}
          >
            {busy ? <Loader2 size={14} className={styles.spin} /> : <LogOut size={14} />}
            Sign out
          </Button>
        </div>

        {usage ? (
          <dl className={styles.stats}>
            <div>
              <dt>Requests today</dt>
              <dd>{usage.today.requests}</dd>
            </div>
            <div>
              <dt>Est. tokens this month</dt>
              <dd>{usage.month.estimatedTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Remaining today</dt>
              <dd>{gateway.status?.quota.remainingToday ?? '—'}</dd>
            </div>
          </dl>
        ) : null}

        <p className={styles.foot}>
          {gateway.status?.usageNote ??
            'Usage is reported by the API. Token counts are estimates unless the provider returned real usage.'}
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            <CircleAlert size={13} />
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form className={styles.panel} onSubmit={(event) => void submit(event)}>
      <div className={styles.tabs} role="tablist" aria-label="Account action">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          data-active={mode === 'signin' || undefined}
          onClick={() => setMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          data-active={mode === 'register' || undefined}
          onClick={() => setMode('register')}
        >
          Create account
        </button>
      </div>

      {mode === 'register' ? (
        <label className={styles.field}>
          <span>Display name</span>
          <input
            type="text"
            autoComplete="nickname"
            required
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
      ) : null}

      <label className={styles.field}>
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span>Password</span>
        <input
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'register' ? 10 : 1}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {mode === 'register' ? <small>At least 10 characters.</small> : null}
      </label>

      <Button type="submit" variant="primary" size="sm" disabled={busy}>
        {busy ? (
          <Loader2 size={14} className={styles.spin} />
        ) : mode === 'register' ? (
          <UserPlus size={14} />
        ) : (
          <LogIn size={14} />
        )}
        {mode === 'register' ? 'Create account' : 'Sign in'}
      </Button>

      {error ? (
        <p className={styles.error} role="alert">
          <CircleAlert size={13} />
          {error}
        </p>
      ) : null}

      <p className={styles.foot}>
        Sessions use an HttpOnly cookie. The API stores passwords with scrypt and provider keys with
        AES-256-GCM. Email verification, password reset and MFA are not implemented yet.
      </p>
    </form>
  )
}
