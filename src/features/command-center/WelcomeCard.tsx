import { ArrowRight, BookOpen, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import styles from './WelcomeCard.module.css'

const STORAGE_KEY = 'codepilot.welcome.dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const STEPS = [
  {
    to: '/workspace',
    label: 'Create a project',
    detail: 'Pick a language; a real starter file is written to IndexedDB.',
  },
  {
    to: '/lab',
    label: 'Run and trace',
    detail: 'The loopback sidecar executes Python, JS, TS, C, C++ and Java.',
  },
  {
    to: '/practice',
    label: 'Practise',
    detail: 'Solve original problems graded against private local tests.',
  },
  {
    to: '/convert',
    label: 'Convert code',
    detail: 'Translate between nine languages, review the diff, then save.',
  },
  {
    to: '/settings',
    label: 'Connect a copilot',
    detail: 'Ollama locally, or any OpenAI-compatible endpoint you control.',
  },
]

/**
 * Dismissible first-run orientation. It adds no sample project and disappears
 * only when the user closes it; the preference is a plain localStorage flag.
 */
export function WelcomeCard() {
  const [visible, setVisible] = useState(() => !readDismissed())

  const dismiss = useCallback(() => {
    setVisible(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // A blocked storage flag only means the card reappears next time.
    }
  }, [])

  if (!visible) {
    return null
  }

  return (
    <section className={styles.card} aria-labelledby="welcome-title">
      <div className={styles.inner}>
        <div className={styles.head}>
        <div>
          <p className={styles.kicker}>First run · orientation</p>
          <h2 id="welcome-title" className={styles.title}>
            New here? Start with one real file.
          </h2>
        </div>
        <button type="button" className={styles.dismiss} onClick={dismiss} aria-label="Dismiss welcome card">
          <X size={15} />
        </button>
      </div>

      <p className={styles.lead}>
        CodePilot Lab ships no demo projects and no invented activity. Each step below writes real
        data to this browser or calls a real local runtime.
      </p>

      <ol className={styles.steps}>
        {STEPS.map((step, index) => (
          <li key={step.to}>
            <Link to={step.to} className={styles.step}>
              <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
              <span className={styles.body}>
                <span className={styles.label}>{step.label}</span>
                <span className={styles.detail}>{step.detail}</span>
              </span>
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>

      <p className={styles.foot}>
        <BookOpen size={13} aria-hidden="true" />
        Prefer reading first?{' '}
        <a href="/docs.html">Open the documentation and walkthrough</a>.
      </p>
      </div>
    </section>
  )
}
