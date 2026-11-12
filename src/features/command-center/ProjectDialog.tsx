import { motion } from 'framer-motion'
import { FolderOpen, LoaderCircle, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'

import { Button } from '../../design-system/primitives/Button'
import { Select } from '../../design-system/primitives/Select'
import { createProjectRecord, findProjectByName, type ProjectRecord } from '../../lib/db'
import { formatBytes, formatDate } from '../../lib/format'
import {
  PROJECT_LANGUAGES,
  projectLanguage,
  type ProjectLanguageId,
} from '../editor/projectLanguages'
import { createStoredEntry, writeStoredContent } from '../../lib/projectStorage'
import {
  EXCLUDED_DIRECTORIES,
  MAX_IMPORT_DEPTH,
  MAX_IMPORT_FILES,
  scanDirectory,
  scanFileList,
  supportsDirectoryPicker,
  type ImportScan,
} from '../../lib/projectImport'
import { useFocusTrap } from '../../lib/useFocusTrap'
import styles from './ProjectDialog.module.css'

type DialogMode = 'create' | 'import'

type ProjectDialogProps = {
  mode: DialogMode
  onClose: () => void
  onCompleted: (project: ProjectRecord) => void
}

const LANGUAGE_OPTIONS = PROJECT_LANGUAGES.map((language) => ({
  value: language.id,
  label: language.label,
  description: language.runtime ? 'Runs in the Execution Lab' : 'Editor only',
}))

function describeError(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) {
    return cause.message
  }
  return fallback
}

export function ProjectDialog({ mode, onClose, onCompleted }: ProjectDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => onClose(), [onClose])

  useFocusTrap(true, panelRef, close)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close()
        }
      }}
    >
      <motion.div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        initial={{ opacity: 0, y: 12, scale: 0.992 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.994 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.head}>
          <div>
            <p className={styles.kicker}>
              {mode === 'create' ? 'Registry / new record' : 'Import / local folder'}
            </p>
            <h2 id="project-dialog-title" className={styles.title}>
              {mode === 'create' ? 'Create a project' : 'Import a project folder'}
            </h2>
          </div>
          <button type="button" className={styles.close} onClick={close} aria-label="Close dialog">
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {mode === 'create' ? (
          <CreateProjectForm onClose={close} onCompleted={onCompleted} />
        ) : (
          <ImportProjectFlow onClose={close} onCompleted={onCompleted} />
        )}
      </motion.div>
    </motion.div>
  )
}

