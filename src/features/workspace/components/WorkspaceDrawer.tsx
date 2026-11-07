import { motion } from 'framer-motion'
import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useFocusTrap } from '../../../lib/useFocusTrap'
import styles from './WorkspaceDrawer.module.css'

type WorkspaceDrawerProps = {
  side: 'left' | 'right'
  label: string
  onClose: () => void
  children: ReactNode
}

export function WorkspaceDrawer({ side, label, onClose, children }: WorkspaceDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, panelRef, onClose)

  return createPortal(
    <motion.div
      className={styles.overlay}
      data-side={side}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <motion.div
        ref={panelRef}
        className={styles.drawer}
        data-side={side}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ x: side === 'left' ? -26 : 26, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: side === 'left' ? -26 : 26, opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  )
}
