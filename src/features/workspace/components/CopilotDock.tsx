import {
  ArrowUpRight,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileCode2,
  FileDiff,
  FlaskConical,
  GraduationCap,
  Layers,
  Loader2,
  MessageSquare,
  Paperclip,
  Plug,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Link } from 'react-router-dom'

import { formatChars } from '../../../lib/format'
import { useCopilot } from '../../copilot/CopilotContext'
import { collectContextPaths } from '../../copilot/context'
import { DiffDialog } from '../../copilot/DiffDialog'
import { Markdown } from '../../copilot/markdown'
import { CAPABILITIES, capabilityMeta } from '../../copilot/prompts'
import { ProviderSettingsForm } from '../../copilot/ProviderSettingsForm'
import { useAiSettings } from '../../copilot/settingsStore'
import type {
  CapabilityId,
  CodeProposal,
  CopilotMessage,
  ExplainLevel,
  ContextBundle,
  ContextOptions,
} from '../../copilot/types'
import { useWorkspace } from '../state/useWorkspace'
import { findNode } from '../state/fileTree'
import styles from './CopilotDock.module.css'

type CopilotDockProps = {
  variant?: 'inline' | 'drawer'
  onRequestClose?: () => void
}

const CAPABILITY_ICONS: Record<CapabilityId, typeof Sparkles> = {
  chat: MessageSquare,
  explain: BookOpen,
  debug: Bug,
  generate: Wand2,
  review: ShieldCheck,
  tests: FlaskConical,
  learn: GraduationCap,
}

const LEVELS: { id: ExplainLevel; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
]

const CONTEXT_TOGGLES: { key: keyof ContextOptions; label: string; hint: string }[] = [
  { key: 'includeActiveFile', label: 'Active file', hint: 'The file in the editor' },
  { key: 'includeSelection', label: 'Selection', hint: 'Only the highlighted range' },
  { key: 'includeTree', label: 'Project tree', hint: 'File and folder names only' },
  { key: 'includeDiagnostics', label: 'Diagnostics', hint: 'Open-buffer problems' },
]

