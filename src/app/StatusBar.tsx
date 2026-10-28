import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import { useWebGLSupport } from '../lib/useWebGLSupport'
import styles from './StatusBar.module.css'

export function StatusBar() {
  const webgl = useWebGLSupport()
  const reducedMotion = usePrefersReducedMotion()

  const renderLabel =
    webgl === 'none'
      ? 'Static render'
      : `${webgl === 'webgl2' ? 'WebGL 2' : 'WebGL 1'} · Ready`

  return (
    <footer className={styles.status} aria-label="System status">
      <div className={styles.inner}>
        <div className={styles.group}>
          <span className={styles.item}>
            <span
              className={styles.signal}
              data-tone={webgl === 'none' ? 'warn' : 'ok'}
              aria-hidden="true"
            />
            {renderLabel}
          </span>
          <span className={styles.sep} aria-hidden="true" />
          <span className={styles.item}>Motion {reducedMotion ? 'reduced' : 'full'}</span>
          <span className={`${styles.sep} ${styles.hideSm}`} aria-hidden="true" />
          <span className={`${styles.item} ${styles.hideSm}`}>Local only</span>
        </div>

        <div className={styles.group}>
          <span className={`${styles.item} ${styles.hideSm}`}>Phase 01 · Identity</span>
          <span className={`${styles.sep} ${styles.hideSm}`} aria-hidden="true" />
          <span className={styles.item}>v0.1.0</span>
        </div>
      </div>
    </footer>
  )
}
