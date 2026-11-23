import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CircleSlash,
  ClipboardPaste,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  History,
  LoaderCircle,
  PencilLine,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Select } from '../../design-system/primitives/Select'
import { listProjects, type ConversionRecord, type ProjectRecord } from '../../lib/db'
import { formatDate } from '../../lib/format'
import { logActivity } from '../../lib/activityService'
import {
  StoredPathError,
  createStoredEntry,
  listStoredEntries,
  loadFileContent,
  writeStoredContent,
} from '../../lib/projectStorage'
import { AiError } from '../copilot/errors'
import { useGateway } from '../copilot/gateway/store'
import { isConfigured, presetById, providerLabel } from '../copilot/providerPresets'
import { useAiSettings } from '../copilot/settingsStore'
import {
  PROJECT_LANGUAGES,
  projectLanguage,
  projectLanguageForMonaco,
} from '../editor/projectLanguages'
import { languageForPath } from '../editor/languageRegistry'
import {
  cancelExecution,
  ExecutionServiceError,
  fetchExecutionHealth,
  newJobId,
  runCode,
  type ExecutionStatus,
  type HealthResponse,
  type RunResponse,
} from '../execution/api'
import { StandaloneEditor } from '../execution/StandaloneEditor'
import {
  ConversionFailure,
  convertCode,
  type ConversionOutcome,
} from './convert'
import {
  deleteConversion,
  clearConversions,
  listConversions,
  newConversionId,
  saveConversion,
} from './conversionStorage'
import { diffLines } from './diff'
import { consumeStagedConversionSource } from './staging'
import styles from './ConverterPage.module.css'

type SourceMode = 'project' | 'editor' | 'paste'
type Decision = 'pending' | 'accepted' | 'rejected'

const SOURCE_MODES: { id: SourceMode; label: string; icon: typeof FolderOpen }[] = [
  { id: 'project', label: 'Project file', icon: FolderOpen },
  { id: 'editor', label: 'Write here', icon: PencilLine },
  { id: 'paste', label: 'Paste', icon: ClipboardPaste },
]

const STATUS_LABEL: Record<ExecutionStatus, string> = {
  ok: 'Completed',
  compile_error: 'Compilation failed',
  runtime_error: 'Runtime error',
  timeout: 'Time limit exceeded',
  unsupported: 'Runtime unavailable',
  cancelled: 'Stopped',
}

function statusTone(status: ExecutionStatus): 'ok' | 'warn' | 'danger' | 'muted' {
  if (status === 'ok') return 'ok'
  if (status === 'unsupported' || status === 'cancelled') return 'muted'
  if (status === 'compile_error') return 'danger'
  return 'warn'
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : ''
}

