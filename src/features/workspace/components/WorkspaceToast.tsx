import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { createPortal } from 'react-dom'

import { useWorkspace } from '../state/useWorkspace'
import styles from './WorkspaceToast.module.css'

export function WorkspaceToast() {
  const { state } = useWorkspace()
  const toast = state.ui.toast

  return createPortal(
    <AnimatePresence>
      {toast ? (
        <motion.div
          key={toast.id}
          className={styles.toast}
          data-tone={toast.tone}
          role="status"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {toast.tone === 'ok' ? (
            <CircleCheck size={13} aria-hidden="true" />
          ) : toast.tone === 'warn' ? (
            <TriangleAlert size={13} aria-hidden="true" />
          ) : (
            <CircleAlert size={13} aria-hidden="true" />
          )}
          <span>{toast.message}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
