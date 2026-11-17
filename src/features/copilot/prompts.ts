import type { CapabilityId, ContextBundle, ExplainLevel } from './types'

export type CapabilityMeta = {
  id: CapabilityId
  label: string
  short: string
  description: string
  /** Placeholder for the composer when this capability is active. */
  placeholder: string
}

export const CAPABILITIES: CapabilityMeta[] = [
  {
    id: 'chat',
    label: 'Ask Copilot',
    short: 'Chat',
    description: 'Ask about the project with the attached context available.',
    placeholder: 'Ask about this project…',
  },
  {
    id: 'explain',
    label: 'Explain code',
    short: 'Explain',
    description: 'Walk through the selected code or active file line by line.',
    placeholder: 'What should the explanation focus on? (optional)',
  },
  {
    id: 'debug',
    label: 'Debug assistant',
    short: 'Debug',
    description: 'Inspect diagnostics and errors, find the root cause, propose a fix.',
    placeholder: 'Describe the symptom, or run it against the current diagnostics…',
  },
  {
    id: 'generate',
    label: 'Generate code',
    short: 'Generate',
    description: 'Write functions, snippets or complete files that match this project.',
    placeholder: 'Describe the function or file you need…',
  },
  {
    id: 'review',
    label: 'Code review',
    short: 'Review',
    description: 'Review bugs, readability, performance and common security issues.',
    placeholder: 'Anything specific to focus the review on? (optional)',
  },
  {
    id: 'refactor',
    label: 'Refactor',
    short: 'Refactor',
    description: 'Restructure the selected code without changing its observable behaviour.',
    placeholder: 'Describe the refactor you want, or leave blank for a behaviour-preserving pass…',
  },
  {
    id: 'tests',
    label: 'Generate tests',
    short: 'Tests',
    description: 'Suggest test cases, edge cases and expected outcomes.',
    placeholder: 'Name the framework or the behaviour to cover…',
  },
  {
    id: 'agent',
    label: 'Coding agent',
    short: 'Agent',
    description: 'Inspect the real workspace, plan a change, and propose reviewable file edits.',
    placeholder: 'Describe the project task. The agent will inspect relevant files first…',
  },
  {
    id: 'learn',
    label: 'Learning assistant',
    short: 'Learn',
    description: 'Progressive hints first — the full solution only when you ask.',
    placeholder: 'What are you trying to understand or build?',
  },
]

export function capabilityMeta(id: CapabilityId): CapabilityMeta {
  return CAPABILITIES.find((entry) => entry.id === id) ?? CAPABILITIES[0]!
}

const PROPOSAL_PROTOCOL = `## Proposing file changes

When a change to a project file would help, propose it as a complete file. Use exactly this fenced block, with four backticks:

\`\`\`\`codepilot path="relative/path.ext" mode="replace" summary="one line"
<the complete new contents of the file>
\`\`\`\`

Rules:
- \`path\` is relative to the project root, using forward slashes.
- \`mode\` is "replace" for an existing file or "create" for a new file.
- The block must contain the ENTIRE file, not a fragment and not an ellipsis.
- For a new file, the parent folder must already exist in the project tree.
- Never claim a file was changed. The user reviews a diff and applies it.
- Explain the change briefly in prose before the block.
- Do not put a codepilot block inside another code fence.`

const LEVEL_GUIDANCE: Record<ExplainLevel, string> = {
  beginner:
    'Explain for a beginner: define jargon, use small concrete analogies, and keep sentences short. Do not skip steps.',
  intermediate:
    'Explain for a working developer: focus on control flow, data shapes and trade-offs. Skim syntax basics.',
  advanced:
    'Explain for an expert: be dense and precise about invariants, complexity, edge cases and architectural consequences.',
}

