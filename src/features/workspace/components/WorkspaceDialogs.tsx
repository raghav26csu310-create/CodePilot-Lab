import { AnimatePresence, motion } from 'framer-motion'
import {
  CircleSlash,
  FilePlus2,
  FolderPlus,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { createPortal } from 'react-dom'

import { Button } from '../../../design-system/primitives/Button'
import { useFocusTrap } from '../../../lib/useFocusTrap'
import {
  StoredPathError,
  createStoredEntry,
  deleteStoredEntry,
  listStoredEntries,
  renameStoredEntry,
} from '../../../lib/projectStorage'
import { useEditorCommands } from '../../editor/EditorCommandsContext'
import {
  buildFileTreeFromEntries,
  findNode,
  getParentPath,
  siblingNameExists,
  validateEntryName,
} from '../state/fileTree'
import type { WorkspaceDialog as DialogState } from '../state/types'
import { useWorkspace } from '../state/useWorkspace'
import styles from './WorkspaceDialogs.module.css'

type DialogPhase = 'idle' | 'busy' | 'error'

function dialogKey(dialog: DialogState): string {
  switch (dialog.kind) {
    case 'rename':
    case 'delete':
      return `${dialog.kind}:${dialog.path}`
    case 'create-file':
    case 'create-folder':
      return `${dialog.kind}:${dialog.parentPath}`
    case 'close-tabs':
      return `close-tabs:${dialog.paths.join(',')}`
    case 'reload-tree':
      return 'reload-tree'
    default:
      return 'dialog'
  }
}

export function WorkspaceDialogs() {
  const { state, dispatch } = useWorkspace()
  const { dialog } = state.ui
  const close = useCallback(() => dispatch({ type: 'ui/close-dialog' }), [dispatch])

  return createPortal(
    <AnimatePresence>
      {dialog ? (
        <DialogSurface key={dialogKey(dialog)} dialog={dialog} onClose={close} />
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

function DialogSurface({ dialog, onClose }: { dialog: DialogState; onClose: () => void }) {
  const { project, state, dispatch } = useWorkspace()
  const commands = useEditorCommands()
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, panelRef, onClose)

  const [phase, setPhase] = useState<DialogPhase>('idle')
  const [phaseMessage, setPhaseMessage] = useState('')
  const [busyLabel, setBusyLabel] = useState('')

  const fail = useCallback((message: string) => {
    setPhase('error')
    setPhaseMessage(message)
    setBusyLabel('')
  }, [])

  const begin = useCallback((label: string) => {
    setPhase('busy')
    setBusyLabel(label)
    setPhaseMessage('')
  }, [])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const targetPath =
    dialog.kind === 'rename' || dialog.kind === 'delete' ? dialog.path : null
  const node = targetPath ? findNode(state.tree.nodes, targetPath) : null
  const parentPath =
    dialog.kind === 'create-file' || dialog.kind === 'create-folder'
      ? dialog.parentPath
      : targetPath
        ? getParentPath(targetPath)
        : ''

  const [name, setName] = useState(() =>
    dialog.kind === 'rename' && node ? node.name : '',
  )

  const validation = useMemo(() => {
    if (dialog.kind !== 'create-file' && dialog.kind !== 'create-folder' && dialog.kind !== 'rename') {
      return null
    }

    const trimmed = name.trim()
    const baseError = validateEntryName(trimmed)
    if (baseError) {
      return baseError
    }

    if (dialog.kind === 'rename') {
      if (trimmed === node?.name) {
        return null
      }
      if (siblingNameExists(state.tree.nodes, parentPath, trimmed, dialog.path)) {
        return 'A file or folder with this name already exists here.'
      }
      return null
    }

    if (siblingNameExists(state.tree.nodes, dialog.parentPath, trimmed)) {
      return 'A file or folder with this name already exists here.'
    }

    return null
  }, [dialog, name, node, parentPath, state.tree.nodes])

  const isCreate = dialog.kind === 'create-file' || dialog.kind === 'create-folder'
  const isRename = dialog.kind === 'rename'
  const isDelete = dialog.kind === 'delete'
  const isReload = dialog.kind === 'reload-tree'
  const isCloseTabs = dialog.kind === 'close-tabs'

  const unchanged =
    isRename && node !== null && name.trim() === node.name && name.trim().length > 0
  const submitDisabled =
    phase === 'busy' ||
    ((isCreate || isRename) && (validation !== null || unchanged || !name.trim()))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (dialog.kind === 'create-file' || dialog.kind === 'create-folder') {
      if (validation || phase === 'busy') {
        return
      }

      const kind = dialog.kind === 'create-file' ? 'file' : 'folder'
      begin(kind === 'file' ? 'Creating file…' : 'Creating folder…')

      try {
        await createStoredEntry(project.id, dialog.parentPath, name.trim(), kind)
        dispatch({
          type: 'entry/create',
          parentPath: dialog.parentPath,
          name: name.trim(),
          kind,
        })
      } catch (error) {
        fail(
          error instanceof StoredPathError
            ? error.message
            : 'IndexedDB rejected this write. The entry was not created; storage may be full or unavailable.',
        )
      }
      return
    }

    if (dialog.kind === 'rename') {
      if (validation || unchanged || phase === 'busy') {
        return
      }

      const trimmed = name.trim()
      begin('Renaming and moving stored entries…')
      try {
        await renameStoredEntry(project.id, dialog.path, trimmed)
      } catch (error) {
        fail(
          error instanceof StoredPathError
            ? error.message
            : 'IndexedDB rejected this rename. Nothing moved — the stored tree is unchanged.',
        )
        return
      }

      // Carry the live editor draft across the rename so the in-progress buffer
      // is not lost when the old model is torn down.
      const draft = commands.current?.getDraft(dialog.path) ?? null
      dispatch({ type: 'entry/rename', path: dialog.path, name: trimmed, draft })
    }
  }

  const confirmDelete = async () => {
    if (dialog.kind !== 'delete' || phase === 'busy') {
      return
    }

    begin(node?.kind === 'folder' ? 'Deleting folder…' : 'Deleting file…')

    try {
      await deleteStoredEntry(project.id, dialog.path)
      dispatch({ type: 'entry/delete', path: dialog.path })
    } catch {
      fail(
        'IndexedDB rejected this delete. Nothing was removed — the stored tree is unchanged.',
      )
    }
  }

  const confirmReload = async () => {
    if (dialog.kind !== 'reload-tree' || phase === 'busy') {
      return
    }

    begin('Reloading stored tree…')

    try {
      const entries = await listStoredEntries(project.id)
      // tree/replace closes the dialog itself.
      dispatch({ type: 'tree/replace', nodes: buildFileTreeFromEntries(entries) })
    } catch {
      fail('Reading the stored tree from IndexedDB failed. Your data was not modified.')
    }
  }

  const closeTabs = async (saveFirst: boolean) => {
    if (dialog.kind !== 'close-tabs' || phase === 'busy') {
      return
    }

    const dirtyTabs = state.tree.tabs.filter(
      (tab) => dialog.paths.includes(tab.path) && tab.dirty,
    )

    if (saveFirst) {
      begin(dirtyTabs.length === 1 ? 'Saving 1 file…' : `Saving ${dirtyTabs.length} files…`)
      for (const tab of dirtyTabs) {
        const ok = (await commands.current?.save(tab.path)) ?? false
        if (!ok) {
          fail(
            `Saving ${tab.name} failed, so nothing was closed. Your unsaved edits are still in the editor.`,
          )
          return
        }
      }
    }

    for (const path of dialog.paths) {
      dispatch({ type: 'tab/close', path })
    }
    onClose()
  }

  const dirtyListedCount =
    isCloseTabs && dialog.kind === 'close-tabs'
      ? state.tree.tabs.filter((tab) => dialog.paths.includes(tab.path) && tab.dirty).length
      : 0

  const missingTarget =
    (dialog.kind === 'rename' || dialog.kind === 'delete') && node === null && phase === 'idle'

  const title =
    dialog.kind === 'create-file'
      ? 'Create file'
      : dialog.kind === 'create-folder'
        ? 'Create folder'
        : dialog.kind === 'rename'
          ? 'Rename item'
          : dialog.kind === 'delete'
            ? 'Delete item'
            : dialog.kind === 'reload-tree'
              ? 'Reload the stored tree'
              : 'Unsaved changes'

  const kicker =
    dialog.kind === 'create-file' || dialog.kind === 'create-folder'
      ? `Project storage · in ${parentPath || 'project root'}`
      : dialog.kind === 'rename'
        ? 'Project storage · rename'
        : dialog.kind === 'delete'
          ? 'Project storage · destructive'
          : dialog.kind === 'reload-tree'
            ? 'Project storage · reload from IndexedDB'
            : 'Editor · unsaved edits'

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
        aria-labelledby="workspace-dialog-title"
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.995 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.head}>
          <div>
            <p className={styles.kicker}>{kicker}</p>
            <h2 id="workspace-dialog-title" className={styles.title}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {missingTarget ? (
          <div className={styles.missing}>
            <CircleSlash size={17} aria-hidden="true" />
            <p>This item is no longer in the stored tree. Reload the tree from storage.</p>
          </div>
        ) : isCreate || isRename ? (
          <form className={styles.form} onSubmit={submit}>
            {isRename && node ? (
              <div className={styles.current}>
                <span className={styles.currentLabel}>Current name</span>
                <code>{node.path}</code>
              </div>
            ) : null}

            <label htmlFor="workspace-entry-name" className={styles.label}>
              {isRename ? 'New name' : dialog.kind === 'create-folder' ? 'Folder name' : 'File name'}
            </label>
            <input
              id="workspace-entry-name"
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={dialog.kind === 'create-folder' ? 'components' : 'Component.tsx'}
              autoComplete="off"
              spellCheck={false}
              disabled={phase === 'busy'}
              data-autofocus
              aria-invalid={validation !== null}
              aria-describedby={validation ? 'workspace-name-error' : 'workspace-name-hint'}
              onFocus={(event) => event.currentTarget.select()}
            />

            {validation ? (
              <p id="workspace-name-error" className={styles.error} role="alert">
                {validation}
              </p>
            ) : (
              <p id="workspace-name-hint" className={styles.hint}>
                {isRename
                  ? 'Renaming moves the stored entry and its saved contents, keeps open tabs and copies over any unsaved draft.'
                  : 'Creates a real, persisted entry in this project record. Files start empty — content is written when you save.'}
              </p>
            )}

            {phase === 'error' && phaseMessage ? (
              <p className={styles.error} role="alert">
                {phaseMessage}
              </p>
            ) : null}

            <div className={styles.foot}>
              <span className={styles.footNote} data-tone={phase === 'busy' ? 'busy' : undefined}>
                {busyLabel || 'Writes to IndexedDB in this browser'}
              </span>
              <div className={styles.actions}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={phase === 'busy'}
                  onClick={onClose}
                >
                  {phase === 'busy' ? 'Working…' : 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitDisabled}
                  icon={isRename ? <Pencil size={13} /> : dialog.kind === 'create-folder' ? <FolderPlus size={13} /> : <FilePlus2 size={13} />}
                >
                  {isRename ? 'Rename' : dialog.kind === 'create-folder' ? 'Create folder' : 'Create file'}
                </Button>
              </div>
            </div>
          </form>
        ) : isDelete && node ? (
          <div className={styles.body}>
            <div className={styles.dangerCard}>
              <span className={styles.dangerIcon} aria-hidden="true">
                <Trash2 size={18} />
              </span>
              <div>
                <p className={styles.dangerTitle}>
                  Delete “{node.name}” from this project?
                </p>
                <p className={styles.dangerCopy}>
                  {node.kind === 'folder'
                    ? `This folder contains ${node.fileCount} ${node.fileCount === 1 ? 'file' : 'files'}. The stored entry and all saved contents underneath it are removed from IndexedDB.`
                    : 'The stored entry and its saved contents are removed from IndexedDB, and its tab is closed.'}{' '}
                  Unsaved drafts in open tabs of the same path are deleted with it.
                </p>
                <code className={styles.dangerPath}>{node.path}</code>
              </div>
            </div>

            {phase === 'error' && phaseMessage ? (
              <p className={styles.error} role="alert">
                {phaseMessage}
              </p>
            ) : null}

            <div className={styles.foot}>
              <span className={styles.footNote} data-tone={phase === 'busy' ? 'busy' : undefined}>
                {busyLabel || 'This cannot be undone'}
              </span>
              <div className={styles.actions}>
                <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={phase === 'busy'}>
                  Keep item
                </Button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={confirmDelete}
                  disabled={phase === 'busy'}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  Delete from storage
                </button>
              </div>
            </div>
          </div>
        ) : isReload ? (
          <div className={styles.body}>
            <div className={styles.resetCard}>
              <span className={styles.resetIcon} aria-hidden="true">
                <RotateCcw size={18} />
              </span>
              <div>
                <p className={styles.dangerTitle}>Reload the tree from IndexedDB?</p>
                <p className={styles.resetCopy}>
                  The explorer will be rebuilt from the entries physically stored in this browser,
                  so any tree view you shaped this session is discarded. Saved tab drafts are kept —
                  tabs still point to their paths, and stale ones close only if the path no longer
                  exists in storage.
                </p>
              </div>
            </div>

            {phase === 'error' && phaseMessage ? (
              <p className={styles.error} role="alert">
                {phaseMessage}
              </p>
            ) : null}

            <div className={styles.foot}>
              <span className={styles.footNote} data-tone={phase === 'busy' ? 'busy' : undefined}>
                {busyLabel || 'Reads stored entries only — never fabricates a file'}
              </span>
              <div className={styles.actions}>
                <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={phase === 'busy'}>
                  Cancel
                </Button>
                <Button type="button" size="sm" icon={<RotateCcw size={13} />} onClick={confirmReload} disabled={phase === 'busy'}>
                  Reload tree
                </Button>
              </div>
            </div>
          </div>
        ) : isCloseTabs && dialog.kind === 'close-tabs' ? (
          <div className={styles.body}>
            <div className={styles.resetCard}>
              <span className={styles.resetIcon} aria-hidden="true">
                <Save size={18} />
              </span>
              <div>
                <p className={styles.dangerTitle}>
                  {dirtyListedCount === 1
                    ? 'One file has unsaved changes'
                    : `${dirtyListedCount} files have unsaved changes`}
                </p>
                <p className={styles.resetCopy}>
                  Saving writes the current editor buffer to IndexedDB. Discarding closes the
                  {dialog.paths.length === 1 ? ' tab' : ' tabs'} and permanently loses the
                  unsaved {dialog.paths.length === 1 ? 'edit' : 'edits'}.
                </p>
              </div>
            </div>

            {phase === 'error' && phaseMessage ? (
              <p className={styles.error} role="alert">
                {phaseMessage}
              </p>
            ) : null}

            <div className={styles.foot}>
              <span className={styles.footNote} data-tone={phase === 'busy' ? 'busy' : undefined}>
                {busyLabel || 'Your draft is only in the editor until saved'}
              </span>
              <div className={styles.actions}>
                <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={phase === 'busy'}>
                  Cancel
                </Button>
                {dirtyListedCount > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    icon={<Save size={13} />}
                    onClick={() => void closeTabs(true)}
                    disabled={phase === 'busy'}
                  >
                    Save &amp; close
                  </Button>
                ) : null}
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void closeTabs(false)}
                  disabled={phase === 'busy'}
                >
                  <XCircle size={13} aria-hidden="true" />
                  Discard &amp; close
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  )
}
