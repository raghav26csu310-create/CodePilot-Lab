import { CircleSlash, LoaderCircle, Sparkles, Square, TriangleAlert, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { isConfigured, presetById, providerLabel } from '../copilot/providerPresets'
import { streamAssistant } from '../copilot/quickAsk'
import { useAiSettings } from '../copilot/settingsStore'
import { AiError } from '../copilot/errors'
import styles from './QuickAiPanel.module.css'

type QuickAiPanelProps = {
  /** Real assembled context: code, problem statement, error text or trace event. */
  context: string
  suggestions: string[]
  system?: string
  /** Short label describing what is being explained. */
  scope: string
}

const DEFAULT_SYSTEM = [
  'You are the CodePilot Lab tutor in a local-first coding laboratory.',
  'You receive a real problem or execution context supplied by the application. Everything you say must be grounded in it.',
  'You cannot run code and must not claim that you did, must not invent output, and must not invent test results.',
  'Be concise and concrete. Use short paragraphs and plain text; the panel does not render Markdown.',
  'When asked for a solution, explain the approach first, then show a complete program in the language being used.',
].join('\n')

/**
 * Inline, streaming AI help for Practice and the tracer. It is not a chat log:
 * each turn is a fresh, explicitly scoped explanation request, which keeps the
 * context honest and prevents unrelated history from leaking into answers.
 */
export function QuickAiPanel({ context, suggestions, system, scope }: QuickAiPanelProps) {
  const ai = useAiSettings()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  const [streamedChars, setStreamedChars] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const settings = ai.settings
  const preset = presetById(settings.preset)
  const configured =
    ai.loaded &&
    isConfigured(settings) &&
    (settings.route === 'gateway' || !preset?.keyExpected || settings.apiKey.trim().length > 0)

  const ask = async (text: string) => {
    const trimmed = text.trim()
    if (asking || !trimmed) {
      return
    }
    if (!configured) {
      setError(
        settings.route === 'gateway'
          ? 'CodePilot AI is not available yet. Sign in on the Settings page and check the gateway status there.'
          : 'No AI provider is ready. Configure the base URL, model and API key (when the provider needs one) in Settings.',
      )
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setAsking(true)
    setError(null)
    setAnswer('')
    setStreamedChars(0)
    setLastQuestion(trimmed)

    try {
      await streamAssistant({
        settings,
        system: system ?? DEFAULT_SYSTEM,
        user: `Context — ${scope}:\n\n${context}\n\nQuestion: ${trimmed}`,
        signal: controller.signal,
        onDelta: (chunk) => {
          setAnswer((current) => current + chunk)
          setStreamedChars((current) => current + chunk.length)
        },
      })
      setQuestion('')
    } catch (cause) {
      if (cause instanceof AiError && cause.kind === 'aborted') {
        setError('The request was cancelled before the provider finished.')
      } else {
        setError(
          cause instanceof AiError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : 'The provider request failed.',
        )
      }
    } finally {
      abortRef.current = null
      setAsking(false)
    }
  }

  const stop = () => {
    abortRef.current?.abort()
  }

  const clear = () => {
    setAnswer('')
    setError(null)
    setLastQuestion(null)
    setStreamedChars(0)
  }

  return (
    <section className={styles.panel} aria-label={`AI help for ${scope}`}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Sparkles size={13} />
        </span>
        <div className={styles.headCopy}>
          <p className={styles.title}>Ask the AI Copilot</p>
          <p className={styles.subtitle}>
            {configured ? `${providerLabel(settings)} · ${settings.model}` : 'Provider not ready'}
          </p>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={clear}
          disabled={!answer && !error}
          aria-label="Clear AI answer"
          title="Clear the answer"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>

      {!configured ? (
        <p className={styles.unavailable}>
          <CircleSlash size={12} aria-hidden="true" />
          {ai.loaded
            ? 'Configure a provider in Settings to use AI help. The problem, editor and grader work without it.'
            : 'Reading stored provider settings…'}
        </p>
      ) : null}

      <div className={styles.suggestions}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={styles.suggestion}
            onClick={() => void ask(suggestion)}
            disabled={asking || !configured}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          placeholder="Ask about the current code, error or approach"
          aria-label={`Question for AI help about ${scope}`}
        />
        {asking ? (
          <button type="button" className={styles.stopButton} onClick={stop}>
            <Square size={12} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className={styles.askButton}
            onClick={() => void ask(question)}
            disabled={!question.trim() || !configured}
          >
            <Sparkles size={12} aria-hidden="true" />
            Ask
          </button>
        )}
      </div>

      <p className={styles.scope}>
        Sent to the provider: {scope}, the current code and the latest real result. Nothing is
        fabricated; the provider cannot run your program.
      </p>

      {error ? (
        <p className={styles.error} role="alert">
          <TriangleAlert size={12} aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {asking && !answer ? (
        <p className={styles.pending}>
          <LoaderCircle size={12} className={styles.spin} aria-hidden="true" />
          Waiting for the provider…
        </p>
      ) : null}

      {answer ? (
        <div className={styles.answer} aria-live="polite">
          <p className={styles.answerHead}>
            {lastQuestion}
            {asking ? (
              <span>
                <LoaderCircle size={10} className={styles.spin} aria-hidden="true" /> streaming ·{' '}
                {streamedChars} chars
              </span>
            ) : (
              <span>{answer.length.toLocaleString()} chars received</span>
            )}
          </p>
          <pre className={styles.answerText}>{answer}</pre>
        </div>
      ) : null}
    </section>
  )
}
