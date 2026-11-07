import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  EllipsisVertical,
  FilePlus2,
  FolderPlus,
  FolderTree,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { useMediaQuery } from '../../../lib/useMediaQuery'
import { findNode, getParentPath, searchTree } from '../state/fileTree'
import type { FileTreeNode, WorkspaceAction } from '../state/types'
import { useWorkspace } from '../state/useWorkspace'
import { FileGlyph } from './FileGlyph'
import styles from './ExplorerPanel.module.css'

type ExplorerPanelProps = {
  variant?: 'inline' | 'drawer'
  onRequestClose?: () => void
}

type MenuState = {
  path: string
  x: number
  y: number
}

const MENU_WIDTH = 236
const MENU_HEIGHT = 274

function visiblePaths(nodes: FileTreeNode[], expanded: string[]): string[] {
  const paths: string[] = []

  const walk = (list: FileTreeNode[]) => {
    for (const node of list) {
      paths.push(node.path)
      if (node.kind === 'folder' && expanded.includes(node.path)) {
        walk(node.children)
      }
    }
  }

  walk(nodes)
  return paths
}

export function ExplorerPanel({ variant = 'inline', onRequestClose }: ExplorerPanelProps) {
  const { project, state, dispatch, stats } = useWorkspace()
  const { tree, ui } = state
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inlineCopilot = useMediaQuery('(min-width: 1360px)')

  const normalizedQuery = query.trim()
  const matches = useMemo(
    () => (normalizedQuery ? searchTree(tree.nodes, normalizedQuery) : []),
    [tree.nodes, normalizedQuery],
  )
  const visible = useMemo(() => visiblePaths(tree.nodes, tree.expanded), [tree.nodes, tree.expanded])
  const focusablePath =
    tree.selectedPath && visible.includes(tree.selectedPath)
      ? tree.selectedPath
      : (visible[0] ?? null)

  const menuNode = menu ? findNode(tree.nodes, menu.path) : null

  useEffect(() => {
    if (!menu) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) {
        return
      }
      setMenu(null)
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
        return
      }

      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return
      }

      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
      )
      if (items.length === 0) {
        return
      }

      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)

      if (event.key === 'Home') {
        items[0]?.focus()
      } else if (event.key === 'End') {
        items[items.length - 1]?.focus()
      } else if (event.key === 'ArrowDown') {
        items[(current + 1) % items.length]?.focus()
      } else {
        items[(current - 1 + items.length) % items.length]?.focus()
      }
    }

    const onViewportChange = () => setMenu(null)

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)

    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [menu])

  const openMenuAt = (path: string, x: number, y: number) => {
    setMenu({
      path,
      x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)),
    })
  }

  const openRowMenu = (event: MouseEvent<HTMLElement>, node: FileTreeNode) => {
    event.preventDefault()
    event.stopPropagation()
    openMenuAt(node.path, event.clientX, event.clientY)
  }

  const openButtonMenu = (event: MouseEvent<HTMLButtonElement>, node: FileTreeNode) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    openMenuAt(node.path, rect.right - 6, rect.bottom + 4)
  }

  const requestDialog = (action: WorkspaceAction) => {
    dispatch(action)
    setMenu(null)
  }

  const openFile = (path: string) => {
    dispatch({ type: 'file/open', path })
    setMenu(null)
  }

  const toggleContext = (path: string) => {
    dispatch({ type: 'ui/toggle-copilot-context', path })
    if (!inlineCopilot) {
      dispatch({ type: 'ui/open-mobile-panel', panel: 'copilot' })
    }
    setMenu(null)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
    }
  }

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-tree-row]')
        : null
    if (!target) {
      return
    }

    const rows = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? [],
    )
    const index = rows.indexOf(target)
    const path = target.dataset.treeRow
    if (!path) {
      return
    }

    const node = findNode(tree.nodes, path)

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      rows[index + 1]?.focus()
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      rows[index - 1]?.focus()
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      rows[0]?.focus()
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      rows[rows.length - 1]?.focus()
      return
    }

    if (event.key === 'ArrowRight' && node?.kind === 'folder') {
      event.preventDefault()
      if (!tree.expanded.includes(path)) {
        dispatch({ type: 'tree/toggle-folder', path })
      } else {
        rows[index + 1]?.focus()
      }
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (node?.kind === 'folder' && tree.expanded.includes(path)) {
        dispatch({ type: 'tree/toggle-folder', path })
        return
      }

      const parentPath = getParentPath(path)
      rows.find((row) => row.dataset.treeRow === parentPath)?.focus()
      return
    }

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = target.getBoundingClientRect()
      openMenuAt(path, rect.left + 28, rect.bottom - 4)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (node?.kind === 'folder') {
        dispatch({ type: 'tree/toggle-folder', path })
      } else {
        openFile(path)
      }
    }
  }

  const renderBranch = (nodes: FileTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const expanded = node.kind === 'folder' && tree.expanded.includes(node.path)
      const active = node.kind === 'file' && tree.activeTabPath === node.path
      const selected = tree.selectedPath === node.path
      const focusable = focusablePath === node.path

      return (
        <li key={node.path} role="none">
          <div
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={node.kind === 'folder' ? expanded : undefined}
            aria-selected={selected}
            tabIndex={focusable ? 0 : -1}
            data-tree-row={node.path}
            className={styles.row}
            data-active={active}
            data-selected={selected}
            data-kind={node.kind}
            style={{ paddingLeft: `${6 + depth * 13}px` }}
            onClick={() => {
              if (node.kind === 'folder') {
                dispatch({ type: 'tree/toggle-folder', path: node.path })
              } else {
                openFile(node.path)
              }
            }}
            onContextMenu={(event) => openRowMenu(event, node)}
            title={node.kind === 'file' ? node.path : `${node.path} · ${node.fileCount} files`}
          >
            <span
              className={styles.caret}
              data-open={expanded}
              aria-hidden="true"
            >
              {node.kind === 'folder' ? <ChevronRight size={12} /> : null}
            </span>

            <FileGlyph name={node.name} kind={node.kind} open={expanded} size={14} />

            <span className={styles.name}>{node.name}</span>

            {node.kind === 'folder' ? (
              <span className={styles.count} aria-hidden="true">
                {node.fileCount}
              </span>
            ) : null}

            <button
              type="button"
              className={styles.rowAction}
              tabIndex={-1}
              aria-label={`Actions for ${node.name}`}
              title={`Actions for ${node.name}`}
              onClick={(event) => openButtonMenu(event, node)}
            >
              <EllipsisVertical size={12} aria-hidden="true" />
            </button>
          </div>

          {node.kind === 'folder' && expanded ? (
            <ul role="group" className={styles.group}>
              {renderBranch(node.children, depth + 1)}
            </ul>
          ) : null}
        </li>
      )
    })

  return (
    <aside
      className={styles.panel}
      data-variant={variant}
      aria-label="Project explorer"
    >
      <header className={styles.head}>
        <div className={styles.identity}>
          <span className={styles.mark} aria-hidden="true">
            <FolderTree size={15} />
          </span>
          <div className={styles.identityCopy}>
            <p className={styles.kicker}>Project explorer</p>
            <h2 className={styles.projectName} title={project.name}>
              {project.name}
            </h2>
          </div>
          {variant === 'drawer' && onRequestClose ? (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onRequestClose}
              aria-label="Close project explorer"
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className={styles.controls} role="group" aria-label="Project controls">
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => dispatch({ type: 'ui/open-dialog', dialog: { kind: 'create-file', parentPath: '' } })}
            title="New file at project root"
            aria-label="New file at project root"
          >
            <FilePlus2 size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => dispatch({ type: 'ui/open-dialog', dialog: { kind: 'create-folder', parentPath: '' } })}
            title="New folder at project root"
            aria-label="New folder at project root"
          >
            <FolderPlus size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => dispatch({ type: 'tree/expand-all' })}
            title="Expand all folders"
            aria-label="Expand all folders"
          >
            <ChevronsUpDown size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => dispatch({ type: 'tree/collapse-all' })}
            title="Collapse all folders"
            aria-label="Collapse all folders"
          >
            <ChevronsDownUp size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => dispatch({ type: 'ui/open-dialog', dialog: { kind: 'reload-tree' } })}
            title="Reset session tree from the stored manifest"
            aria-label="Reset session tree from the stored manifest"
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.search}>
          <Search size={13} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="search"
            id="project-search"
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search project files…"
            aria-label="Search project files"
            spellCheck={false}
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              className={styles.clearSearch}
              onClick={() => setQuery('')}
              aria-label="Clear project search"
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      {normalizedQuery ? (
        <div className={styles.searchResults}>
          <div className={styles.searchMeta}>
            <span>
              {matches.length} {matches.length === 1 ? 'match' : 'matches'}
            </span>
            {matches.length >= 200 ? <span>capped at 200</span> : null}
          </div>

          {matches.length === 0 ? (
            <div className={styles.searchEmpty}>
              <p className={styles.emptyTitle}>No matches</p>
              <p className={styles.emptyCopy}>
                Nothing in the session tree contains “{normalizedQuery}”.
              </p>
            </div>
          ) : (
            <ul className={styles.resultList}>
              {matches.map((node) => (
                <li key={node.path}>
                  <button
                    type="button"
                    className={styles.result}
                    onClick={() => {
                      if (node.kind === 'folder') {
                        dispatch({ type: 'tree/reveal-folder', path: node.path })
                      } else {
                        dispatch({ type: 'file/open', path: node.path })
                      }
                      setQuery('')
                    }}
                  >
                    <FileGlyph name={node.name} kind={node.kind} size={14} />
                    <span className={styles.resultBody}>
                      <span className={styles.resultName}>{node.name}</span>
                      <span className={styles.resultPath}>{node.path}</span>
                    </span>
                    <span className={styles.resultKind}>
                      {node.kind === 'folder' ? `${node.fileCount} files` : 'file'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : tree.nodes.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <FolderTree size={20} />
          </span>
          <p className={styles.emptyTitle}>No files in this project</p>
          <p className={styles.emptyCopy}>
            This record has no imported manifest. Create a file or folder to begin a session tree —
            nothing is written to disk or to IndexedDB in this phase.
          </p>
          <div className={styles.emptyActions}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => dispatch({ type: 'ui/open-dialog', dialog: { kind: 'create-file', parentPath: '' } })}
            >
              <FilePlus2 size={13} aria-hidden="true" /> New file
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => dispatch({ type: 'ui/open-dialog', dialog: { kind: 'create-folder', parentPath: '' } })}
            >
              <FolderPlus size={13} aria-hidden="true" /> New folder
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={treeRef}
          className={styles.treeScroll}
          role="tree"
          aria-label="Project files"
          onKeyDown={handleTreeKeyDown}
        >
          <ul role="group" className={styles.group}>
            {renderBranch(tree.nodes, 0)}
          </ul>
        </div>
      )}

      <footer className={styles.foot}>
        <span>
          {stats.files} {stats.files === 1 ? 'file' : 'files'} · {stats.folders}{' '}
          {stats.folders === 1 ? 'folder' : 'folders'}
        </span>
        <span className={styles.footMeta}>
          {project.truncated ? <span className={styles.warnChip}>Capped</span> : null}
          <span className={styles.sessionDot} aria-hidden="true" />
          Session tree
        </span>
      </footer>

      {createPortal(
        <AnimatePresence>
          {menu && menuNode ? (
            <motion.div
              ref={menuRef}
              className={styles.menu}
              role="menu"
              aria-label={`Actions for ${menuNode.name}`}
              style={{ left: menu.x, top: menu.y }}
              initial={{ opacity: 0, y: -4, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -3, scale: 0.99 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className={styles.menuHead}>
                <FileGlyph name={menuNode.name} kind={menuNode.kind} size={14} />
                <span title={menuNode.path}>{menuNode.name}</span>
              </div>

              {menuNode.kind === 'file' ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => openFile(menuNode.path)}
                  >
                    <span className={styles.menuIcon} aria-hidden="true">
                      <ChevronRight size={13} />
                    </span>
                    Open file
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => toggleContext(menuNode.path)}
                  >
                    <span className={styles.menuIcon} aria-hidden="true">
                      <Sparkles size={13} />
                    </span>
                    {ui.copilotContext.includes(menuNode.path)
                      ? 'Remove from Copilot context'
                      : 'Attach to Copilot context'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() =>
                      requestDialog({
                        type: 'ui/open-dialog',
                        dialog: { kind: 'create-file', parentPath: menuNode.path },
                      })
                    }
                  >
                    <span className={styles.menuIcon} aria-hidden="true">
                      <FilePlus2 size={13} />
                    </span>
                    New file inside
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() =>
                      requestDialog({
                        type: 'ui/open-dialog',
                        dialog: { kind: 'create-folder', parentPath: menuNode.path },
                      })
                    }
                  >
                    <span className={styles.menuIcon} aria-hidden="true">
                      <FolderPlus size={13} />
                    </span>
                    New folder inside
                  </button>
                </>
              )}

              <div className={styles.menuSep} role="separator" />

              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() =>
                  requestDialog({
                    type: 'ui/open-dialog',
                    dialog: { kind: 'rename', path: menuNode.path },
                  })
                }
              >
                <span className={styles.menuIcon} aria-hidden="true">
                  <Pencil size={13} />
                </span>
                Rename…
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                data-danger="true"
                onClick={() =>
                  requestDialog({
                    type: 'ui/open-dialog',
                    dialog: { kind: 'delete', path: menuNode.path },
                  })
                }
              >
                <span className={styles.menuIcon} aria-hidden="true">
                  <Trash2 size={13} />
                </span>
                Delete…
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </aside>
  )
}
