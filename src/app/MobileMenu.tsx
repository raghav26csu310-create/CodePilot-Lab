import { AnimatePresence, motion } from 'framer-motion'
import { Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'

import { Badge } from '../design-system/primitives/Badge'
import { useFocusTrap } from '../lib/useFocusTrap'
import { NAV_ROUTES } from './routes'
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
            <span>Navigation / {String(NAV_ROUTES.length).padStart(2, '0')} areas</span>
            <button type="button" className={styles.close} onClick={close}>
              <X size={14} aria-hidden="true" />
              Close
            </button>
          </div>

          <nav aria-label="All modules">
            <ul className={styles.list}>
              {NAV_ROUTES.map((route) => {
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
                      {route.status === 'live' ? (
                        <Badge tone="live">Live</Badge>
                      ) : (
                        <Badge tone="planned">Scheduled</Badge>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className={styles.utility}>
            <NavLink to="/settings" onClick={close} className={styles.utilityLink}>
              <Settings2 size={17} className={styles.itemIcon} aria-hidden="true" />
              <span className={styles.itemLabel}>Settings</span>
              <Badge tone="planned">Scheduled</Badge>
            </NavLink>
          </div>

          <div className={styles.footer}>
            <span className={styles.footerLine}>
              <span className={styles.dot} aria-hidden="true" />
              Local only · no account · no telemetry
            </span>
            <span>
              CodePilot Lab v{__APP_VERSION__} · Milestone 02
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
