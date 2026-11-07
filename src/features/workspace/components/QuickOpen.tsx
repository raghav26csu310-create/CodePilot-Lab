import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, Search, TriangleAlert } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { searchStoredContents, type ContentSearchReport } from '../../../lib/projectStorage'
import { useFocusTrap } from '../../../lib/useFocusTrap'
import type { FileTreeNode, PendingReveal } from '../state/types'
import { useWorkspace } from '../state/useWorkspace'
import { FileGlyph } from './FileGlyph'
import styles from './QuickOpen.module.css'

function flattenFileNodes(nodes: FileTreeNode[], out: FileTreeNode[] = []): FileTreeNode[] {
  for (const node of nodes) {
    if (node.kind === 'file') {
      out.push(node)
    } else {
      flattenFileNodes(node.children, out)
    }
  }
  return out
}

export function QuickOpenPalette() {
  const { state } = useWorkspace()
  const palette = state.ui.palette

  return createPortal(
    <AnimatePresence>
      {palette === 'files' ? <QuickFiles key="quick-files" /> : null}
      {palette === 'search' ? <QuickSearch key="quick-search" /> : null}
    </AnimatePresence>,
    document.body,
  )
}

function PanelFrame({
  kicker,
  title,
  onClose,
  footer,
  children,
}: {
  kicker: string
  title: string
  onClose: () => void
  footer: string
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(true, panelRef, onClose)

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
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
        aria-label={title}
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 5, scale: 0.995 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className={styles.kicker}>{kicker}</p>
        {children}
        <div className={styles.footer}>
          <span>{footer}</span>
          <span className={styles.footHint}>Esc to close</span>
        </div>
      </motion.div>
    </motion.div>
  )
}

