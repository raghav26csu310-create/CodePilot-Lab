import { ArrowLeft } from 'lucide-react'

import { Button } from '../../design-system/primitives/Button'
import styles from './PlaceholderPage.module.css'

export function NotFoundPage() {
  return (
    <section className={styles.page} aria-labelledby="not-found-title">
      <div className={styles.head}>
        <div className={styles.meta}>
          <span>Module 00 / 07</span>
          <span aria-hidden="true">·</span>
          <span>Unresolved route</span>
        </div>
      </div>

      <div className={styles.titleRow}>
        <h1 id="not-found-title" className={styles.title}>
          Not found
        </h1>
        <span className={styles.index} aria-hidden="true">
          404
        </span>
      </div>

      <p className={styles.lead}>
        This address does not map to a module in CodePilot Lab. No redirect was invented; use the
        command center to choose a real destination.
      </p>

      <div style={{ marginTop: '2.5rem' }}>
        <Button to="/" variant="secondary" icon={<ArrowLeft size={14} />}>
          Return to command center
        </Button>
      </div>
    </section>
  )
}
