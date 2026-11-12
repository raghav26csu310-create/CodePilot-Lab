import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { createStoredEntry, loadFileContent } from '../../lib/projectStorage'
import { useEditorCommands } from '../editor/EditorCommandsContext'
import { buildContextBundle, DEFAULT_CONTEXT_OPTIONS, summarizeContext } from './context'
import { AiError, describeAiError, toAiError } from './errors'
import { buildSystemPrompt, buildUserPrompt } from './prompts'
import { isConfigured, providerLabel } from './providerPresets'
import { adapterForSettings } from './providers'
import { useAiSettings } from './settingsStore'
import { attachProposalIds, parseProposals } from './proposals'
import type {
  AiChatTurn,
  AiErrorKind,
  AppliedRevision,
  CapabilityId,
  CodeProposal,
  ContextBundle,
  ContextOptions,
  CopilotMessage,
  CopilotStatus,
  ExplainLevel,
  ProposalPreview,
} from './types'
import { findNode } from '../workspace/state/fileTree'
import { useWorkspace } from '../workspace/state/useWorkspace'

type ApplyResult = { ok: boolean; message?: string }

type ComposerSeed = {
  id: number
  text: string
  capability: CapabilityId
  level: ExplainLevel
}

type CopilotContextValue = {
  messages: CopilotMessage[]
  revisions: AppliedRevision[]
  appliedByProposal: Record<string, string>
  generating: boolean
  status: CopilotStatus
  statusError: { message: string; kind: AiErrorKind } | null
  providerLabel: string
  model: string
  configured: boolean
  verified: boolean
  capability: CapabilityId
  setCapability(capability: CapabilityId): void
  level: ExplainLevel
  setLevel(level: ExplainLevel): void
  contextOptions: ContextOptions
  setContextOptions(options: ContextOptions): void
  composerSeed: ComposerSeed | null
  seedComposer(text: string, capability?: CapabilityId, level?: ExplainLevel): void
  consumeComposerSeed(): void
  send(text: string, override?: { capability?: CapabilityId; level?: ExplainLevel }): Promise<void>
  stop(): void
  clearConversation(): void
  toggleContextPath(path: string): void
  clearContextAttachments(): void
  buildContext(): Promise<ContextBundle>
  previewProposal(proposal: CodeProposal): Promise<ProposalPreview>
  applyProposal(proposal: CodeProposal): Promise<ApplyResult>
  restoreRevision(revisionId: string): Promise<ApplyResult>
  isApplied(proposalId: string): string | null
}

const CopilotContext = createContext<CopilotContextValue | null>(null)

let seedCounter = 0

function messageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function revisionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : ''
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const { project, state, dispatch } = useWorkspace()
  const commands = useEditorCommands()
  const { settings, loaded, lastTest } = useAiSettings()

  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [generating, setGenerating] = useState(false)
  const [statusError, setStatusError] = useState<{ message: string; kind: AiErrorKind } | null>(
    null,
  )
  const [capability, setCapability] = useState<CapabilityId>('chat')
  const [level, setLevel] = useState<ExplainLevel>('intermediate')
  const [contextOptions, setContextOptionsState] =
    useState<ContextOptions>(DEFAULT_CONTEXT_OPTIONS)
  const [revisions, setRevisions] = useState<AppliedRevision[]>([])
  const [appliedByProposal, setAppliedByProposal] = useState<Record<string, string>>({})
  const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null)
  const [verifiedSignature, setVerifiedSignature] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)

  const signature = `${settings.provider}|${settings.baseUrl}|${settings.model}|${settings.apiKey}`

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const setContextOptions = useCallback((options: ContextOptions) => {
    setContextOptionsState(options)
  }, [])

  const toggleContextPath = useCallback(
    (path: string) => {
      dispatch({ type: 'ui/toggle-copilot-context', path })
    },
    [dispatch],
  )

  const clearContextAttachments = useCallback(() => {
    dispatch({ type: 'ui/clear-copilot-context' })
  }, [dispatch])

  const buildContext = useCallback(async (): Promise<ContextBundle> => {
    const current = state
    return buildContextBundle({
      project,
      tabs: current.tree.tabs,
      nodes: current.tree.nodes,
      activePath: current.tree.activeTabPath,
      selection: current.ui.selection,
      markers: current.ui.markers,
      attached: current.ui.copilotContext,
      options: contextOptions,
      getDraft: (path) => commands.current?.getDraft(path) ?? null,
      contextChars: settings.contextChars,
    })
  }, [project, state, contextOptions, settings.contextChars, commands])

  const seedComposer = useCallback(
    (text: string, nextCapability?: CapabilityId, nextLevel?: ExplainLevel) => {
      seedCounter += 1
      setComposerSeed({
        id: seedCounter,
        text,
        capability: nextCapability ?? 'debug',
        level: nextLevel ?? 'intermediate',
      })
      if (nextCapability) {
        setCapability(nextCapability)
      }
      if (nextLevel) {
        setLevel(nextLevel)
      }

      // Reveal the panel that currently hosts the Copilot.
      if (window.matchMedia('(min-width: 1024px)').matches) {
        if (!state.ui.copilotOpen) {
          dispatch({ type: 'ui/toggle-copilot' })
        }
      } else {
        dispatch({ type: 'ui/open-mobile-panel', panel: 'copilot' })
      }
    },
    [dispatch, state.ui.copilotOpen],
  )

  const consumeComposerSeed = useCallback(() => {
    setComposerSeed(null)
  }, [])

  const send = useCallback(
    async (
      text: string,
      override?: { capability?: CapabilityId; level?: ExplainLevel },
    ) => {
      if (busyRef.current) {
        return
      }

      const usedCapability = override?.capability ?? capability
      const usedLevel = override?.level ?? level

      if (!loaded || !isConfigured(settings)) {
        setStatusError({
          message:
            'No provider and model are configured. Open AI provider settings, choose a provider, and save a model before sending. Nothing was sent.',
          kind: 'invalid-settings',
        })
        return
      }

      const current = state
      const selection = current.ui.selection
      const activePath = current.tree.activeTabPath

      busyRef.current = true
      setGenerating(true)
      setStatusError(null)

      try {
        const bundle = await buildContextBundle({
          project,
          tabs: current.tree.tabs,
          nodes: current.tree.nodes,
          activePath,
          selection,
          markers: current.ui.markers,
          attached: current.ui.copilotContext,
          options: contextOptions,
          getDraft: (path) => commands.current?.getDraft(path) ?? null,
          contextChars: settings.contextChars,
        })
        const summary = summarizeContext(bundle)

        const now = Date.now()
        const userMessage: CopilotMessage = {
          id: messageId(),
          role: 'user',
          content: text.trim(),
          createdAt: now,
          status: 'complete',
          capability: usedCapability,
          level: usedLevel,
          contextSummary: summary,
          proposals: [],
        }

        const assistantId = messageId()
        const assistantMessage: CopilotMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: now + 1,
          status: 'streaming',
          capability: usedCapability,
          level: usedLevel,
          contextSummary: null,
          proposals: [],
          providerLabel: providerLabel(settings),
          model: settings.model,
        }

        const prior = messages
          .filter(
            (message) =>
              (message.role === 'user' || message.role === 'assistant') &&
              (message.status === 'complete' || message.status === 'stopped') &&
              message.content.trim().length > 0,
          )
          .slice(-Math.max(0, settings.historyDepth) * 2)

        setMessages((previous) => [...previous, userMessage, assistantMessage])

        const turns: AiChatTurn[] = [
          {
            role: 'system',
            content: buildSystemPrompt({
              capability: usedCapability,
              level: usedLevel,
              projectName: project.name,
              projectLanguage: project.language,
              context: bundle,
            }),
          },
          ...prior.map<AiChatTurn>((message) => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: message.content,
          })),
          {
            role: 'user',
            content: buildUserPrompt({
              capability: usedCapability,
              level: usedLevel,
              projectName: project.name,
              projectLanguage: project.language,
              context: bundle,
              userText: text,
            }),
          },
        ]

        const controller = new AbortController()
        abortRef.current = controller
        const startedAt = performance.now()
        let buffer = ''
        let flushTimer: number | null = null

        const flush = () => {
          flushTimer = null
          const snapshot = buffer
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId ? { ...message, content: snapshot } : message,
            ),
          )
        }

        const scheduleFlush = () => {
          if (flushTimer === null) {
            flushTimer = window.setTimeout(flush, 40)
          }
        }

        try {
          await adapterForSettings(settings).stream({
            settings,
            turns,
            signal: controller.signal,
            onDelta: (chunk) => {
              buffer += chunk
              scheduleFlush()
            },
          })

          if (flushTimer !== null) {
            window.clearTimeout(flushTimer)
            flushTimer = null
          }
          flush()

          const elapsedMs = Math.round(performance.now() - startedAt)
          const parsed = parseProposals(buffer)

          if (buffer.trim().length === 0) {
            const empty = new AiError(
              'provider',
              'The provider finished without returning any text. The model may be unavailable or the request may have been filtered.',
            )
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      status: 'error',
                      error: empty.message,
                      errorKind: empty.kind,
                      elapsedMs,
                    }
                  : message,
              ),
            )
            setStatusError({ message: empty.message, kind: empty.kind })
          } else {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: parsed.text,
                      status: 'complete',
                      elapsedMs,
                      proposals: attachProposalIds(assistantId, parsed.proposals),
                    }
                  : message,
              ),
            )
            setVerifiedSignature(signature)
          }
        } catch (cause) {
          if (flushTimer !== null) {
            window.clearTimeout(flushTimer)
            flushTimer = null
          }

          const error = toAiError(cause, settings.baseUrl)
          const elapsedMs = Math.round(performance.now() - startedAt)
          const parsed = parseProposals(buffer)
          const stopped = error.kind === 'aborted'

          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: parsed.text,
                    status: stopped ? 'stopped' : 'error',
                    proposals: [],
                    elapsedMs,
                    error: stopped ? undefined : describeAiError(error),
                    errorKind: stopped ? undefined : error.kind,
                  }
                : message,
            ),
          )

          if (!stopped) {
            setStatusError({ message: describeAiError(error), kind: error.kind })
          }
        } finally {
          abortRef.current = null
        }
      } catch (cause) {
        const error = toAiError(cause, settings.baseUrl)
        setStatusError({ message: describeAiError(error), kind: error.kind })
      } finally {
        busyRef.current = false
        setGenerating(false)
      }
    },
    [
      capability,
      level,
      settings,
      loaded,
      project,
      state,
      messages,
      contextOptions,
      commands,
      signature,
    ],
  )

  const clearConversation = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setStatusError(null)
  }, [])

  const previewProposal = useCallback(
    async (proposal: CodeProposal): Promise<ProposalPreview> => {
      const current = state
      const node = findNode(current.tree.nodes, proposal.path)
      const exists = node?.kind === 'file'
      const tab = current.tree.tabs.find((candidate) => candidate.path === proposal.path)
      const draft = commands.current?.getDraft(proposal.path) ?? null

      if (draft !== null) {
        return {
          proposal,
          exists,
          before: draft,
          beforeSource: 'draft',
          after: proposal.content,
        }
      }

      if (tab && tab.status === 'ready') {
        return {
          proposal,
          exists,
          before: tab.content,
          beforeSource: tab.source === 'disk' ? 'disk' : 'stored',
          after: proposal.content,
        }
      }

      const loaded = await loadFileContent(project, proposal.path)
      if (loaded.status === 'ready') {
        return {
          proposal,
          exists,
          before: loaded.content,
          beforeSource: loaded.source,
          after: proposal.content,
        }
      }

      return {
        proposal,
        exists,
        before: '',
        beforeSource: 'missing',
        after: proposal.content,
      }
    },
    [project, state, commands],
  )

  const applyProposal = useCallback(
    async (proposal: CodeProposal): Promise<ApplyResult> => {
      if (proposal.invalidReason) {
        return { ok: false, message: proposal.invalidReason }
      }

      const current = state
      const node = findNode(current.tree.nodes, proposal.path)
      const exists = node?.kind === 'file'

      if (proposal.mode === 'replace' && !exists) {
        return {
          ok: false,
          message: `${proposal.path} is not a file in this project. Use create mode for a new file.`,
        }
      }

      if (proposal.mode === 'create' && exists) {
        return {
          ok: false,
          message: `${proposal.path} already exists. Reject this proposal and ask for replace mode instead.`,
        }
      }

      if (proposal.mode === 'create') {
        const parent = parentOf(proposal.path)
        const parentNode = parent ? findNode(current.tree.nodes, parent) : null
        if (parent && (!parentNode || parentNode.kind !== 'folder')) {
          return {
            ok: false,
            message: `The folder ${parent} does not exist. Create it in the explorer first, then apply again.`,
          }
        }
      }

      const preview = await previewProposal(proposal)
      if (proposal.mode === 'replace' && preview.beforeSource === 'missing') {
        return {
          ok: false,
          message:
            'The current file content could not be read, so replacing it would be blind. Open the file in the editor and try again.',
        }
      }

      if (proposal.mode === 'create') {
        try {
          await createStoredEntry(project.id, parentOf(proposal.path), nameOf(proposal.path), 'file')
        } catch (cause) {
          return {
            ok: false,
            message:
              cause instanceof Error && cause.message
                ? cause.message
                : 'The new file entry could not be created.',
          }
        }

        dispatch({
          type: 'entry/create',
          parentPath: parentOf(proposal.path),
          name: nameOf(proposal.path),
          kind: 'file',
        })
      }

      const result = await commands.current?.applyContent(proposal.path, proposal.content)
      if (!result || !result.ok) {
        return {
          ok: false,
          message: result?.message ?? 'The editor is not available to apply this change.',
        }
      }

      const revision: AppliedRevision = {
        id: revisionId(),
        proposalId: proposal.id,
        path: proposal.path,
        previousContent: preview.before,
        createdAt: Date.now(),
        restoredAt: null,
      }

      setRevisions((previous) => [revision, ...previous])
      setAppliedByProposal((previous) => ({ ...previous, [proposal.id]: revision.id }))

      dispatch({
        type: 'ui/show-toast',
        tone: 'ok',
        message: `Applied ${proposal.path} to the editor buffer — save to persist it.`,
      })

      return { ok: true }
    },
    [project, state, commands, dispatch, previewProposal],
  )

  const restoreRevision = useCallback(
    async (id: string): Promise<ApplyResult> => {
      const revision = revisions.find((entry) => entry.id === id)
      if (!revision) {
        return { ok: false, message: 'That revision is no longer in this session.' }
      }

      const result = await commands.current?.applyContent(
        revision.path,
        revision.previousContent,
      )
      if (!result || !result.ok) {
        return {
          ok: false,
          message: result?.message ?? 'The editor is not available to restore this revision.',
        }
      }

      setRevisions((previous) =>
        previous.map((entry) =>
          entry.id === id ? { ...entry, restoredAt: Date.now() } : entry,
        ),
      )
      dispatch({
        type: 'ui/show-toast',
        tone: 'ok',
        message: `Restored the previous ${revision.path} content in the editor buffer — save to persist it.`,
      })
      return { ok: true }
    },
    [revisions, commands, dispatch],
  )

  const isApplied = useCallback(
    (proposalId: string) => appliedByProposal[proposalId] ?? null,
    [appliedByProposal],
  )

  const verified =
    (verifiedSignature !== null && verifiedSignature === signature) ||
    (loaded && lastTest?.ok === true && lastTest.baseUrl === settings.baseUrl)

  const status: CopilotStatus = generating
    ? 'generating'
    : !isConfigured(settings)
      ? 'unconfigured'
      : statusError?.kind === 'rate-limit'
        ? 'rate-limited'
        : verified
          ? 'verified'
          : statusError
            ? 'error'
            : 'configured'

  const value = useMemo<CopilotContextValue>(
    () => ({
      messages,
      revisions,
      appliedByProposal,
      generating,
      status,
      statusError,
      providerLabel: providerLabel(settings),
      model: settings.model,
      configured: isConfigured(settings),
      verified,
      capability,
      setCapability,
      level,
      setLevel,
      contextOptions,
      setContextOptions,
      composerSeed,
      seedComposer,
      consumeComposerSeed,
      send,
      stop,
      clearConversation,
      toggleContextPath,
      clearContextAttachments,
      buildContext,
      previewProposal,
      applyProposal,
      restoreRevision,
      isApplied,
    }),
    [
      messages,
      revisions,
      appliedByProposal,
      generating,
      status,
      statusError,
      settings,
      verified,
      capability,
      level,
      contextOptions,
      composerSeed,
      seedComposer,
      consumeComposerSeed,
      send,
      stop,
      clearConversation,
      toggleContextPath,
      clearContextAttachments,
      buildContext,
      previewProposal,
      applyProposal,
      restoreRevision,
      isApplied,
      setContextOptions,
    ],
  )

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>
}

export function useCopilot(): CopilotContextValue {
  const context = useContext(CopilotContext)
  if (!context) {
    throw new Error('useCopilot must be used inside CopilotProvider')
  }
  return context
}

export type { ApplyResult, CopilotContextValue }