function statusLabel(status: ReturnType<typeof useCopilot>['status']): string {
  switch (status) {
    case 'unconfigured':
      return 'No provider configured'
    case 'configured':
      return 'Configured · unverified'
    case 'verified':
      return 'Verified in this session'
    case 'generating':
      return 'Generating'
    case 'rate-limited':
      return 'Rate limited'
    case 'testing':
      return 'Testing'
    case 'error':
      return 'Provider error'
    default:
      return status
  }
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

export function CopilotDock({ variant = 'inline', onRequestClose }: CopilotDockProps) {
  const { project, state } = useWorkspace()
  const snapshot = useAiSettings()
  const {
    messages,
    revisions,
    generating,
    status,
    statusError,
    providerLabel,
    model,
    configured,
    capability,
    setCapability,
    level,
    setLevel,
    contextOptions,
    setContextOptions,
    consumeComposerSeed,
    composerSeed,
    send,
    stop,
    clearConversation,
    toggleContextPath,
    clearContextAttachments,
    buildContext,
    restoreRevision,
    isApplied,
  } = useCopilot()

  const [draft, setDraft] = useState('')
  const [showSettings, setShowSettings] = useState(!configured)
  const [showContext, setShowContext] = useState(false)
  const [contextPreview, setContextPreview] = useState<ContextBundle | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [dialogProposal, setDialogProposal] = useState<CodeProposal | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])

  const threadRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const { tabs, activeTabPath, nodes } = state.tree
  const { selection, markers, copilotContext } = state.ui
  const activeTab = tabs.find((tab) => tab.path === activeTabPath) ?? null
  const activeNode = activeTabPath ? findNode(nodes, activeTabPath) : null

  const plannedPaths = useMemo(
    () =>
      collectContextPaths(
        activeTabPath,
        selection,
        copilotContext,
        contextOptions,
        nodes,
      ),
    [activeTabPath, selection, copilotContext, contextOptions, nodes],
  )

  // Composer seeds arrive from Problems/quick actions. Defer the state write so
  // the effect stays asynchronous (React hooks lint rejects sync setState).
  useEffect(() => {
    if (!composerSeed) {
      return
    }

    const timer = window.setTimeout(() => {
      setDraft(composerSeed.text)
      if (composerSeed.capability) {
        setCapability(composerSeed.capability)
      }
      if (composerSeed.level) {
        setLevel(composerSeed.level)
      }
      consumeComposerSeed()
      window.requestAnimationFrame(() => textareaRef.current?.focus())
    }, 0)

    return () => window.clearTimeout(timer)
  }, [composerSeed, setCapability, setLevel, consumeComposerSeed])

  useEffect(() => {
    if (!configured) {
      return
    }
    const element = bottomRef.current
    if (element) {
      element.scrollIntoView({ block: 'end' })
    }
  }, [messages, configured])

  const meta = capabilityMeta(capability)
  const localProvider = isLocalUrl(snapshot.settings.baseUrl)
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const lastAssistant = latestAssistant && latestAssistant.status !== 'streaming' ? latestAssistant : null

  const submit = (text: string, override?: CapabilityId) => {
    if (generating) {
      return
    }

    if (!configured) {
      setShowSettings(true)
      return
    }

    const used = override ?? capability
    if (!text.trim() && used === 'chat') {
      return
    }

    setDraft('')
    void send(text, { capability: used, level })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit(draft)
    }
  }

  const copyMessage = (message: CopilotMessage) => {
    if (!message.content.trim()) {
      return
    }
    void navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopyingId(message.id)
        window.setTimeout(() => setCopyingId(null), 1600)
      })
      .catch(() => setCopyingId(null))
  }

  const refreshPreview = async () => {
    setPreviewing(true)
    try {
      const bundle = await buildContext()
      setContextPreview(bundle)
    } finally {
      setPreviewing(false)
    }
  }

  const suggestions = useMemo(() => {
    const items: { label: string; capability: CapabilityId; text: string }[] = []
    const name = activeTab?.name ?? 'the active file'

    if (selection) {
      items.push({
        label: 'Explain the selection',
        capability: 'explain',
        text: '',
      })
      items.push({
        label: 'Review the selection',
        capability: 'review',
        text: 'Review the selected code.',
      })
    }
    if (markers.length > 0) {
      items.push({
        label: `Debug ${markers.length} diagnostic${markers.length === 1 ? '' : 's'}`,
        capability: 'debug',
        text: '',
      })
    }
    if (activeNode) {
      items.push({ label: `Explain ${name}`, capability: 'explain', text: '' })
      items.push({ label: `Tests for ${name}`, capability: 'tests', text: '' })
      items.push({ label: `Review ${name}`, capability: 'review', text: 'Review this file.' })
      items.push({
        label: `Ideas for ${name}`,
        capability: 'generate',
        text: `Suggest a concrete improvement for ${name} and propose the complete file if it needs a change.`,
      })
    }
    items.push({
      label: 'Teach me this project',
      capability: 'learn',
      text: 'Where should I start reading this project, and why? Give me a first hint before any solution.',
    })

    return items.slice(0, 5)
  }, [selection, markers, activeNode, activeTab])

  const contextCounts = [
    `${plannedPaths.length} file${plannedPaths.length === 1 ? '' : 's'}`,
    selection ? `${Math.max(1, selection.endLine - selection.startLine + 1)} selected line${selection.endLine - selection.startLine === 0 ? '' : 's'}` : null,
    contextOptions.includeTree ? `${nodes.length} root item${nodes.length === 1 ? '' : 's'}` : null,
    contextOptions.includeDiagnostics && markers.length > 0
      ? `${markers.length} diagnostic${markers.length === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean)

  return (
    <aside className={styles.panel} data-variant={variant} aria-label="AI Copilot">
      <header className={styles.head}>
        <div className={styles.identity}>
          <span className={styles.avatar} data-status={status}>
            <Sparkles size={15} />
          </span>
          <div className={styles.identityText}>
            <div className={styles.identityTitle}>
              <span>Copilot</span>
              <span className={styles.state} data-status={status}>
                {statusLabel(status)}
              </span>
            </div>
            <div className={styles.identityMeta}>
              {configured ? (
                <>
                  <span>{providerLabel}</span>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.model}>{model || 'no model'}</span>
                  <span className={styles.scope} data-local={localProvider || undefined}>
                    {localProvider ? 'local' : 'remote'}
                  </span>
                </>
              ) : (
                <span>Workspace works without AI — configure only if you want it.</span>
              )}
            </div>
          </div>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="AI provider settings"
            aria-pressed={showSettings}
            onClick={() => setShowSettings((current) => !current)}
          >
            <Settings2 size={15} />
          </button>
          {onRequestClose ? (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Close Copilot"
              onClick={onRequestClose}
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </header>

      {showSettings ? (
        <div className={styles.settingsView}>
          <div className={styles.settingsBar}>
            <div>
              <p className={styles.kicker}>AI bridge · configuration</p>
              <h2>Provider settings</h2>
            </div>
            <Link to="/settings" className={styles.settingsLink}>
              Full page
              <ArrowUpRight size={13} />
            </Link>
          </div>
          <div className={styles.settingsBody}>
            <ProviderSettingsForm
              compact
              onSaved={() => {
                window.setTimeout(() => setShowSettings(false), 1200)
              }}
            />
          </div>
        </div>
      ) : (
        <>
          <div className={styles.contextBar}>
            <button
              type="button"
              className={styles.contextButton}
              onClick={() => {
                setShowContext((current) => !current)
                if (!showContext && !contextPreview) {
                  void refreshPreview()
                }
              }}
              aria-expanded={showContext}
            >
              <Layers size={13} />
              <span>Context</span>
              <span className={styles.contextCount}>{contextCounts.join(' · ')}</span>
              <ChevronDown size={12} data-open={showContext || undefined} />
            </button>
            {selection ? (
              <span className={styles.selectionPill} title={`${selection.path}:${selection.startLine}`}>
                <FileCode2 size={11} />
                {selection.path.slice(selection.path.lastIndexOf('/') + 1)}:{selection.startLine}
              </span>
            ) : null}
          </div>

          {showContext ? (
            <div className={styles.contextPanel}>
              <div className={styles.toggleGrid}>
                {CONTEXT_TOGGLES.map((toggle) => (
                  <label key={toggle.key} className={styles.toggle} title={toggle.hint}>
                    <input
                      type="checkbox"
                      checked={contextOptions[toggle.key]}
                      onChange={(event) =>
                        setContextOptions({
                          ...contextOptions,
                          [toggle.key]: event.target.checked,
                        })
                      }
                    />
                    <span>
                      {toggle.label}
                      <small>{toggle.hint}</small>
                    </span>
                  </label>
                ))}
              </div>

              <div className={styles.attachBlock}>
                <div className={styles.attachHead}>
                  <span>
                    <Paperclip size={12} /> Explicitly attached files
                  </span>
                  {copilotContext.length > 0 ? (
                    <button type="button" onClick={clearContextAttachments}>
                      Clear
                    </button>
                  ) : null}
                </div>
                {copilotContext.length === 0 ? (
                  <p className={styles.attachEmpty}>
                    None. Use <em>Attach to Copilot</em> on a file tab or in the explorer context
                    menu. The active file is only shared when the toggle above is on.
                  </p>
                ) : (
                  <ul className={styles.attachList}>
                    {copilotContext.map((path) => {
                      const node = findNode(nodes, path)
                      return (
                        <li key={path}>
                          <FileCode2 size={11} />
                          <span title={path}>{path}</span>
                          {!node ? <em>missing</em> : null}
                          <button
                            type="button"
                            aria-label={`Remove ${path} from context`}
                            onClick={() => toggleContextPath(path)}
                          >
                            <X size={11} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {activeTabPath && !copilotContext.includes(activeTabPath) ? (
                  <button
                    type="button"
                    className={styles.attachActive}
                    onClick={() => toggleContextPath(activeTabPath)}
                  >
                    <Paperclip size={11} />
                    Attach the active file explicitly
                  </button>
                ) : null}
              </div>

              <div className={styles.previewBlock}>
                <div className={styles.previewHead}>
                  <span>Exact bundle</span>
                  <button type="button" onClick={() => void refreshPreview()} disabled={previewing}>
                    {previewing ? <Loader2 size={11} className={styles.spin} /> : null}
                    {previewing ? 'Reading…' : 'Re-read'}
                  </button>
                </div>
                {contextPreview ? (
                  <div className={styles.previewBody}>
                    <p>
                      {contextPreview.files.length} file
                      {contextPreview.files.length === 1 ? '' : 's'} ·{' '}
                      {formatChars(contextPreview.totalChars)} characters ·{' '}
                      {contextPreview.diagnostics.length} diagnostic
                      {contextPreview.diagnostics.length === 1 ? '' : 's'}
                      {contextPreview.tree.length > 0
                        ? ` · ${contextPreview.tree.length} tree entries`
                        : ''}
                    </p>
                    <ul>
                      {contextPreview.files.map((file) => (
                        <li key={file.path}>
                          <span>{file.path}</span>
                          <em data-tone={file.source === 'unavailable' ? 'warn' : undefined}>
                            {file.source === 'unavailable'
                              ? 'unavailable'
                              : `${formatChars(file.chars)}${file.truncated ? ' truncated' : ''}`}
                          </em>
                        </li>
                      ))}
                    </ul>
                    {contextPreview.selection ? (
                      <p className={styles.previewSelection}>
                        Selection: {contextPreview.selection.path} lines{' '}
                        {contextPreview.selection.startLine}–{contextPreview.selection.endLine}
                        {contextPreview.selection.truncated ? ' (truncated)' : ''}
                      </p>
                    ) : null}
                    {contextPreview.omitted.length > 0 ? (
                      <p className={styles.previewWarn}>
                        {contextPreview.omitted.length} file
                        {contextPreview.omitted.length === 1 ? '' : 's'} could not be read and are
                        reported as unavailable to the model.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className={styles.attachEmpty}>
                    Nothing is sent until you press Send. Read the exact bundle before sending.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {statusError ? (
            <div className={styles.statusError} data-kind={statusError.kind} role="alert">
              <CircleAlert size={14} />
              <div>
                <p>{statusError.message}</p>
                {!configured ? (
                  <button type="button" onClick={() => setShowSettings(true)}>
                    <Plug size={12} /> Configure a provider
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className={styles.thread} ref={threadRef}>
            {messages.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyArt} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <Sparkles size={20} />
                </div>
                <h2>Project-aware assistant</h2>
                <p>
                  {configured
                    ? `${providerLabel} · ${model}. Ask about ${project.name}; context is limited to the files you allow.`
                    : 'Choose a provider to start. Until then, the editor, storage and diagnostics keep working with no AI calls.'}
                </p>

                <div className={styles.capabilityGrid}>
                  {CAPABILITIES.filter((entry) => entry.id !== 'chat').map((entry) => {
                    const Icon = CAPABILITY_ICONS[entry.id]
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={styles.capabilityCard}
                        data-active={capability === entry.id || undefined}
                        onClick={() => {
                          setCapability(entry.id)
                          if (entry.id === 'chat' || !configured) {
                            return
                          }
                          void send('', { capability: entry.id, level })
                        }}
                        title={entry.description}
                      >
                        <Icon size={14} />
                        <span>{entry.short}</span>
                      </button>
                    )
                  })}
                </div>

                <div className={styles.suggestionList}>
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.label}
                      type="button"
                      className={styles.suggestion}
                      onClick={() => {
                        setCapability(suggestion.capability)
                        if (!configured) {
                          setShowSettings(true)
                          setDraft(suggestion.text)
                          return
                        }
                        void send(suggestion.text, {
                          capability: suggestion.capability,
                          level,
                        })
                      }}
                    >
                      <span>{suggestion.label}</span>
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.messages}>
                {messages.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    copyingId={copyingId}
                    onCopy={() => copyMessage(message)}
                    appliedByProposal={isApplied}
                    dismissed={dismissed}
                    onDismiss={(id) =>
                      setDismissed((current) =>
                        current.includes(id) ? current : [...current, id],
                      )
                    }
                    onReview={(proposal) => setDialogProposal(proposal)}
                  />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {revisions.length > 0 ? (
            <details className={styles.revisions}>
              <summary>
                <RotateCcw size={12} />
                Applied revisions ({revisions.length})
                <span>restore any previous buffer</span>
              </summary>
              <ul>
                {revisions.slice(0, 8).map((revision) => (
                  <li key={revision.id}>
                    <div>
                      <span>{revision.path}</span>
                      <em>
                        {formatTime(revision.createdAt)}
                        {revision.restoredAt ? ' · restored' : ''}
                      </em>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreRevision(revision.id)}
                      disabled={revision.restoredAt !== null}
                    >
                      {revision.restoredAt ? <Check size={11} /> : <RotateCcw size={11} />}
                      {revision.restoredAt ? 'Restored' : 'Restore'}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className={styles.composer}>
            <div className={styles.composerTop}>
              <label className={styles.capabilitySelect}>
                <span className={styles.srOnly}>Task</span>
                <select
                  value={capability}
                  onChange={(event) => setCapability(event.target.value as CapabilityId)}
                >
                  {CAPABILITIES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
              {capability === 'explain' || capability === 'learn' ? (
                <div className={styles.levelGroup} role="group" aria-label="Explanation level">
                  {LEVELS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      data-active={level === entry.id || undefined}
                      onClick={() => setLevel(entry.id)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className={styles.taskHint}>{meta.description}</span>
              )}
            </div>

            <div className={styles.inputRow}>
              <textarea
                ref={textareaRef}
                rows={3}
                value={draft}
                placeholder={meta.placeholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                aria-label="Message Copilot"
              />
              {generating ? (
                <button
                  type="button"
                  className={styles.stopButton}
                  onClick={stop}
                  aria-label="Stop generating"
                >
                  <Square size={13} />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.sendButton}
                  onClick={() => submit(draft)}
                  disabled={!draft.trim() && capability === 'chat'}
                  aria-label="Send message"
                >
                  <Send size={14} />
                </button>
              )}
            </div>

            <div className={styles.composerFoot}>
              <span>
                Enter sends · Shift+Enter newline ·{' '}
                {localProvider ? 'requests stay local' : 'remote request when sent'}
              </span>
              <div className={styles.composerActions}>
                {lastAssistant ? (
                  <button type="button" onClick={() => copyMessage(lastAssistant)}>
                    {copyingId === lastAssistant.id ? <Check size={11} /> : <Copy size={11} />}
                    {copyingId === lastAssistant.id ? 'Copied' : 'Copy'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={clearConversation}
                  disabled={messages.length === 0 || generating}
                >
                  <Trash2 size={11} />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <DiffDialog proposal={dialogProposal} onClose={() => setDialogProposal(null)} />
    </aside>
  )
}

type MessageItemProps = {
  message: CopilotMessage
  copyingId: string | null
  onCopy(): void
  appliedByProposal(proposalId: string): string | null
  dismissed: string[]
  onDismiss(proposalId: string): void
  onReview(proposal: CodeProposal): void
}

function MessageItem({
  message,
  copyingId,
  onCopy,
  appliedByProposal,
  dismissed,
  onDismiss,
  onReview,
}: MessageItemProps) {
  const isUser = message.role === 'user'
  const Icon = message.role === 'user' ? FileCode2 : Sparkles
  const meta = capabilityMeta(message.capability)
  const appliedRevision = message.proposals
    .map((proposal) => appliedByProposal(proposal.id))
    .find((value) => value !== null)

  return (
    <article className={styles.message} data-role={message.role}>
      <header className={styles.messageHead}>
        <span className={styles.messageAvatar} data-role={message.role}>
          <Icon size={12} />
        </span>
        <span className={styles.messageRole}>
          {isUser ? 'You' : (message.model ? `${message.providerLabel} · ${message.model}` : 'Copilot')}
        </span>
        <span className={styles.messageCap}>{meta.short}</span>
        {message.level !== 'intermediate' && !isUser ? (
          <span className={styles.messageCap}>{message.level}</span>
        ) : null}
        <span className={styles.messageTime}>{formatTime(message.createdAt)}</span>
      </header>

      {isUser ? (
        <div className={styles.userBubble}>
          <p>{message.content}</p>
          {message.contextSummary ? (
            <details className={styles.contextDetails}>
              <summary>
                <Layers size={10} />
                Shared {message.contextSummary.files.length} file
                {message.contextSummary.files.length === 1 ? '' : 's'} ·{' '}
                {formatChars(message.contextSummary.totalChars)}
                {message.contextSummary.selectionLines > 0
                  ? ` · ${message.contextSummary.selectionLines} selected lines`
                  : ''}
                {message.contextSummary.diagnostics > 0
                  ? ` · ${message.contextSummary.diagnostics} diagnostics`
                  : ''}
              </summary>
              <ul>
                {message.contextSummary.files.map((file) => (
                  <li key={file.path}>
                    {file.path} · {file.language} · {formatChars(file.chars)}
                    {file.truncated ? ' (truncated)' : ''}
                  </li>
                ))}
                {message.contextSummary.files.length === 0 ? (
                  <li>No files were shared for this turn.</li>
                ) : null}
              </ul>
            </details>
          ) : null}
        </div>
      ) : (
        <div className={styles.assistantBody}>
          {message.content ? (
            <Markdown text={message.content} />
          ) : message.status === 'streaming' ? (
            <span className={styles.thinking}>
              <span className={styles.thinkingDot} />
              Waiting for the first token…
            </span>
          ) : null}

          {message.proposals.filter((proposal) => !dismissed.includes(proposal.id)).length > 0 ? (
            <div className={styles.proposals}>
              {message.proposals
                .filter((proposal) => !dismissed.includes(proposal.id))
                .map((proposal) => {
                  const revision = appliedByProposal(proposal.id)
                  return (
                    <div
                      key={proposal.id}
                      className={styles.proposalCard}
                      data-invalid={proposal.invalidReason !== null || undefined}
                    >
                      <div className={styles.proposalHead}>
                        <FileDiff size={13} />
                        <code>{proposal.path}</code>
                        <span className={styles.proposalMode}>{proposal.mode}</span>
                        {revision ? <span className={styles.appliedTag}>applied</span> : null}
                      </div>
                      {proposal.summary ? (
                        <p className={styles.proposalSummary}>{proposal.summary}</p>
                      ) : null}
                      {proposal.invalidReason ? (
                        <p className={styles.proposalProblem}>{proposal.invalidReason}</p>
                      ) : (
                        <p className={styles.proposalMeta}>
                          Complete file · {proposal.content.split(/\r?\n/).length} lines
                        </p>
                      )}
                      <div className={styles.proposalActions}>
                        <button
                          type="button"
                          className={styles.proposalPrimary}
                          onClick={() => onReview(proposal)}
                          disabled={proposal.invalidReason !== null}
                        >
                          <FileDiff size={12} />
                          Review diff
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismiss(proposal.id)}
                          aria-label={`Reject proposal for ${proposal.path}`}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : null}

          {message.status === 'streaming' ? (
            <div className={styles.streamingRow}>
              <Loader2 size={12} className={styles.spin} />
              Streaming… press Stop to keep the partial answer.
            </div>
          ) : null}

          {message.status === 'stopped' ? (
            <p className={styles.stoppedNote}>Generation stopped. Partial text kept.</p>
          ) : null}

          {message.status === 'error' && message.error ? (
            <p className={styles.messageError}>
              <CircleAlert size={12} />
              {message.error}
            </p>
          ) : null}

          {message.status !== 'streaming' && message.content ? (
            <div className={styles.messageActions}>
              <button type="button" onClick={onCopy}>
                {copyingId === message.id ? <Check size={11} /> : <Copy size={11} />}
                {copyingId === message.id ? 'Copied' : 'Copy'}
              </button>
              {message.elapsedMs !== undefined ? (
                <span>
                  {message.elapsedMs < 1000
                    ? `${message.elapsedMs} ms`
                    : `${(message.elapsedMs / 1000).toFixed(1)} s`}
                </span>
              ) : null}
              {appliedRevision ? <span>change applied</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </article>
  )
}
