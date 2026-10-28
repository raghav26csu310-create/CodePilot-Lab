import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, Search } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '../design-system/primitives/Badge'
import { Kbd } from '../design-system/primitives/Kbd'
import { useFocusTrap } from '../lib/useFocusTrap'
import { ROUTES } from './routes'
import styles from './CommandPalette.module.css'

type CommandPaletteProps = {
  open: boolean
  onClose: () => void
}

function PaletteOverlay({
  onClose,
  panelRef,
}: {
  onClose: () => void
  panelRef: RefObject<HTMLDivElement | null>
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return ROUTES
    }
    return ROUTES.filter((route) =>
      `${route.label} ${route.tagline} ${route.phase}`.toLowerCase().includes(normalized),
    )
  }, [query])

  useEffect(() => {
    const node = document.getElementById(`palette-option-${active}`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const goTo = (path: string) => {
    onClose()
    navigate(path)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
      )
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const target = results[active]
      if (target) {
        goTo(target.path)
      }
    }
  }

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <motion.div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        initial={{ opacity: 0, y: -8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.995 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.searchRow}>
          <Search size={15} className={styles.searchIcon} aria-hidden="true" />
          <input
            className={styles.input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search modules and actions…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-option-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search modules"
            autoComplete="off"
            spellCheck={false}
          />
          <span className={styles.esc} aria-hidden="true">
            <Kbd>Esc</Kbd>
          </span>
        </div>

        <div className={styles.list}>
          <div className={styles.groupLabel} id="palette-group">
            Modules
          </div>
          <ul role="listbox" id="palette-results" aria-labelledby="palette-group">
            {results.map((route, index) => {
              const Icon = route.icon
              const selected = index === active
              return (
                <li
                  key={route.path}
                  id={`palette-option-${index}`}
                  role="option"
                  aria-selected={selected}
                  className={`${styles.option} ${selected ? styles.optionActive : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => goTo(route.path)}
                >
                  <span className={styles.optionIcon}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className={styles.optionBody}>
                    <span className={styles.optionLabel}>{route.label}</span>
                    <span className={styles.optionMeta}>{route.tagline}</span>
                  </span>
                  <span className={styles.optionAside}>
                    {route.phase === 'Live' ? (
                      <Badge tone="live">Live</Badge>
                    ) : (
                      <Badge tone="planned">{route.phase}</Badge>
                    )}
                    <CornerDownLeft size={13} className={styles.enterHint} aria-hidden="true" />
                  </span>
                </li>
              )
            })}
          </ul>
          {results.length === 0 ? (
            <p className={styles.empty}>No module matches “{query}”.</p>
          ) : null}
        </div>

        <div className={styles.footer}>
          <span className={styles.hints}>
            <span className={styles.hint}>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className={styles.hidesm}>navigate</span>
            </span>
            <span className={styles.hint}>
              <Kbd>↵</Kbd>
              <span className={styles.hidesm}>open</span>
            </span>
          </span>
          <span className={styles.footerMeta}>
            {results.length} / {ROUTES.length} modules
          </span>
        </div>
      </motion.div>
    </motion.div>
  )
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => onClose(), [onClose])

  useFocusTrap(open, panelRef, close)

  useEffect(() => {
    if (!open) {
      return
    }

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <AnimatePresence>
      {open ? <PaletteOverlay key="palette" onClose={close} panelRef={panelRef} /> : null}
    </AnimatePresence>
  )
}