const CAPABILITY_GUIDANCE: Record<CapabilityId, string> = {
  chat:
    "Answer the user's question about this project. Use the supplied context; if the answer is not in it, say what is missing instead of guessing.",
  explain:
    'Explain the relevant code. Follow the code top to bottom, name what each meaningful block does, and call out non-obvious concepts. When the selection is present, explain that selection specifically.',
  debug:
    'Diagnose the reported problem. Separate evidence (diagnostics, code, stack traces the user pasted) from hypotheses. State the root cause, then the smallest correct fix. If a file change is warranted, propose the complete file.',
  generate:
    'Write code that fits the existing project: same language, module style, naming and imports. Keep it runnable, with no placeholder TODOs unless the user asked for a skeleton. Prefer a complete file proposal when creating a new file.',
  review:
    'Review the supplied code. Report concrete findings grouped as Bugs, Readability, Performance and Security. Each finding needs a file path and line reference when available. Do not invent problems to pad the list; say when a category is clean.',
  refactor:
    'Refactor the supplied code without changing observable behaviour. Preserve the public interface, error behaviour, ordering and comments that carry meaning. State what improved and why, list the behaviour that must stay identical, and propose the complete refactored file so the change can be reviewed as a diff.',
  tests:
    'Design tests for the supplied code. List cases as a table or bullets with input, expected outcome and why it matters. Cover unhappy paths and edge cases, not only the happy path. If the user asks for test code, propose a complete test file that matches the project conventions.',
  agent:
    'Act as a controlled project coding agent. Use only the real workspace inspection report and supplied file contents. Briefly state the task understanding and a concrete plan before proposing changes. Identify files to inspect or change, explain relevant dependencies/imports, and call out missing evidence. Never claim a tool ran unless the local agent evidence explicitly says it did. Do not invent file contents, run commands, or apply changes; propose complete files using the reviewable codepilot protocol so the user can preview, accept, or reject each change.',
  learn:
    'Teach rather than solve. Start with one or two progressive hints and a question that helps the user reason it out. Do not reveal the complete solution until the user explicitly asks for it; then explain it thoroughly.',
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b([A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|private[_-]?key|credential|password)[A-Za-z0-9_]*\s*[:=]\s*["']?)[^\s"'`,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED KEY]')
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
}

export type PromptInput = {
  capability: CapabilityId
  level: ExplainLevel
  projectName: string
  projectLanguage: string
  context: ContextBundle
  userText: string
  agentEvidence?: string
}

function renderTree(context: ContextBundle): string {
  if (context.tree.length === 0) {
    return 'Project tree: not shared.'
  }
  const lines = context.tree.join('\n')
  return `Project tree (folders end with /):\n${lines}${context.treeTruncated ? '\n…tree truncated to the shared file limit.' : ''}`
}

function renderDiagnostics(context: ContextBundle): string {
  if (context.diagnostics.length === 0) {
    return 'Diagnostics: none supplied.'
  }

  const lines = context.diagnostics
    .map(
      (entry) =>
        `- ${entry.path}:${entry.line}:${entry.column} [${entry.severity}] ${entry.message} (${entry.source})`,
    )
    .join('\n')
  return `Diagnostics from open editor models:\n${lines}`
}

function renderSelection(context: ContextBundle): string {
  if (!context.selection) {
    return 'Selection: none.'
  }

  const { selection } = context
  return `Selected code in ${selection.path} (lines ${selection.startLine}–${selection.endLine}):\n\`\`\`\n${selection.text}${selection.truncated ? '\n…selection truncated.' : ''}\n\`\`\``
}

function renderFiles(context: ContextBundle): string {
  if (context.files.length === 0) {
    return 'Project files shared: none.'
  }

  const blocks = context.files.map((file) => {
    const header = `### ${file.path} (${file.language}${file.dirty ? ', unsaved draft' : ''}${
      file.truncated ? `, truncated from ${file.originalChars} chars` : ''
    })`
    const body =
      file.source === 'unavailable'
        ? `Content unavailable: ${file.reason ?? 'no readable source'}`
        : `\`\`\`${file.language}\n${file.content}\n\`\`\``
    return `${header}\n${body}`
  })

  const omitted =
    context.omitted.length > 0
      ? `\n\nNot shared: ${context.omitted.map((entry) => `${entry.path} (${entry.reason})`).join('; ')}`
      : ''

  return `Project files shared:\n${blocks.join('\n\n')}${omitted}`
}

export function buildSystemPrompt(input: Omit<PromptInput, 'userText'>): string {
  const prompt = [
    'You are CodePilot, the AI assistant inside CodePilot Lab, a local-first coding workspace.',
    'You are working on a real project. Be accurate, concrete and honest about uncertainty.',
    'You cannot execute anything here or invoke tools directly. Never claim to have run code, tests or commands unless explicit local agent evidence in this prompt reports that operation and its real result.',
    'Never claim a file was modified. The user applies every change manually after reviewing a diff.',
    'Prefer short paragraphs and fenced code with a language tag. Use Markdown headings sparingly.',
    '',
    `Project: ${input.projectName} (primary language: ${input.projectLanguage}).`,
    `Task mode: ${capabilityMeta(input.capability).label}.`,
    CAPABILITY_GUIDANCE[input.capability],
    LEVEL_GUIDANCE[input.level],
    '',
    renderTree(input.context),
    '',
    renderSelection(input.context),
    '',
    renderDiagnostics(input.context),
    '',
    input.context.agentNotes ? `Local agent inspection (real workspace reads):\n${input.context.agentNotes}` : '',
    input.agentEvidence
      ? `Local agent execution evidence (real sidecar response):\n${input.agentEvidence}`
      : '',
    '',
    renderFiles(input.context),
    '',
    PROPOSAL_PROTOCOL,
  ].join('\n')
  return redactSensitiveText(prompt)
}

export function buildUserPrompt(input: PromptInput): string {
  const trimmed = input.userText.trim()
  const meta = capabilityMeta(input.capability)

  if (trimmed) {
    return trimmed
  }

  switch (input.capability) {
    case 'explain':
      return input.context.selection
        ? 'Explain the selected code line by line.'
        : 'Explain the shared file line by line.'
    case 'debug':
      return 'Inspect the supplied diagnostics and explain the root cause with a concrete fix.'
    case 'review':
      return 'Review the shared code and report concrete findings.'
    case 'refactor':
      return input.context.selection
        ? 'Refactor the selected code without changing its behaviour.'
        : 'Refactor the shared file without changing its behaviour.'
    case 'tests':
      return 'Suggest test cases and edge cases for the shared code.'
    case 'agent':
      return 'Inspect the project evidence, state a concise plan, and propose the smallest safe change.'
    case 'generate':
      return 'Generate the code that fits the shared project context.'
    case 'learn':
      return 'Give me a first hint to move forward, without revealing the full solution.'
    default:
      return `${meta.label}: use the supplied context.`
  }
}
