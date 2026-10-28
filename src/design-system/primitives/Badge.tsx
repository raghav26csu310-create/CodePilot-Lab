import type { ReactNode } from 'react'

import styles from './Badge.module.css'

type BadgeTone = 'live' | 'ok' | 'warn' | 'planned' | 'neutral'

export function Badge({
  children,
  tone = 'neutral',
  withDot = true,
}: {
  children: ReactNode
  tone?: BadgeTone
  withDot?: boolean
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {withDot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
