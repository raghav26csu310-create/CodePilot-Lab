import { lazy, Suspense, useCallback, useRef, useState } from 'react'

import { Skeleton } from '../../design-system/primitives/Skeleton'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { useStageActive } from '../../lib/useStageActive'
import { useWebGLSupport } from '../../lib/useWebGLSupport'
import { CoreFallback } from './CoreFallback'
import styles from './HeroStage.module.css'

const CoreScene = lazy(() => import('../../three/CoreScene'))

export function HeroStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const fpsRef = useRef<HTMLSpanElement>(null)
  const [pulse, setPulse] = useState(0)

  const reducedMotion = usePrefersReducedMotion()
  const webgl = useWebGLSupport()
  const active = useStageActive(stageRef)

  const interactive = webgl !== 'none' && !reducedMotion

  const handleFps = useCallback((fps: number) => {
    if (fpsRef.current) {
      fpsRef.current.textContent = String(fps)
    }
  }, [])

  const fallbackReason = reducedMotion ? 'reduced-motion' : 'no-webgl'

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span>Core observatory</span>
        <span className={styles.headRight}>
          {interactive ? 'Lattice-01' : 'Static display'}
        </span>
      </div>

      <div
        ref={stageRef}
        className={styles.stage}
        onPointerDown={() => {
          if (interactive) {
            setPulse((value) => value + 1)
          }
        }}
      >
        <span className={`${styles.corner} ${styles.tl}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.tr}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.bl}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.br}`} aria-hidden="true" />
        <div className={styles.reticle} aria-hidden="true" />

        {interactive ? (
          <Suspense
            fallback={
              <div className={styles.loading}>
                <Skeleton className={styles.loadingRing} />
              </div>
            }
          >
            <div className={styles.canvasLayer}>
              <CoreScene paused={!active} pulse={pulse} onFps={handleFps} />
            </div>
          </Suspense>
        ) : (
          <CoreFallback reason={fallbackReason} />
        )}

        <div className={styles.labels} aria-hidden="true">
          <div className={styles.labelRow}>
            <span>Core / lattice–01</span>
            <span className={styles.labelAccent}>
              {interactive ? 'WebGL · active' : 'Static'}
            </span>
          </div>
          <div className={styles.labelRow}>
            <span>
              {interactive ? (
                active ? (
                  <>
                    FPS <span ref={fpsRef}>—</span> · measured
                  </>
                ) : (
                  'Render · paused'
                )
              ) : reducedMotion ? (
                'Motion · reduced'
              ) : (
                'No WebGL'
              )}
            </span>
            <span>{interactive ? 'Pointer · parallax' : 'Fallback'}</span>
          </div>
        </div>

        <p className="sr-only">
          Decorative view of the CodePilot Lab lattice core.{' '}
          {interactive ? 'A live WebGL rendering is active.' : 'A static fallback is shown.'}
        </p>
      </div>

      <div className={styles.foot}>
        <span>Interactive model</span>
        <span className={styles.footHint}>
          {interactive ? 'Move pointer to tilt · click to pulse' : 'No GPU resources used'}
        </span>
      </div>
    </div>
  )
}