function QuickFiles() {
  const { state, dispatch } = useWorkspace()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const close = () => dispatch({ type: 'ui/close-palette' })

  const files = useMemo(() => {
    const all = flattenFileNodes(state.tree.nodes)
    const needle = query.trim().toLocaleLowerCase()
    const matches = needle
      ? all.filter((node) => node.path.toLocaleLowerCase().includes(needle))
      : all
    return matches.slice(0, 60)
  }, [state.tree.nodes, query])

  const open = (node: FileTreeNode) => {
    dispatch({ type: 'file/open', path: node.path })
    close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (files.length > 0) {
        setSelected((index) => (index + 1) % files.length)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (files.length > 0) {
        setSelected((index) => (index - 1 + files.length) % files.length)
      }
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const target = files[selected]
      if (target) {
        open(target)
      }
    }
  }

  return (
    <PanelFrame
      kicker="Quick open · stored files"
      title="Quick open"
      onClose={close}
      footer={`${files.length}${files.length === 60 ? '+' : ''} file listing · open with ↵`}
    >
      <div className={styles.searchRow} onKeyDown={onKeyDown}>
        <Search size={13} className={styles.searchIcon} aria-hidden="true" />
        <input
          className={styles.input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          placeholder="Jump to a stored file…"
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          aria-label="Filter stored files"
        />
      </div>

      {files.length === 0 ? (
        <p className={styles.emptyNote}>
          {query.trim().length === 0
            ? 'No files are stored with this project record yet.'
            : 'No stored file matches this filter.'}
        </p>
      ) : (
        <ul className={styles.list} role="listbox" aria-label="Matching stored files">
          {files.map((node, index) => (
            <li key={node.path}>
              <button
                type="button"
                className={styles.row}
                role="option"
                aria-selected={index === selected}
                data-selected={index === selected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => open(node)}
              >
                <FileGlyph name={node.name} kind="file" size={13} />
                <span className={styles.rowName}>{node.name}</span>
                <span className={styles.rowPath}>{node.path}</span>
                {index === selected ? (
                  <CornerDownLeft size={11} className={styles.rowEnter} aria-hidden="true" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  )
}

type ScanState = {
  query: string
  report: ContentSearchReport | null
  failed?: boolean
}

function QuickSearch() {
  const { project, dispatch } = useWorkspace()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [loaded, setLoaded] = useState<ScanState | null>(null)
  const close = () => dispatch({ type: 'ui/close-palette' })

  const trimmed = query.trim().toLocaleLowerCase()
  const active =
    trimmed.length >= 2 && loaded?.query === trimmed ? loaded : null
  const hits = active?.report?.hits ?? []
  const scanning = trimmed.length >= 2 && active === null && !(loaded?.failed && loaded.query === trimmed)

  useEffect(() => {
    if (trimmed.length < 2) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      searchStoredContents(project.id, query)
        .then((report) => {
          if (!cancelled) {
            setLoaded({ query: trimmed, report })
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoaded({ query: trimmed, report: null, failed: true })
          }
        })
    }, 240)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, trimmed, project.id])

  const open = (hit: { path: string; line: number; column: number }) => {
    dispatch({
      type: 'ui/set-pending-reveal',
      reveal: { path: hit.path, line: hit.line, column: hit.column } satisfies PendingReveal,
    })
    close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (hits.length > 0) {
        setSelected((index) => (index + 1) % hits.length)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (hits.length > 0) {
        setSelected((index) => (index - 1 + hits.length) % hits.length)
      }
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const target = hits[selected]
      if (target) {
        open(target)
      }
    }
  }

  const footer =
    scannedSummary(active, trimmed, scanning) ?? searchingFooter(scanning, trimmed)

  return (
    <PanelFrame
      kicker="Project search · stored contents"
      title="Search project contents"
      onClose={close}
      footer={footer}
    >
      <div className={styles.searchRow} onKeyDown={onKeyDown}>
        <Search size={13} className={styles.searchIcon} aria-hidden="true" />
        <input
          className={styles.input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          placeholder="Search in saved file contents…"
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          aria-label="Search stored contents"
        />
      </div>

      {active?.failed ? (
        <p className={styles.errorNote} role="alert">
          <TriangleAlert size={13} aria-hidden="true" />
          Reading stored contents from IndexedDB failed. Nothing was modified — try a shorter
          query or reopen the palette.
        </p>
      ) : trimmed.length < 2 ? (
        <p className={styles.emptyNote}>
          Type at least 2 characters to scan the saved contents of this project in IndexedDB.
        </p>
      ) : scanning ? (
        <p className={styles.emptyNote}>Scanning stored file contents…</p>
      ) : hits.length === 0 ? (
        <p className={styles.emptyNote}>
          {active?.report
            ? `No line in ${active.report.scannedFiles} stored ${active.report.scannedFiles === 1 ? 'file' : 'files'} contains this text.`
            : 'No result.'}
        </p>
      ) : (
        <ul className={styles.list} role="listbox" aria-label="Matching stored contents">
          {hits.map((hit, index) => (
            <li key={`${hit.path}:${hit.line}:${hit.column}:${index}`}>
              <button
                type="button"
                className={styles.row}
                role="option"
                aria-selected={index === selected}
                data-selected={index === selected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => open(hit)}
              >
                <FileGlyph name={hit.path.slice(hit.path.lastIndexOf('/') + 1)} kind="file" size={13} />
                <span className={styles.rowName}>{hit.path}</span>
                <code className={styles.hitMeta}>
                  {hit.line}:{hit.column}
                </code>
                <span className={styles.rowPath}>{hit.preview}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  )
}

function scannedSummary(
  active: ScanState | null,
  trimmed: string,
  scanning: boolean,
): string | null {
  if (!active?.report || scanning) {
    return null
  }

  const { hits, scannedFiles, totalMatches, capped } = active.report
  const base =
    scannedFiles <= 0
      ? 'No stored files to scan'
      : `${totalMatches} match${totalMatches === 1 ? '' : 'es'} across ${scannedFiles} stored ${scannedFiles === 1 ? 'file' : 'files'}`
  const suffix = hits.length > 0 ? ` · showing ${hits.length}` : ''
  const cap = capped ? ' · listing capped at 100' : ''
  return `${base}${suffix}${cap} for “${trimmed}”`
}

function searchingFooter(scanning: boolean, trimmed: string): string {
  if (scanning) {
    return 'Scanning stored contents…'
  }

  if (trimmed.length < 2) {
    return 'At least 2 characters required'
  }

  return 'Read-only scan of saved contents'
}
