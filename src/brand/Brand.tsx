import { Link } from 'react-router-dom'

import styles from './Brand.module.css'

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      className={styles.mark}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M16 3.4 26.5 9.45v12.1L16 27.6 5.5 21.55V9.45Z"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.1"
      />
      <path
        d="m12.5 11.8 4.8 4.2-4.8 4.1"
        stroke="var(--cyan)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.7 20.1h3.2"
        stroke="var(--cyan)"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx="16" cy="3.4" r="1.15" fill="var(--cyan)" />
    </svg>
  )
}

export function Brand() {
  return (
    <Link to="/" className={styles.brand} aria-label="CodePilot Lab — home">
      <BrandMark />
      <span className={styles.wordmark}>
        <span className={styles.name}>Codepilot</span>{' '}
        <span className={styles.lab}>Lab</span>
      </span>
    </Link>
  )
}
