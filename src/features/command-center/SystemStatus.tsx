import { useEffect, useState } from 'react'

import { probeStorage, type StorageSnapshot } from '../../lib/db'
import { formatBytes } from '../../lib/format'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { useWebGLSupport } from '../../lib/useWebGLSupport'
import styles from './CommandCenter.module.css'

type Tone = 'ok' | 'warn' | 'neutral'

type ProviderStatus = {
  label: string
  tone: Tone
}

function detectProvider(): ProviderStatus {
  if (typeof window === 'undefined') {
    return { label: 'Not configured', tone: 'neutral' }
  }

  const candidate = window as Window & {
    LanguageModel?: unknown
    ai?: { languageModel?: unknown }
  }

  if (
    typeof candidate.LanguageModel !== 'undefined' ||
    typeof candidate.ai?.languageModel !== 'undefined'
  ) {
    return { label: 'Browser model detected · bridge off', tone: 'warn' }
  }

  return { label: 'Not configured · bridge scheduled', tone: 'neutral' }
}

function readLocalStorage(): boolean {
  try {
    const key = '__codepilot_probe__'
    window.localStorage.setItem(key, '1')
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function StatusDot({ tone }: { tone: Tone }) {
  return <span className={styles.statusDot} data-tone={tone} aria-hidden="true" />
}

export function SystemStatus() {
  const webgl = useWebGLSupport()
  const reducedMotion = usePrefersReducedMotion()
  const [storage, setStorage] = useState<StorageSnapshot | null>(null)
  const [localStorageOk] = useState(readLocalStorage)
  const [provider] = useState(detectProvider)

  useEffect(() => {
    let cancelled = false

    probeStorage()
      .then((snapshot) => {
        if (!cancelled) {
          setStorage(snapshot)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStorage({
            indexedDB: 'indexedDB' in window,
            estimate: false,
            persisted: null,
            usage: null,
            quota: null,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  let storageValue = 'Checking this browser…'
  let storageTone: Tone = 'neutral'

  if (storage) {
    if (!storage.indexedDB) {
      storageValue = 'IndexedDB unavailable'
      storageTone = 'warn'
    } else if (storage.estimate && storage.usage !== null) {
      const quota = storage.quota ? ` of ${formatBytes(storage.quota)}` : ''
      storageValue = `${formatBytes(storage.usage)} used${quota} · IndexedDB`
      storageTone = 'ok'
    } else {
      storageValue = 'IndexedDB available'
      storageTone = 'ok'
    }
  }

  const webglLabel =
    webgl === 'none'
      ? 'Unavailable · static fallback'
      : `${webgl === 'webgl2' ? 'WebGL 2' : 'WebGL 1'} ready`

  return (
    <section className={styles.panel} aria-labelledby="system-status-title">
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelKicker}>Runtime checks</p>
          <h2 id="system-status-title" className={styles.panelTitle}>
            System status
          </h2>
        </div>
        <span className={styles.panelMeta}>v{__APP_VERSION__}</span>
      </div>

      <dl className={styles.statusList}>
        <div className={styles.statusRow}>
          <dt>Application</dt>
          <dd>
            <StatusDot tone="ok" />
            Running · {import.meta.env.DEV ? 'development' : 'production'} build
          </dd>
        </div>

        <div className={styles.statusRow}>
          <dt>Local storage</dt>
          <dd aria-live="polite" aria-busy={storage === null}>
            <StatusDot tone={storageTone} />
            {storageValue}
            <span className={styles.statusNote}>
              localStorage {localStorageOk ? 'available' : 'unavailable'}
            </span>
          </dd>
        </div>

        <div className={styles.statusRow}>
          <dt>WebGL</dt>
          <dd>
            <StatusDot tone={webgl === 'none' ? 'warn' : 'ok'} />
            {webglLabel}
          </dd>
        </div>

        <div className={styles.statusRow}>
          <dt>AI provider</dt>
          <dd>
            <StatusDot tone={provider.tone} />
            {provider.label}
          </dd>
        </div>

        <div className={styles.statusRow}>
          <dt>Motion</dt>
          <dd>
            <StatusDot tone="neutral" />
            {reducedMotion ? 'Reduced motion' : 'Full motion'}
          </dd>
        </div>
      </dl>

      <p className={styles.statusFoot}>
        Checks run in this browser at load · no simulated health or metrics.
      </p>
    </section>
  )
}
