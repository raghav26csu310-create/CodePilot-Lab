import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'

import { Badge } from '../design-system/primitives/Badge'
import { useFocusTrap } from '../lib/useFocusTrap'
import { ROUTES } from './routes'
import styles from './MobileMenu.module.css'

type MobileMenuProps = {
  open: boolean
  onClose: () => void
}

export function MobileMenu({ open, onClose }: MobileMenuProps) {
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
      {open ? (
        <motion.div
          ref={panelRef}
          className={styles.menu}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          tabIndex={-1}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.top}>
            <span>Navigation / 07 modules</span>
            <button type="button" className={styles.close} onClick={close}>
              <X size={14} aria-hidden="true" />
              Close
            </button>
          </div>

          <nav aria-label="All modules">
            <ul className={styles.list}>
              {ROUTES.map((route) => {
                const Icon = route.icon
                return (
                  <li key={route.path}>
                    <NavLink
                      to={route.path}
                      end={route.path === '/'}
                      onClick={close}
                      className={({ isActive }) =>
                        `${styles.item} ${isActive ? styles.itemActive : ''}`
                      }
                    >
                      <Icon size={17} className={styles.itemIcon} aria-hidden="true" />
                      <span className={styles.itemLabel}>{route.label}</span>
                      {route.phase === 'Live' ? (
                        <Badge tone="live">Live</Badge>
                      ) : (
                        <Badge tone="planned">{route.phase}</Badge>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className={styles.footer}>
            <span className={styles.footerLine}>
              <span className={styles.dot} aria-hidden="true" />
              Local only · no account · no telemetry
            </span>
            <span>CodePilot Lab v0.1.0 · Phase 01</span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
