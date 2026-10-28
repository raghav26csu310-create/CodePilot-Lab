import { ArrowLeft } from 'lucide-react'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { getRouteInfo, ROUTES } from '../../app/routes'
import styles from './PlaceholderPage.module.css'

export function PlaceholderPage({ path }: { path: string }) {
  const route = getRouteInfo(path)
  const index = ROUTES.findIndex((entry) => entry.path === path) + 1

  return (
    <section className={styles.page} aria-labelledby="module-title">
      <div className={styles.head}>
        <div className={styles.meta}>
          <span>Module {String(index).padStart(2, '0')} / 07</span>
          <span aria-hidden="true">·</span>
          <span>Scheduled</span>
        </div>
        <Badge tone="planned">{route.phase}</Badge>
      </div>

      <div className={styles.titleRow}>
        <h1 id="module-title" className={styles.title}>
          {route.label}
        </h1>
        <span className={styles.index} aria-hidden="true">
          {String(index).padStart(2, '0')}
        </span>
      </div>

      <p className={styles.lead}>{route.tagline}</p>

      <div className={styles.grid}>
        <div>
          <h2 className={styles.sectionLabel}>Planned capabilities</h2>
          <ol className={styles.planned}>
            {route.planned.map((item, position) => (
              <li key={item}>
                <span className={styles.num}>{String(position + 1).padStart(2, '0')}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>

        <aside className={styles.panel} aria-label="Current module state">
          <span className={styles.panelLabel}>Current state</span>
          <p className={styles.panelTitle}>Not built yet.</p>
          <p className={styles.panelCopy}>
            This module arrives in {route.phase}. Nothing here is simulated: no sample projects,
            metrics or activity are shown because none exist yet.
          </p>
          <div className={styles.panelActions}>
            <Button to="/" variant="secondary" size="sm" icon={<ArrowLeft size={14} />}>
              Return to command center
            </Button>
          </div>
          <p className={styles.phaseNote}>Phase 01 · this page intentionally contains no data</p>
        </aside>
      </div>
    </section>
  )
}