function baseName(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

function stripExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

function replaceExtension(path: string, extension: string): string {
  return `${stripExtension(path)}.${extension}`
}

/** Reads the project language from a real file path, falling back to the project's language. */
function languageForFile(path: string, fallback: string): string {
  const editor = languageForPath(path)
  const match = projectLanguageForMonaco(editor.id)
  return match?.id ?? fallback
}

export function ConverterPage() {
  const ai = useAiSettings()
  const [health, setHealth] = useState<HealthResponse | null>(null)

  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [entries, setEntries] = useState<string[]>([])
  const [filePath, setFilePath] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [sourceOrigin, setSourceOrigin] = useState<string | null>(null)

  const [mode, setMode] = useState<SourceMode>('project')
  const [sourceLanguage, setSourceLanguage] = useState('python')
  const [targetLanguage, setTargetLanguage] = useState('javascript')
  const [sourceCode, setSourceCode] = useState('')
  const [instructions, setInstructions] = useState('')

  const [converting, setConverting] = useState(false)
  const [streamed, setStreamed] = useState('')
  const [outcome, setOutcome] = useState<ConversionOutcome | null>(null)
  const [decision, setDecision] = useState<Decision>('pending')
  const [convertError, setConvertError] = useState<string | null>(null)
  const [conversionMeta, setConversionMeta] = useState<{ at: number; durationMs: number } | null>(
    null,
  )
  const [view, setView] = useState<'diff' | 'result'>('diff')

  const [validationStdin, setValidationStdin] = useState('')
  const [running, setRunning] = useState(false)
  const [validationJob, setValidationJob] = useState<string | null>(null)
  const [validation, setValidation] = useState<RunResponse | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const [history, setHistory] = useState<ConversionRecord[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [pendingClearHistory, setPendingClearHistory] = useState(false)

  const [savingOpen, setSavingOpen] = useState(false)
  const [saveProjectId, setSaveProjectId] = useState('')
  const [savePath, setSavePath] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveDone, setSaveDone] = useState<string | null>(null)
  const [pendingReplace, setPendingReplace] = useState(false)
  const [replaceBusy, setReplaceBusy] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [replaceDone, setReplaceDone] = useState<string | null>(null)
  const [copyDone, setCopyDone] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const startRef = useRef(0)

  const settings = ai.settings
  const gateway = useGateway()
  const preset = presetById(settings.preset)
  const gatewayAvailable =
    gateway.status !== null &&
    (gateway.status.managed.available || gateway.status.connections.length > 0)
  const configured =
    ai.loaded &&
    isConfigured(settings) &&
    (settings.route === 'gateway'
      ? gatewayAvailable
      : !preset?.keyExpected || settings.apiKey.trim().length > 0)
  const providerName =
    settings.route === 'gateway'
      ? gateway.status?.connection?.label ??
        (gateway.status?.managed.available ? gateway.status.managed.label : providerLabel(settings))
      : providerLabel(settings)
  const modelName =
    gateway.status?.connection?.model ??
    gateway.status?.managed.model ??
    settings.model
  const gatewayUnavailableMessage =
    gateway.reachable === null
      ? 'Checking CodePilot API availability…'
      : gateway.reachable === false
        ? gateway.error ?? 'The CodePilot API is unavailable.'
        : !gateway.user
          ? 'Sign in on Settings to use AI conversion.'
          : gateway.status?.managed.reason ??
            gateway.error ??
            'No managed or personal AI provider is available. Configure one in Settings.'

  const sourceLanguageInfo = projectLanguage(sourceLanguage)
  const targetLanguageInfo = projectLanguage(targetLanguage)
  const convertedCode = outcome?.code ?? ''
  const accepted = decision === 'accepted'
  const targetRuntime = targetLanguageInfo.runtime
  const targetSupport = health?.languages.find((entry) => entry.id === targetRuntime)
  const serviceOnline = Boolean(health?.ok)
  const validationRunnable = serviceOnline && Boolean(targetRuntime) && targetSupport?.executable !== false

  const diff = useMemo(
    () => (convertedCode ? diffLines(sourceCode, convertedCode) : null),
    [sourceCode, convertedCode],
  )

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: project.name,
        description: `${project.language} · ${project.fileCount} files`,
      })),
    [projects],
  )

  const fileOptions = useMemo(
    () =>
      entries.map((path) => ({
        value: path,
        label: baseName(path),
        description: path,
      })),
    [entries],
  )

  const saveProjectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: project.name,
        description: project.language,
      })),
    [projects],
  )

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await fetchExecutionHealth())
    } catch {
      setHealth(null)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshHealth()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshHealth])

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listConversions(50))
      setHistoryError(null)
    } catch {
      setHistoryError('Conversion history could not be read from IndexedDB.')
    } finally {
      setHistoryLoaded(true)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshHistory()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshHistory])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await listProjects()
        if (cancelled) {
          return
        }
        setProjects(rows)

        const staged = consumeStagedConversionSource()
        if (staged) {
          const project = rows.find((entry) => entry.id === staged.projectId)
          if (project) {
            const files = (await listStoredEntries(project.id))
              .filter((entry) => entry.kind === 'file')
              .map((entry) => entry.path)
              .sort((a, b) => a.localeCompare(b))
            if (cancelled) {
              return
            }
            setMode('project')
            setProjectId(project.id)
            setEntries(files)
            setFilePath(staged.path)
            setSourceCode(staged.code)
            setSourceOrigin(`Staged from the workspace · ${staged.path}`)
            setSourceLanguage(staged.language)
            const nextTarget = staged.language === 'python' ? 'javascript' : 'python'
            setTargetLanguage(nextTarget)
            setSaveProjectId(project.id)
          }
        } else if (rows.length > 0) {
          const first = rows[0]
          if (first) {
            setProjectId(first.id)
            setSaveProjectId(first.id)
          }
        }
      } finally {
        if (!cancelled) {
          setProjectsLoaded(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!projectId) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const rows = await listStoredEntries(projectId)
        if (cancelled) {
          return
        }
        const files = rows
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.path)
          .sort((a, b) => a.localeCompare(b))
        setEntries(files)
        setFileError(null)
      } catch {
        if (!cancelled) {
          setFileError('The file tree for this project could not be read from IndexedDB.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const node = streamRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [streamed])

  const loadProjectFile = async (path: string) => {
    const project = projects.find((entry) => entry.id === projectId)
    if (!project || !path) {
      return
    }
    setFileLoading(true)
    setFileError(null)
    try {
      const loaded = await loadFileContent(project, path)
      if (loaded.status === 'ready') {
        setSourceCode(loaded.content)
        setSourceOrigin(
          `${loaded.source === 'stored' ? 'Stored project content' : 'Linked folder'} · ${path}`,
        )
        setFilePath(path)
        setSourceLanguage(languageForFile(path, project.language))
        setSaveProjectId(project.id)
        setSavePath(replaceExtension(path, projectLanguage(targetLanguage).extension))
      } else {
        setFileError(loaded.reason)
        setSourceOrigin(null)
      }
    } catch {
      setFileError('The file could not be read.')
    } finally {
      setFileLoading(false)
    }
  }

  const chooseProject = (nextId: string) => {
    setProjectId(nextId)
    setEntries([])
    setFilePath('')
    setFileError(null)
    setSourceOrigin(null)
    setSaveProjectId(nextId)
  }

  const chooseFile = (path: string) => {
    setFilePath(path)
    setSourceOrigin(null)
    void loadProjectFile(path)
  }

  const switchMode = (next: SourceMode) => {
    setMode(next)
    if (next !== 'project') {
      setFileError(null)
      setSourceOrigin(next === 'editor' ? 'Written in the converter editor' : 'Pasted source')
    }
  }

  const swapLanguages = () => {
    setSourceLanguage(targetLanguage)
    setTargetLanguage(sourceLanguage)
    if (accepted && convertedCode) {
      setSourceCode(convertedCode)
      setSourceOrigin('Previous conversion result')
    }
    setOutcome(null)
    setDecision('pending')
    setConversionMeta(null)
    setConvertError(null)
    setValidation(null)
  }

  const run = async () => {
    if (converting) {
      return
    }
    if (!sourceCode.trim()) {
      setConvertError('There is no source code to convert.')
      return
    }
    if (!configured) {
      setConvertError(
        settings.route === 'gateway'
          ? gatewayUnavailableMessage
          : `No AI provider is ready. ${providerName} needs a base URL, a model and (when required) an API key in Settings.`,
      )
      return
    }
    if (sourceLanguage === targetLanguage) {
      setConvertError('Choose a different target language before converting.')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setConverting(true)
    setConvertError(null)
    setOutcome(null)
    setDecision('pending')
    setStreamed('')
    setCopyDone(false)
    setReplaceDone(null)
    setReplaceError(null)
    setPendingReplace(false)
    setSaveDone(null)
    setSaveError(null)
    setValidation(null)
    setValidationError(null)
    startRef.current = performance.now()

    try {
      const result = await convertCode({
        settings,
        sourceLanguage,
        targetLanguage,
        sourceCode,
        instructions,
        signal: controller.signal,
        onDelta: (chunk) => setStreamed((current) => current + chunk),
      })
      const durationMs = Math.round(performance.now() - startRef.current)
      setOutcome(result)
      setView('diff')
      setDecision('pending')
      setConversionMeta({ at: Date.now(), durationMs })

      const status: 'complete' | 'partial' =
        result.incomplete || result.warnings.length > 0 ? 'partial' : 'complete'

      await saveConversion({
        id: newConversionId(),
        projectId: mode === 'project' && projectId ? projectId : null,
        sourceLanguage,
        targetLanguage,
        sourceCode,
        convertedCode: result.code,
        instructions,
        status,
        notes: result.notes,
        warnings: result.warnings,
        providerLabel: providerName,
        model: modelName,
        createdAt: Date.now(),
        durationMs,
      })
      await refreshHistory()
      void logActivity({
        type: 'ai:convert',
        description: `Converted ${sourceLanguage} to ${targetLanguage} (${status})`,
        projectId: mode === 'project' && projectId ? projectId : undefined,
        projectName: projects.find((p) => p.id === projectId)?.name,
        status: status === 'complete' ? 'success' : 'info',
        details: JSON.stringify({
          sourceLanguage,
          targetLanguage,
          durationMs,
          warningsCount: result.warnings.length,
        }),
      })
    } catch (error) {
      const durationMs = Math.round(performance.now() - startRef.current)
      const aborted = error instanceof AiError && error.kind === 'aborted'
      const partial = error instanceof ConversionFailure ? error.partial : null
      const message =
        error instanceof AiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'The conversion failed before the provider returned a response.'

      if (partial && !aborted) {
        // Keep whatever the model produced so the user can review it instead of
        // losing the answer. It is labelled partial and never auto-accepted.
        setOutcome(partial)
        setView('diff')
        setDecision('pending')
        setConversionMeta({ at: Date.now(), durationMs })
        setConvertError(
          `${message} The partial reply was kept for review; it may be incomplete.`,
        )
        await saveConversion({
          id: newConversionId(),
          projectId: mode === 'project' && projectId ? projectId : null,
          sourceLanguage,
          targetLanguage,
          sourceCode,
          convertedCode: partial.code,
          instructions,
          status: 'partial',
          notes: partial.notes,
          warnings: [...partial.warnings, message],
          providerLabel: providerName,
          model: modelName,
          createdAt: Date.now(),
          durationMs,
        })
        await refreshHistory()
        void logActivity({
          type: 'ai:convert',
          description: `Converted ${sourceLanguage} to ${targetLanguage} (partial)`,
          projectId: mode === 'project' && projectId ? projectId : undefined,
          projectName: projects.find((p) => p.id === projectId)?.name,
          status: 'info',
        })
        return
      }

      setConvertError(aborted ? 'The conversion was cancelled before it completed.' : message)
      if (!aborted) {
        await saveConversion({
          id: newConversionId(),
          projectId: mode === 'project' && projectId ? projectId : null,
          sourceLanguage,
          targetLanguage,
          sourceCode,
          convertedCode: '',
          instructions,
          status: 'failed',
          notes: message,
          warnings: [],
          providerLabel: providerName,
          model: modelName,
          createdAt: Date.now(),
          durationMs,
        })
        await refreshHistory()
        void logActivity({
          type: 'ai:convert',
          description: `Failed conversion: ${sourceLanguage} to ${targetLanguage}`,
          projectId: mode === 'project' && projectId ? projectId : undefined,
          projectName: projects.find((p) => p.id === projectId)?.name,
          status: 'failure',
        })
      }
    } finally {
      abortRef.current = null
      setConverting(false)
    }
  }

  const cancelConversion = () => {
    abortRef.current?.abort()
  }

  const accept = () => {
    if (!outcome) {
      return
    }
    setDecision('accepted')
    setSavePath(
      mode === 'project' && filePath
        ? replaceExtension(filePath, targetLanguageInfo.extension)
        : `converted.${targetLanguageInfo.extension}`,
    )
    setSaveProjectId(projectId || projects[0]?.id || '')
  }

  const reject = () => {
    setDecision('rejected')
    setPendingReplace(false)
    setSaveDone(null)
    setSaveError(null)
    setCopyDone(false)
    setValidation(null)
    setValidationError(null)
  }

  const copyResult = async () => {
    if (!convertedCode) {
      return
    }
    try {
      await navigator.clipboard.writeText(convertedCode)
      setCopyDone(true)
      window.setTimeout(() => setCopyDone(false), 2200)
    } catch {
      setConvertError('The browser refused clipboard access, so nothing was copied.')
    }
  }

  const downloadResult = () => {
    if (!convertedCode) {
      return
    }
    const blob = new Blob([convertedCode], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `converted.${targetLanguageInfo.extension}`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const useAsSource = () => {
    if (!convertedCode) {
      return
    }
    setSourceCode(convertedCode)
    setSourceLanguage(targetLanguage)
    setSourceOrigin('Previous conversion result')
    setOutcome(null)
    setDecision('pending')
    setConversionMeta(null)
    setConvertError(null)
    setValidation(null)
    setValidationError(null)
    setSaveDone(null)
    setReplaceDone(null)
  }

  const openSaveForm = () => {
    setSavingOpen(true)
    setSaveDone(null)
    setSaveError(null)
    setSaveProjectId(projectId || projects[0]?.id || '')
    setSavePath(
      mode === 'project' && filePath
        ? replaceExtension(filePath, targetLanguageInfo.extension)
        : `converted.${targetLanguageInfo.extension}`,
    )
  }

  const saveAsNew = async () => {
    if (!convertedCode || saveBusy) {
      return
    }
    const targetProject = projects.find((entry) => entry.id === saveProjectId)
    if (!targetProject) {
      setSaveError('Choose a project to save into.')
      return
    }
    const cleanPath = savePath
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .replace(/\/+$/, '')
    const name = baseName(cleanPath)
    if (!name || !name.includes('.')) {
      setSaveError('Enter a file name with an extension, for example main.js.')
      return
    }
    setSaveBusy(true)
    setSaveError(null)
    try {
      const existing = await listStoredEntries(targetProject.id)
      if (existing.some((entry) => entry.path === cleanPath && entry.kind === 'file')) {
        setSaveError(
          `“${cleanPath}” already exists in ${targetProject.name}. Choose another path or use Replace for a project file.`,
        )
        return
      }
      await createStoredEntry(targetProject.id, parentOf(cleanPath), name, 'file')
      await writeStoredContent(targetProject.id, cleanPath, convertedCode)
      setSaveDone(`Saved ${cleanPath} to ${targetProject.name} in IndexedDB.`)
      setSavingOpen(false)
    } catch (error) {
      setSaveError(
        error instanceof StoredPathError
          ? error.message
          : 'The file could not be written to IndexedDB.',
      )
    } finally {
      setSaveBusy(false)
    }
  }

  const canReplace =
    accepted &&
    mode === 'project' &&
    Boolean(projectId) &&
    Boolean(filePath) &&
    !fileLoading

  const replaceFile = async () => {
    if (!canReplace || replaceBusy) {
      return
    }
    const project = projects.find((entry) => entry.id === projectId)
    if (!project) {
      return
    }
    setReplaceBusy(true)
    setReplaceError(null)
    try {
      await writeStoredContent(project.id, filePath, convertedCode)
      setReplaceDone(`Replaced ${filePath} in ${project.name}. The file is saved in IndexedDB.`)
      setPendingReplace(false)
      setSourceCode(convertedCode)
      setSourceLanguage(targetLanguage)
      setSourceOrigin(`Stored project content · ${filePath}`)
      setOutcome(null)
      setDecision('pending')
    } catch {
      setReplaceError('The stored file could not be replaced.')
    } finally {
      setReplaceBusy(false)
    }
  }

  const runValidation = async () => {
    if (!convertedCode || !targetRuntime || running) {
      return
    }
    const job = newJobId()
    setValidationJob(job)
    setRunning(true)
    setValidationError(null)
    try {
      setValidation(
        await runCode({
          language: targetRuntime,
          code: convertedCode,
          stdin: validationStdin,
          timeoutMs: 5000,
          jobId: job,
        }),
      )
    } catch (error) {
      setValidationError(
        error instanceof ExecutionServiceError
          ? error.message
          : 'The validation run failed before a result was returned.',
      )
    } finally {
      setRunning(false)
      setValidationJob(null)
    }
  }

  const stopValidation = async () => {
    if (!validationJob) {
      return
    }
    try {
      const result = await cancelExecution(validationJob)
      if (!result.cancelled) {
        setValidationError(result.message)
      }
    } catch (error) {
      setValidationError(
        error instanceof ExecutionServiceError
          ? error.message
          : 'The stop request could not be delivered.',
      )
    }
  }

  const restoreConversion = (id: string) => {
    const record = history.find((entry) => entry.id === id)
    if (!record) {
      return
    }
    setSourceLanguage(record.sourceLanguage)
    setTargetLanguage(record.targetLanguage)
    setSourceCode(record.sourceCode)
    setInstructions(record.instructions)
    setSourceOrigin(`Restored from conversion history · ${formatDate(record.createdAt)}`)
    setConvertError(null)
    setStreamed('')
    setConversionMeta({ at: record.createdAt, durationMs: record.durationMs })
    setValidation(null)
    setValidationError(null)
    setSaveDone(null)
    setReplaceDone(null)
    setReplaceError(null)
    setCopyDone(false)
    if (record.convertedCode) {
      setOutcome({
        raw: record.convertedCode,
        code: record.convertedCode,
        notes: record.notes,
        warnings: record.warnings,
        fenced: true,
        unclosedFence: false,
        incomplete: false,
        executable: projectLanguage(record.targetLanguage).runtime !== null,
        targetLanguage: record.targetLanguage,
      })
      setDecision('pending')
      setView('diff')
    } else {
      setOutcome(null)
      setDecision('pending')
      setConvertError(record.notes || 'That conversion failed; only the failure record was stored.')
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removeHistoryEntry = async (id: string) => {
    await deleteConversion(id)
    await refreshHistory()
  }

  const clearHistory = async () => {
    await clearConversions()
    setPendingClearHistory(false)
    await refreshHistory()
  }

  const projectHasFiles = entries.length > 0

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Phase 06 · Code Converter</p>
          <h1 className={styles.title}>
            Translate with review.
            <span className={styles.titleAccent}> Never silently.</span>
          </h1>
          <p className={styles.lede}>
            Convert a project file, a fresh draft or pasted code between nine languages. The
            converted program is shown as a real line diff, keeps its warnings visible, and can be
            validated by the local execution service before you save it.
          </p>
        </div>

        <div className={styles.statusCard}>
          <div className={styles.statusHead}>
            <span className={styles.statusIcon} aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div>
              <p className={styles.statusKicker}>AI provider</p>
              <p className={styles.statusValue}>{configured ? providerName : 'Not ready'}</p>
              <p className={styles.statusSub}>
                {configured
                  ? `${modelName || 'provider default model'} · ${settings.route === 'gateway' ? 'via CodePilot API' : `direct ${settings.provider}`}`
                  : ai.loaded
                    ? settings.route === 'gateway'
                      ? gatewayUnavailableMessage
                      : 'Configure a provider in Settings'
                    : 'Reading stored settings…'}
              </p>
            </div>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusChip} data-ok={serviceOnline}>
              <Terminal size={11} aria-hidden="true" />
              {serviceOnline ? 'Execution service online' : 'Execution service offline'}
            </span>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void refreshHealth()}
              aria-label="Re-check execution service"
              title="Re-check execution service"
            >
              <RefreshCw size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <section className={styles.controls} aria-label="Conversion setup">
        <div className={styles.modeBar}>
          <div className={styles.modeTabs} role="tablist" aria-label="Source input">
            {SOURCE_MODES.map((entry) => {
              const Icon = entry.icon
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === entry.id}
                  className={styles.modeTab}
                  data-active={mode === entry.id}
                  onClick={() => switchMode(entry.id)}
                >
                  <Icon size={12} aria-hidden="true" />
                  {entry.label}
                </button>
              )
            })}
          </div>
          <span className={styles.origin}>{sourceOrigin ?? 'Choose a source'}</span>
        </div>

        {mode === 'project' ? (
          <div className={styles.projectRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Project</span>
              <Select
                value={projectId}
                onChange={chooseProject}
                options={projectOptions}
                ariaLabel="Source project"
                placeholder={projectsLoaded ? 'No projects' : 'Loading…'}
                disabled={!projectsLoaded || projects.length === 0}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>File</span>
              <Select
                value={filePath}
                onChange={chooseFile}
                options={fileOptions}
                ariaLabel="Source file"
                placeholder={
                  !projectId ? 'Choose a project first' : projectHasFiles ? 'Choose a file' : 'No files'
                }
                disabled={!projectId || !projectHasFiles}
              />
            </label>
            <div className={styles.fileHint}>
              {fileLoading ? (
                <span>
                  <LoaderCircle size={12} className={styles.spin} aria-hidden="true" /> Reading…
                </span>
              ) : fileError ? (
                <span data-tone="danger">{fileError}</span>
              ) : sourceOrigin ? (
                <span data-tone="ok">Source loaded</span>
              ) : (
                <span>
                  {projectsLoaded && projects.length === 0
                    ? 'Create a project in the workspace first.'
                    : 'Files come from stored project content.'}
                </span>
              )}
            </div>
          </div>
        ) : null}

        <div className={styles.languageRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>From</span>
            <Select
              value={sourceLanguage}
              onChange={setSourceLanguage}
              options={PROJECT_LANGUAGES.map((language) => ({
                value: language.id,
                label: language.label,
                description: language.runtime ? 'Executable in the Lab' : 'Editor only',
              }))}
              ariaLabel="Source language"
            />
          </label>

          <button
            type="button"
            className={styles.swapButton}
            onClick={swapLanguages}
            aria-label="Swap source and target languages"
            title="Swap source and target languages"
          >
            <ArrowLeftRight size={14} aria-hidden="true" />
          </button>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>To</span>
            <Select
              value={targetLanguage}
              onChange={setTargetLanguage}
              options={PROJECT_LANGUAGES.map((language) => ({
                value: language.id,
                label: language.label,
                description: language.runtime ? 'Runnable for validation' : 'Editor only',
              }))}
              ariaLabel="Target language"
            />
          </label>

          <div className={styles.instructionField}>
            <label className={styles.fieldLabel} htmlFor="converter-instructions">
              Extra instructions (optional)
            </label>
            <input
              id="converter-instructions"
              className={styles.textInput}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="e.g. keep the original function names, avoid third-party packages"
              spellCheck={false}
            />
          </div>
        </div>

        <div className={styles.actionRow}>
          {converting ? (
            <button type="button" className={styles.stopButton} onClick={cancelConversion}>
              <Square size={13} aria-hidden="true" />
              Stop conversion
            </button>
          ) : (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void run()}
              disabled={!configured || !sourceCode.trim() || sourceLanguage === targetLanguage}
              title={
                !configured
                  ? 'Configure an AI provider in Settings first'
                  : sourceLanguage === targetLanguage
                    ? 'Source and target languages are identical'
                    : 'Convert the source program'
              }
            >
              <Sparkles size={13} aria-hidden="true" />
              Convert with AI
            </button>
          )}

          <span className={styles.actionMeta}>
            {converting
              ? `Streaming from ${providerName} · ${streamed.length.toLocaleString()} characters received`
              : conversionMeta
                ? `Last conversion ${new Date(conversionMeta.at).toLocaleTimeString()} · ${conversionMeta.durationMs} ms measured`
                : 'No conversion has run in this session'}
          </span>
        </div>

        {sourceLanguage === targetLanguage ? (
          <p className={styles.inlineWarning}>
            <TriangleAlert size={12} aria-hidden="true" />
            Source and target are the same language. Pick a different target to enable conversion.
          </p>
        ) : null}
      </section>

      <div className={styles.workspace}>
        <section className={styles.pane} aria-label="Source program">
          <div className={styles.paneHead}>
            <div>
              <p className={styles.paneKicker}>Source</p>
              <h2 className={styles.paneTitle}>{sourceLanguageInfo.label}</h2>
            </div>
            <span className={styles.charCount}>
              {sourceCode.length.toLocaleString()} chars · {sourceCode.split('\n').length} lines
            </span>
          </div>

          {mode === 'paste' ? (
            <textarea
              className={styles.pasteArea}
              value={sourceCode}
              onChange={(event) => {
                setSourceCode(event.target.value)
                setSourceOrigin('Pasted source')
              }}
              placeholder="Paste a complete program here"
              spellCheck={false}
              aria-label="Pasted source code"
            />
          ) : (
            <div className={styles.sourceEditor}>
              <StandaloneEditor
                value={sourceCode}
                language={sourceLanguageInfo.monaco}
                onChange={(next) => {
                  setSourceCode(next)
                  if (mode === 'editor') {
                    setSourceOrigin('Written in the converter editor')
                  }
                }}
                ariaLabel={`${sourceLanguageInfo.label} source`}
              />
            </div>
          )}

          <p className={styles.paneNote}>
            {sourceLanguageInfo.note} The converter never runs the source; only the target can be
            validated.
          </p>
        </section>

        <section className={styles.pane} aria-label="Conversion result">
          <div className={styles.paneHead}>
            <div>
              <p className={styles.paneKicker}>Result</p>
              <h2 className={styles.paneTitle}>{targetLanguageInfo.label}</h2>
            </div>
            <div className={styles.viewTabs} role="tablist" aria-label="Result view">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'diff'}
                data-active={view === 'diff'}
                onClick={() => setView('diff')}
                disabled={!convertedCode}
              >
                Diff
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'result'}
                data-active={view === 'result'}
                onClick={() => setView('result')}
                disabled={!convertedCode}
              >
                Code
              </button>
            </div>
          </div>

          {converting ? (
            <div className={styles.streamBox} ref={streamRef} aria-live="polite">
              <p className={styles.streamKicker}>Live provider stream</p>
              <pre>{streamed || 'Waiting for the first token…'}</pre>
            </div>
          ) : convertError && !outcome ? (
            <div className={styles.errorBox} role="alert">
              <TriangleAlert size={14} aria-hidden="true" />
              <div>
                <p>{convertError}</p>
                <button type="button" className={styles.linkButton} onClick={() => setConvertError(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : !outcome ? (
            <div className={styles.emptyState}>
              <span aria-hidden="true">
                <Sparkles size={18} />
              </span>
              <p>
                No conversion yet. Choose a source, pick a target language and start a conversion.
                The reply appears here with its notes, approximations and a real line diff.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.resultBar}>
                <span className={styles.decisionPill} data-decision={decision}>
                  {decision === 'accepted'
                    ? 'Accepted'
                    : decision === 'rejected'
                      ? 'Rejected'
                      : 'Awaiting review'}
                </span>
                {diff?.status === 'ok' ? (
                  <span className={styles.diffStats}>
                    <span data-kind="add">+{diff.added}</span>
                    <span data-kind="remove">−{diff.removed}</span>
                    <span>{diff.rows.length} rows</span>
                  </span>
                ) : null}
                {outcome.incomplete ? (
                  <span className={styles.truncatedChip}>
                    <TriangleAlert size={10} aria-hidden="true" /> Incomplete reply
                  </span>
                ) : null}
              </div>

              {convertError ? (
                <div className={styles.errorBox} role="alert">
                  <TriangleAlert size={14} aria-hidden="true" />
                  <p>{convertError}</p>
                </div>
              ) : null}

              {view === 'diff' ? (
                diff?.status === 'ok' ? (
                  <div className={styles.diffView} role="table" aria-label="Line diff">
                    {diff.rows.map((row, index) => (
                      <div
                        key={`${row.kind}-${index}`}
                        className={styles.diffRow}
                        data-kind={row.kind}
                        role="row"
                      >
                        <span className={styles.diffLine} aria-hidden="true">
                          {row.leftLine ?? ''}
                        </span>
                        <span className={styles.diffLine} aria-hidden="true">
                          {row.rightLine ?? ''}
                        </span>
                        <span className={styles.diffSign} aria-hidden="true">
                          {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}
                        </span>
                        <code className={styles.diffText}>{row.text || ' '}</code>
                      </div>
                    ))}
                  </div>
                ) : diff ? (
                  <div className={styles.emptyState}>
                    <TriangleAlert size={16} aria-hidden="true" />
                    <p>
                      This diff is too large to compute in the page ({diff.leftLines} source lines
                      against {diff.rightLines} converted lines). Switch to the Code view to review
                      the result.
                    </p>
                  </div>
                ) : null
              ) : (
                <div className={styles.resultEditor}>
                  <StandaloneEditor
                    value={convertedCode}
                    language={targetLanguageInfo.monaco}
                    onChange={(next) => setOutcome((current) => (current ? { ...current, code: next } : current))}
                    readOnly={!accepted}
                    ariaLabel={`Converted ${targetLanguageInfo.label} code`}
                  />
                </div>
              )}

              <div className={styles.reviewActions}>
                {decision === 'pending' ? (
                  <>
                    <button type="button" className={styles.acceptButton} onClick={accept}>
                      <Check size={13} aria-hidden="true" />
                      Accept conversion
                    </button>
                    <button type="button" className={styles.rejectButton} onClick={reject}>
                      <X size={13} aria-hidden="true" />
                      Reject
                    </button>
                  </>
                ) : decision === 'rejected' ? (
                  <>
                    <span className={styles.rejectedNote}>
                      <CircleSlash size={13} aria-hidden="true" />
                      Rejected. File actions are disabled; run the conversion again to review a new
                      result.
                    </span>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setDecision('pending')}
                    >
                      Reopen review
                    </button>
                  </>
                ) : (
                  <span className={styles.acceptedNote}>
                    <Check size={13} aria-hidden="true" />
                    Accepted. Review the notes, then copy, download or save it.
                  </span>
                )}
              </div>

              <div className={styles.notesGrid}>
                <div>
                  <h3 className={styles.notesTitle}>Model notes</h3>
                  <p className={styles.notesBody}>
                    {outcome.notes || 'The model returned no notes for this conversion.'}
                  </p>
                </div>
                <div>
                  <h3 className={styles.notesTitle}>
                    Approximations
                    <span>{outcome.warnings.length}</span>
                  </h3>
                  {outcome.warnings.length === 0 ? (
                    <p className={styles.notesBody}>
                      The model reported no approximations. That is not a guarantee of identical
                      behaviour; validate the target before relying on it.
                    </p>
                  ) : (
                    <ul className={styles.warningList}>
                      {outcome.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {accepted ? (
                <>
                  <div className={styles.fileActions}>
                    <button type="button" className={styles.ghostButton} onClick={() => void copyResult()}>
                      <Copy size={12} aria-hidden="true" />
                      {copyDone ? 'Copied' : 'Copy'}
                    </button>
                    <button type="button" className={styles.ghostButton} onClick={downloadResult}>
                      <Download size={12} aria-hidden="true" />
                      Download
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={openSaveForm}
                      disabled={projects.length === 0}
                      title={
                        projects.length === 0
                          ? 'Create a project in the workspace first'
                          : 'Save the converted code as a new stored file'
                      }
                    >
                      <FilePlus2 size={12} aria-hidden="true" />
                      Save as new
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setPendingReplace(true)}
                      disabled={!canReplace}
                      title={
                        canReplace
                          ? `Replace ${filePath} in the project`
                          : 'Replace is available for a project file source'
                      }
                    >
                      <Save size={12} aria-hidden="true" />
                      Replace file
                    </button>
                    <button type="button" className={styles.ghostButton} onClick={useAsSource}>
                      <ArrowRight size={12} aria-hidden="true" />
                      Use as source
                    </button>
                  </div>

                  {saveDone ? (
                    <p className={styles.successNote} role="status">
                      <Check size={12} aria-hidden="true" />
                      {saveDone}
                    </p>
                  ) : null}
                  {replaceDone ? (
                    <p className={styles.successNote} role="status">
                      <Check size={12} aria-hidden="true" />
                      {replaceDone}
                    </p>
                  ) : null}
                  {replaceError ? (
                    <p className={styles.errorNote} role="alert">
                      {replaceError}
                    </p>
                  ) : null}
                </>
              ) : null}

              {pendingReplace ? (
                <div className={styles.confirmBox} role="alertdialog" aria-label="Confirm file replacement">
                  <p>
                    Replace <code>{filePath}</code> in {projects.find((entry) => entry.id === projectId)?.name ?? 'the project'} with the
                    converted code? The stored IndexedDB copy is overwritten; a linked folder on disk
                    is not written.
                  </p>
                  {replaceExtension(filePath, targetLanguageInfo.extension) !== filePath ? (
                    <p className={styles.confirmExtra}>
                      The file keeps its current name even though the target language is{' '}
                      {targetLanguageInfo.label}. Use <strong>Save as new</strong> if you want a
                      matching extension.
                    </p>
                  ) : null}
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => void replaceFile()}
                      disabled={replaceBusy}
                    >
                      {replaceBusy ? 'Replacing…' : 'Confirm replace'}
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setPendingReplace(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {savingOpen ? (
                <div className={styles.saveForm}>
                  <p className={styles.saveTitle}>Save converted code as a new file</p>
                  <div className={styles.saveRow}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Project</span>
                      <Select
                        value={saveProjectId}
                        onChange={setSaveProjectId}
                        options={saveProjectOptions}
                        ariaLabel="Save target project"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Path</span>
                      <input
                        className={styles.textInput}
                        value={savePath}
                        onChange={(event) => setSavePath(event.target.value)}
                        spellCheck={false}
                        placeholder={`src/main.${targetLanguageInfo.extension}`}
                      />
                    </label>
                  </div>
                  {saveError ? (
                    <p className={styles.errorNote} role="alert">
                      {saveError}
                    </p>
                  ) : null}
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={styles.acceptButton}
                      onClick={() => void saveAsNew()}
                      disabled={saveBusy}
                    >
                      {saveBusy ? 'Saving…' : 'Save file'}
                    </button>
                    <button type="button" className={styles.ghostButton} onClick={() => setSavingOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              <div className={styles.validation}>
                <div className={styles.validationHead}>
                  <h3 className={styles.notesTitle}>
                    <Terminal size={12} aria-hidden="true" />
                    Validation run
                  </h3>
                  <span className={styles.validationNote}>
                    {targetRuntime
                      ? serviceOnline
                        ? `Runs the converted ${targetLanguageInfo.label} locally`
                        : 'Execution service offline — start it with npm run exec'
                      : `${targetLanguageInfo.label} has no runtime in this build`}
                  </span>
                </div>

                {targetRuntime ? (
                  <>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>stdin for the validation run</span>
                      <textarea
                        className={styles.stdinArea}
                        value={validationStdin}
                        onChange={(event) => setValidationStdin(event.target.value)}
                        rows={2}
                        spellCheck={false}
                        placeholder="Input the converted program will receive"
                      />
                    </label>
                    <div className={styles.validationActions}>
                      {running ? (
                        <button type="button" className={styles.stopButton} onClick={() => void stopValidation()}>
                          <Square size={12} aria-hidden="true" />
                          Stop
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={() => void runValidation()}
                          disabled={!accepted || !validationRunnable}
                        >
                          <Play size={12} aria-hidden="true" />
                          Run validation
                        </button>
                      )}
                      <span className={styles.validationNote}>
                        {accepted
                          ? 'A real process, measured duration and untouched output.'
                          : 'Accept the conversion to enable validation.'}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className={styles.validationNote}>
                    {targetLanguageInfo.note} Validation is therefore unavailable rather than
                    simulated.
                  </p>
                )}

                {validationError ? (
                  <div className={styles.errorBox} role="alert">
                    <TriangleAlert size={13} aria-hidden="true" />
                    <p>{validationError}</p>
                  </div>
                ) : null}

                {validation ? (
                  <div className={styles.validationOutput}>
                    <div className={styles.validationStatus}>
                      <span className={styles.statusPill} data-tone={statusTone(validation.status)}>
                        {STATUS_LABEL[validation.status] ?? validation.status}
                      </span>
                      <span>{validation.results[0]?.durationMs ?? 0} ms measured</span>
                      {validation.compile ? <span>{validation.compile.durationMs} ms compile</span> : null}
                    </div>
                    {validation.status === 'compile_error' ? (
                      <pre className={styles.validationStream} data-stream="stderr">
                        {validation.message ?? 'Compilation failed.'}
                      </pre>
                    ) : (
                      <>
                        <pre className={styles.validationStream} data-stream="stdout">
                          {validation.results[0]?.stdout || '(no stdout)'}
                        </pre>
                        <pre className={styles.validationStream} data-stream="stderr">
                          {validation.results[0]?.stderr || '(no stderr)'}
                        </pre>
                        {validation.results[0]?.message ? (
                          <p className={styles.errorNote}>{validation.results[0].message}</p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      <section className={styles.history} aria-label="Conversion history">
        <div className={styles.historyHead}>
          <div>
            <p className={styles.paneKicker}>Persisted locally</p>
            <h2 className={styles.historyTitle}>
              <History size={15} aria-hidden="true" />
              Conversion history
              <span>{history.length}</span>
            </h2>
          </div>
          <div className={styles.historyActions}>
            <button type="button" className={styles.ghostButton} onClick={() => void refreshHistory()}>
              <RefreshCw size={12} aria-hidden="true" />
              Refresh
            </button>
            {pendingClearHistory ? (
              <>
                <button type="button" className={styles.dangerButton} onClick={() => void clearHistory()}>
                  Clear all {history.length}
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setPendingClearHistory(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setPendingClearHistory(true)}
                disabled={history.length === 0}
              >
                <Trash2 size={12} aria-hidden="true" />
                Clear history
              </button>
            )}
          </div>
        </div>

        {historyError ? <p className={styles.errorNote}>{historyError}</p> : null}

        {!historyLoaded ? (
          <p className={styles.historyEmpty}>
            <LoaderCircle size={13} className={styles.spin} aria-hidden="true" /> Reading stored
            conversions…
          </p>
        ) : history.length === 0 ? (
          <p className={styles.historyEmpty}>
            No conversions stored yet. Every completed, partial or failed conversion is written
            here with its real provider, model, duration and warnings.
          </p>
        ) : (
          <ul className={styles.historyList}>
            {history.map((record) => (
              <li key={record.id} className={styles.historyItem}>
                <div className={styles.historyTop}>
                  <span className={styles.historyLanguages}>
                    {projectLanguage(record.sourceLanguage).label}
                    <ArrowRight size={11} aria-hidden="true" />
                    {projectLanguage(record.targetLanguage).label}
                  </span>
                  <span className={styles.historyStatus} data-status={record.status}>
                    {record.status}
                  </span>
                  <span className={styles.historyTime}>{formatDate(record.createdAt)}</span>
                </div>
                <p className={styles.historyMeta}>
                  {record.providerLabel} · {record.model || 'no model recorded'} ·{' '}
                  {record.durationMs} ms · {record.convertedCode.length.toLocaleString()} chars
                  {record.warnings.length > 0 ? ` · ${record.warnings.length} warnings` : ''}
                </p>
                <p className={styles.historyNotes}>
                  {record.notes ? record.notes.slice(0, 220) : 'No notes were returned.'}
                </p>
                <div className={styles.historyItemActions}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => restoreConversion(record.id)}
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                    Restore into the converter
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => void removeHistoryEntry(record.id)}
                    aria-label="Delete this conversion record"
                    title="Delete this conversion record"
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className={styles.footnote}>
        Conversions are produced by the provider configured in Settings; this app cannot verify the
        model's claims, so notes and approximations stay visible. Saving and replacing write to the
        IndexedDB copy of the project, not to a linked folder on disk.
      </p>
    </main>
  )
}
