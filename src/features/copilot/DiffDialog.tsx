import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, CircleAlert, FileDiff, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../design-system/primitives/Button'
import { useFocusTrap } from '../../lib/useFocusTrap'
import { useCopilot } from './CopilotContext'
import { computeDiff, type DiffResult } from './diff'
import type { CodeProposal, ProposalPreview } from './types'
import styles from './DiffDialog.module.css'

type DiffDialogProps = {
  proposal: CodeProposal | null
  onClose: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; preview: ProposalPreview; diff: DiffResult }
  | { status: 'error'; message: string }

export function DiffDialog({ proposal, onClose }: DiffDialogProps) {
  return (
    <AnimatePresence>
      {proposal ? (
        <DiffPanel key={proposal.id} proposal={proposal} onClose={onClose} />
      ) : null}
    </AnimatePresence>
  )
}

/**
 * Keyed by proposal id so reviewing a different (or re-opened) proposal mounts
 * fresh state. That keeps the load effect free of synchronous resets.
 */
function DiffPanel({
  proposal,
  onClose,
}: {
  proposal: CodeProposal
  onClose: () => void
}) {
  const { previewProposal, applyProposal } = useCopilot()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [applying, setApplying] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)

  useFocusTrap(true, panelRef, onClose)

  useEffect(() => {
    let cancelled = false

    previewProposal(proposal)
      .then((preview) => {
        if (cancelled) {
          return
        }
        setLoad({
          status: 'ready',
          preview,
          diff: computeDiff(preview.before, preview.after),
        })
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
        setLoad({
          status: 'error',
          message:
            cause instanceof Error && cause.message
              ? cause.message
              : 'The current file content could not be read.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [proposal, previewProposal])

  const handleApply = async () => {
    if (load.status !== 'ready') {
      return
    }
    setApplying(true)
    setFailure(null)
    const result = await applyProposal(proposal)
    setApplying(false)
    if (result.ok) {
      setApplied(true)
      window.setTimeout(onClose, 650)
    } else {
      setFailure(result.message ?? 'The change could not be applied.')
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
        if (event.target === event.currentTarget && !applying) {
          onClose()
        }
      }}
    >
      <motion.div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="copilot-diff-title"
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.995 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className={styles.head}>
          <div className={styles.headMain}>
            <p className={styles.kicker}>
              <FileDiff size={13} />
              Proposed change · {proposal.mode === 'create' ? 'new file' : 'replace file'}
            </p>
            <h2 id="copilot-diff-title">{proposal.path}</h2>
            {proposal.summary ? <p className={styles.summary}>{proposal.summary}</p> : null}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close diff"
            disabled={applying}
          >
            <X size={15} />
          </button>
        </header>

        {proposal.invalidReason ? (
          <div className={styles.blocked} role="alert">
            <CircleAlert size={16} />
            <div>
              <strong>This proposal cannot be applied.</strong>
              <p>{proposal.invalidReason}</p>
            </div>
          </div>
        ) : null}

        {load.status === 'loading' ? (
          <div className={styles.loading}>
            <Loader2 size={16} className={styles.spin} />
            Reading the current file content…
          </div>
        ) : load.status === 'error' ? (
          <div className={styles.blocked} role="alert">
            <CircleAlert size={16} />
            <div>
              <strong>The diff could not be prepared.</strong>
              <p>{load.message}</p>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.stats}>
              <span className={styles.source}>
                Comparing against{' '}
                {load.preview.beforeSource === 'draft'
                  ? 'the unsaved editor buffer'
                  : load.preview.beforeSource === 'disk'
                    ? 'the linked folder copy'
                    : load.preview.beforeSource === 'stored'
                      ? 'the saved copy'
                      : 'an empty file'}
              </span>
              <span className={styles.add}>+{load.diff.additions}</span>
              <span className={styles.remove}>−{load.diff.deletions}</span>
            </div>

            {load.diff.truncated ? (
              <p className={styles.note}>
                This file is very large; the diff covers the first 1200 lines only. Apply only if
                you reviewed the proposed content.
              </p>
            ) : null}

            {proposal.mode === 'replace' && load.preview.beforeSource === 'missing' ? (
              <p className={styles.note} data-tone="warn">
                The existing content could not be read, so replacing it would discard unknown
                bytes. Open the file in the editor first.
              </p>
            ) : null}

            <div className={styles.diff} role="table" aria-label="Side-by-side diff">
              <div className={styles.diffHead} role="row">
                <span role="columnheader">Current</span>
                <span role="columnheader">Proposed</span>
              </div>
              <div className={styles.diffBody}>
                {load.diff.rows.map((row, index) => (
                  <div key={index} className={styles.row} data-kind={row.kind} role="row">
                    <div className={styles.cell} role="cell">
                      <span className={styles.lineNo}>{row.left?.line ?? ''}</span>
                      <code>{row.left?.text ?? ''}</code>
                    </div>
                    <div className={styles.cell} role="cell">
                      <span className={styles.lineNo}>{row.right?.line ?? ''}</span>
                      <code>{row.right?.text ?? ''}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {failure ? (
          <p className={styles.failure} role="alert">
            <CircleAlert size={14} />
            {failure}
          </p>
        ) : null}

        <footer className={styles.foot}>
          <p className={styles.footNote}>
            Applying edits the live Monaco buffer. Nothing is written to IndexedDB until you save,
            and every applied proposal keeps a restorable revision.
          </p>
          <div className={styles.actions}>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={applying}>
              Reject
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleApply()}
              disabled={
                applying ||
                applied ||
                load.status !== 'ready' ||
                proposal.invalidReason !== null ||
                (proposal.mode === 'replace' && load.preview.beforeSource === 'missing')
              }
              icon={
                applying ? <Loader2 size={14} className={styles.spin} /> : <ArrowRight size={14} />
              }
            >
              {applied ? 'Applied' : applying ? 'Applying…' : 'Apply to buffer'}
            </Button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}
