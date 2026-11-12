import { CheckCircle2, MessageSquare, Send, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Select } from '../../design-system/primitives/Select'
import { Button } from '../../design-system/primitives/Button'
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_LIMITS,
  listFeedback,
  submitFeedback,
  validateFeedback,
  type FeedbackDraft,
  type FeedbackResult,
} from '../../lib/feedback'
import type { FeedbackRecord } from '../../lib/db'
import { formatDate } from '../../lib/format'
import styles from './FeedbackPage.module.css'

const FEATURES = [
  { value: 'public-site', label: 'Public website' },
  { value: 'command-center', label: 'Command Center' },
  { value: 'workspace', label: 'Code Workspace' },
  { value: 'copilot', label: 'AI Copilot' },
  { value: 'lab', label: 'Execution Lab / Tracer' },
  { value: 'practice', label: 'Practice Arena' },
  { value: 'converter', label: 'Code Converter' },
  { value: 'vault', label: 'Project Vault' },
  { value: 'settings', label: 'Settings / Provider setup' },
  { value: 'other', label: 'Something else' },
]

function pageLabel(pathname: string): string {
  return pathname === '/' ? 'Command Center' : pathname
}

export function FeedbackPage({ pathname = '/feedback' }: { pathname?: string }) {
  const [category, setCategory] = useState<FeedbackDraft['category']>('general')
  const [rating, setRating] = useState<number | null>(null)
  const [feature, setFeature] = useState('public-site')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [touch, setTouch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FeedbackResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [recent, setRecent] = useState<FeedbackRecord[]>([])

  const draft = useMemo<FeedbackDraft>(
    () => ({
      category,
      rating,
      feature,
      message,
      contact,
      page: pageLabel(pathname),
    }),
    [category, rating, feature, message, contact, pathname],
  )

  const errors = useMemo(() => validateFeedback(draft), [draft])
  const nameError = touch ? errors.message : undefined

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await listFeedback(3))
    } catch {
      setRecent([])
    }
  }, [])

  useEffect(() => {
    let active = true
    void listFeedback(3)
      .then((rows) => {
        if (active) {
          setRecent(rows)
        }
      })
      .catch(() => {
        if (active) {
          setRecent([])
        }
      })
    return () => {
      active = false
    }
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouch(true)
    setFailure(null)

    if (Object.keys(errors).length > 0) {
      return
    }

    setBusy(true)
    try {
      const outcome = await submitFeedback(draft)
      setResult(outcome)
      setMessage('')
      setContact('')
      setRating(null)
      setTouch(false)
      await loadRecent()
    } catch {
      setFailure(
        'The browser could not write the feedback to IndexedDB. Check that site data is allowed, then try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.page} aria-labelledby="feedback-title">
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Feedback · Public beta</p>
          <h1 id="feedback-title" className={styles.title}>
            Tell us what to fix next
          </h1>
          <p className={styles.lead}>
            Reports are written to this browser&apos;s IndexedDB first. If the operator configured a
            feedback endpoint, the same note is also sent there. The result below always says which
            of those two actually happened — no stand-in “thank you” screen.
          </p>
        </div>
      </header>

      <div className={styles.grid}>
        <form className={styles.card} onSubmit={submit} noValidate>
          <div className={styles.row}>
            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>Category</legend>
              <div className={styles.segmented}>
                {FEEDBACK_CATEGORIES.map((option) => (
                  <label key={option.value} className={styles.segment}>
                    <input
                      type="radio"
                      name="feedback-category"
                      value={option.value}
                      checked={category === option.value}
                      onChange={() => setCategory(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={styles.field}>
              <span className={styles.label} id="feedback-feature-label">
                Feature used
              </span>
              <Select
                value={feature}
                options={FEATURES}
                onChange={setFeature}
                ariaLabel="Feature used"
              />
            </div>
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Experience rating (optional)</legend>
            <div className={styles.ratings} role="radiogroup" aria-label="Experience rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} className={styles.rating}>
                  <input
                    type="radio"
                    name="feedback-rating"
                    value={value}
                    checked={rating === value}
                    onChange={() => setRating(value)}
                  />
                  <span>{value}</span>
                </label>
              ))}
              <button
                type="button"
                className={styles.clearRating}
                onClick={() => setRating(null)}
                disabled={rating === null}
              >
                Clear
              </button>
            </div>
          </fieldset>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="feedback-message">
              Message
            </label>
            <textarea
              id="feedback-message"
              className={styles.textarea}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onBlur={() => setTouch(true)}
              placeholder="What happened, what you expected, and the steps to reproduce it."
              maxLength={FEEDBACK_LIMITS.messageMax}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'feedback-message-error' : undefined}
              rows={7}
            />
            <div className={styles.meta}>
              {nameError ? (
                <span id="feedback-message-error" className={styles.error}>
                  {nameError}
                </span>
              ) : (
                <span>At least {FEEDBACK_LIMITS.messageMin} characters.</span>
              )}
              <span>
                {message.length}/{FEEDBACK_LIMITS.messageMax}
              </span>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="feedback-contact">
              Contact (optional)
            </label>
            <input
              id="feedback-contact"
              className={styles.input}
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="Email or handle, only if you want a reply"
              maxLength={FEEDBACK_LIMITS.contactMax}
              autoComplete="email"
            />
          </div>

          <div className={styles.actions}>
            <Button type="submit" disabled={busy} icon={<Send size={15} />}>
              {busy ? 'Submitting…' : 'Submit feedback'}
            </Button>
            <span className={styles.hint}>
              Page recorded: <code>{pageLabel(pathname)}</code> · v{__APP_VERSION__}
            </span>
          </div>

          {failure ? (
            <p className={styles.alert} data-tone="danger" role="alert">
              <TriangleAlert size={16} />
              {failure}
            </p>
          ) : null}

          {result ? (
            <div
              className={styles.alert}
              data-tone={
                result.delivery === 'endpoint-failed' ? 'warn' : 'ok'
              }
              role="status"
            >
              <CheckCircle2 size={16} />
              <div>
                <strong>
                  {result.delivery === 'local'
                    ? 'Stored in this browser.'
                    : result.delivery === 'endpoint'
                      ? 'Stored locally and delivered to the configured endpoint.'
                      : 'Stored locally, but the configured endpoint rejected it.'}
                </strong>
                <p>
                  {result.delivery === 'local'
                    ? 'No feedback endpoint is configured for this deployment, so the note stays on this device. The operator can read it from the browser profile or connect a destination.'
                    : result.delivery === 'endpoint'
                      ? `The endpoint accepted the payload (HTTP ${result.endpointStatus ?? 200}).`
                      : `${result.endpointError ?? 'The endpoint did not accept the payload.'} Your note is still saved locally with a record of the failed delivery.`}
                </p>
              </div>
            </div>
          ) : null}
        </form>

        <aside className={styles.side}>
          <div className={styles.panel}>
            <h2>
              <MessageSquare size={15} />
              What is stored
            </h2>
            <ul>
              <li>Category, rating, feature label, message and optional contact.</li>
              <li>The route you were on, the app version and the submission time.</li>
              <li>Whether an endpoint accepted the note, plus its HTTP status.</li>
              <li>No analytics identifiers, cookies, code contents or API keys.</li>
            </ul>
            <p>
              Delete your local feedback at any time from{' '}
              <Link to="/settings">Settings → Local data</Link> once you clear this site&apos;s
              storage.
            </p>
          </div>

          <div className={styles.panel}>
            <h2>Recent on this device</h2>
            {recent.length === 0 ? (
              <p>No feedback has been stored in this browser profile yet.</p>
            ) : (
              <ul className={styles.recent}>
                {recent.map((entry) => (
                  <li key={entry.id}>
                    <span className={styles.recentMeta}>
                      {entry.category} · {formatDate(entry.createdAt)} · {entry.delivery}
                    </span>
                    <span>{entry.message.slice(0, 120)}{entry.message.length > 120 ? '…' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.panel}>
            <h2>Security contact</h2>
            <p>
              Do not paste secrets, API keys or private source code. For a suspected vulnerability,
              say only what is needed to reproduce it and leave credentials out.
            </p>
          </div>
        </aside>
      </div>
    </section>
  )
}