function CreateProjectForm({
  onClose,
  onCompleted,
}: {
  onClose: () => void
  onCompleted: (project: ProjectRecord) => void
}) {
  const [name, setName] = useState('')
  const [language, setLanguage] = useState<ProjectLanguageId>('typescript')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) {
      return
    }

    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('Give the project a name of at least 2 characters.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const existing = await findProjectByName(trimmed)
      if (existing) {
        setError(`“${trimmed}” already exists in the local registry.`)
        return
      }

      const selected = projectLanguage(language)
      const project = await createProjectRecord({
        name: trimmed,
        description,
        language: selected.label,
        source: 'created',
      })

      // Write a real starter file so the workspace opens on something runnable.
      try {
        await createStoredEntry(project.id, '', selected.fileName, 'file')
        await writeStoredContent(project.id, selected.fileName, selected.starter)
      } catch {
        setError(
          'The project record was created, but its starter file could not be written to IndexedDB. Create a file manually in the workspace.',
        )
        return
      }

      onCompleted(project)
    } catch (cause) {
      setError(
        describeError(
          cause,
          'The project could not be written to IndexedDB. Check storage availability and try again.',
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="project-name">
          Project name
        </label>
        <input
          id="project-name"
          className={styles.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Signal Garden"
          maxLength={64}
          data-autofocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'project-error' : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className={styles.split}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="project-language">
            Primary language
          </label>
          <Select
            id="project-language"
            value={language}
            onChange={(value) => setLanguage(value as ProjectLanguageId)}
            options={LANGUAGE_OPTIONS}
            ariaLabel="Primary language"
          />
          <p className={styles.languageNote}>
            {projectLanguage(language).note}
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="project-description">
            Description <span className={styles.optional}>optional</span>
          </label>
          <input
            id="project-description"
            className={styles.input}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this project is for"
            maxLength={160}
            autoComplete="off"
          />
        </div>
      </div>

      {error ? (
        <p id="project-error" className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <p className={styles.hint}>
        This writes a real project record to this browser's IndexedDB. It does not create files on
        disk yet.
      </p>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Create project'}
        </Button>
      </div>
    </form>
  )
}

type ImportPhase = 'idle' | 'scanning' | 'preview'

function ImportProjectFlow({
  onClose,
  onCompleted,
}: {
  onClose: () => void
  onCompleted: (project: ProjectRecord) => void
}) {
  const [phase, setPhase] = useState<ImportPhase>('idle')
  const [scan, setScan] = useState<ImportScan | null>(null)
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | undefined>(undefined)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = fileInputRef.current
    if (!input) {
      return
    }
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
  }, [])

  const chooseFolder = async () => {
    if (phase === 'scanning') {
      return
    }

    setError(null)
    setProgress(0)

    if (!supportsDirectoryPicker()) {
      fileInputRef.current?.click()
      return
    }

    setPhase('scanning')

    try {
      const picked = await window.showDirectoryPicker!({
        id: 'codepilot-project',
        mode: 'read',
      })
      const result = await scanDirectory(picked, setProgress)

      if (result.fileCount === 0) {
        setError('That folder contains no readable files.')
        setPhase('idle')
        return
      }

      setScan(result)
      setHandle(picked)
      setName(result.name)
      setPhase('preview')
    } catch (cause) {
      setPhase('idle')
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return
      }
      setError(
        describeError(
          cause,
          'The folder could not be read. Permission may have been denied.',
        ),
      )
    }
  }

  const onFilesPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    setError(null)
    setProgress(0)
    setPhase('scanning')

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0)
    })

    try {
      const result = scanFileList(files)
      if (result.fileCount === 0) {
        setError('No importable files were found in that selection.')
        setPhase('idle')
        return
      }

      setScan(result)
      setHandle(undefined)
      setName(result.name)
      setPhase('preview')
    } catch (cause) {
      setPhase('idle')
      setError(describeError(cause, 'The selection could not be read.'))
    }
  }

  const register = async () => {
    if (!scan || busy) {
      return
    }

    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('Give the project a record name of at least 2 characters.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      const existing = await findProjectByName(trimmed)
      if (existing) {
        setError(`“${trimmed}” already exists in the local registry.`)
        return
      }

      const project = await createProjectRecord({
        name: trimmed,
        language: scan.language,
        source: 'imported',
        modifiedAt: scan.modifiedAt,
        fileCount: scan.fileCount,
        sizeBytes: scan.sizeBytes,
        manifest: scan.manifest,
        truncated: scan.truncated,
        excluded: scan.excluded,
        directoryHandle: handle,
      })
      onCompleted(project)
    } catch (cause) {
      setError(
        describeError(
          cause,
          'The imported manifest could not be written to IndexedDB. Check storage availability.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'preview' && scan) {
    return (
      <div className={styles.form}>
        <div className={styles.scanSummary}>
          <div className={styles.scanHead}>
            <span className={styles.scanIcon} aria-hidden="true">
              <FolderOpen size={16} />
            </span>
            <div className={styles.scanTitle}>
              <span className={styles.label}>Folder scanned</span>
              <strong>{scan.name}</strong>
            </div>
            <span className={styles.scanLinked}>
              {handle ? 'Handle stored' : 'Manifest only'}
            </span>
          </div>

          <dl className={styles.facts}>
            <div>
              <dt>Files</dt>
              <dd>
                {scan.fileCount}
                {scan.truncated ? ` / ${MAX_IMPORT_FILES} cap` : ''}
              </dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(scan.sizeBytes)}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{scan.language}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{formatDate(scan.modifiedAt)}</dd>
            </div>
          </dl>

          {scan.languageBreakdown.length > 1 ? (
            <p className={styles.scanBreakdown}>
              {scan.languageBreakdown.map((entry) => `${entry.language} ${entry.files}`).join(' · ')}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="import-name">
            Project record name
          </label>
          <input
            id="import-name"
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            data-autofocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <p className={styles.policy}>
          Skipped by policy: {EXCLUDED_DIRECTORIES.join(', ')}.
        </p>
        {scan.excluded.length > 0 ? (
          <p className={styles.policy}>
            Found and skipped in this folder: {scan.excluded.join(', ')}.
          </p>
        ) : null}
        {scan.truncated ? (
          <p className={styles.warn}>
            The manifest stopped at {MAX_IMPORT_FILES} files or {MAX_IMPORT_DEPTH} directory
            levels. The record is real but incomplete, and says so here.
          </p>
        ) : null}
        {!handle ? (
          <p className={styles.warn}>
            This browser did not return a folder handle. The manifest is stored, but the folder will
            need to be selected again when the editor arrives.
          </p>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={chooseFolder} disabled={busy}>
            Choose another
          </Button>
          <Button onClick={register} disabled={busy}>
            {busy ? 'Registering…' : 'Register project'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.form}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFilesPicked}
      />

      <div className={styles.chooser} aria-busy={phase === 'scanning'}>
        <span className={styles.chooserIcon} aria-hidden="true">
          {phase === 'scanning' ? (
            <LoaderCircle size={22} className={styles.spinner} />
          ) : (
            <FolderOpen size={22} />
          )}
        </span>
        {phase === 'scanning' ? (
          <>
            <p className={styles.chooserTitle}>Reading the folder…</p>
            <p className={styles.chooserCopy}>
              {progress > 0
                ? `${progress} files read so far. Counting real files and sizes.`
                : 'Waiting for the folder picker, then reading real files and sizes.'}
            </p>
          </>
        ) : (
          <>
            <p className={styles.chooserTitle}>Choose a folder on this machine</p>
            <p className={styles.chooserCopy}>
              The scan reads file names, sizes and timestamps to build a local manifest. It never
              uploads anything.
            </p>
          </>
        )}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <p className={styles.policy}>
        Excluded from every scan: {EXCLUDED_DIRECTORIES.join(', ')}. Manifests are capped at{' '}
        {MAX_IMPORT_FILES} files and 12 directory levels.
      </p>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose} disabled={phase === 'scanning'}>
          Cancel
        </Button>
        <Button onClick={chooseFolder} disabled={phase === 'scanning'}>
          {phase === 'scanning' ? 'Scanning…' : 'Choose folder'}
        </Button>
      </div>
    </div>
  )
}
