import {
  Check,
  ChevronDown,
  CircleAlert,
  FlaskConical,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '../../design-system/primitives/Button'
import { AiError, describeAiError } from './errors'
import { refreshGateway, useGateway } from './gateway/store'
import { saveGatewayConnection } from './gateway/client'
import { describeGatewayAvailability } from './providers/gateway'
import { DEFAULT_AI_SETTINGS, SETTINGS_LIMITS } from './providerPresets'
import { testProviderConnection } from './providers'
import {
  availablePresets,
  forgetAiSettings,
  recordConnectionTest,
  saveAiSettings,
  settingsForPreset,
  useAiSettings,
} from './settingsStore'
import type { AiSettings, ConnectionReport } from './types'
import styles from './ProviderSettingsForm.module.css'

type ProviderSettingsFormProps = {
  compact?: boolean
  onSaved?: (settings: AiSettings) => void
}

export function ProviderSettingsForm({ compact = false, onSaved }: ProviderSettingsFormProps) {
  const snapshot = useAiSettings()
  const gateway = useGateway()
  const [draft, setDraft] = useState<AiSettings>(() => snapshot.settings)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [report, setReport] = useState<ConnectionReport | null>(null)
  const [saved, setSaved] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const id = useId()
  const presets = availablePresets()
  const preset = presets.find((entry) => entry.id === draft.preset) ?? presets[0]
  const managed = draft.provider === 'gateway'
  // Routing through the API requires a real session. Until the probe answers we
  // do not guess: the control is disabled and saving is held, so a click can
  // never silently fall back to a direct browser call.
  const gatewayChecking = gateway.reachable === null || gateway.checking
  const routed = gateway.user !== null && draft.route === 'gateway'

  const patch = (next: Partial<AiSettings>) => {
    setDraft((current) => ({ ...current, ...next }))
    setSaved(false)
    setReport(null)
  }

  const handlePreset = (presetId: string) => {
    setDraft((current) => {
      const next = settingsForPreset(current, presetId)
      // Without a session there is no gateway to route through, so a BYO preset
      // must not inherit "gateway" and then fail on save.
      return next.provider === 'gateway' || gateway.user !== null
        ? next
        : { ...next, route: 'direct' }
    })
    setSaved(false)
    setReport(null)
  }

  const runTest = async () => {
    setTesting(true)
    setProblem(null)
    setReport(null)
    try {
      const result = await testProviderConnection({
        ...draft,
        route: managed ? 'gateway' : routed ? 'gateway' : 'direct',
      })
      setReport(result)
      recordConnectionTest(result)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'The connection test failed.')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setProblem(null)
    try {
      if (!managed && routed) {
        await saveGatewayConnection({
          provider: draft.provider === 'ollama' ? 'ollama' : 'openai-compatible',
          baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim(),
          apiKey: draft.apiKey.trim() || undefined,
        })
        const stored = await saveAiSettings({
          ...draft,
          route: 'gateway',
          apiKey: '',
          rememberKey: false,
        })
        setDraft(stored)
        setSaved(true)
        setReport(null)
        await refreshGateway()
        onSaved?.(stored)
        return
      }

      const stored = await saveAiSettings({
        ...draft,
        route: managed ? 'gateway' : 'direct',
      })
      setDraft(stored)
      setSaved(true)
      setReport(null)
      onSaved?.(stored)
    } catch (cause) {
      setProblem(
        cause instanceof Error && cause.message
          ? `Settings could not be saved: ${cause.message}`
          : 'Settings could not be saved to IndexedDB.',
      )
    } finally {
      setSaving(false)
    }
  }

  const forget = async () => {
    try {
      await forgetAiSettings()
      setDraft(DEFAULT_AI_SETTINGS)
      setSaved(false)
      setReport(null)
      setProblem(null)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Stored settings could not be removed.')
    }
  }

  const keyNeedsAttention = (preset?.keyExpected ?? false) && draft.apiKey.trim().length === 0
  const canTest = managed || draft.baseUrl.trim().length > 0
  const canSave =
    !gatewayChecking && (managed || (draft.baseUrl.trim().length > 0 && draft.model.trim().length > 0))

  const gatewayState: 'checking' | 'offline' | 'signed-out' | 'ready' | 'no-provider' =
    gateway.reachable === null || gateway.checking
      ? 'checking'
      : gateway.reachable === false
        ? 'offline'
        : !gateway.user
          ? 'signed-out'
          : gateway.status
            ? 'ready'
            : 'no-provider'

  const gatewayDetail =
    gatewayState === 'checking'
      ? 'Asking the CodePilot API for its real status.'
      : gatewayState === 'offline'
        ? (gateway.error ?? 'The CodePilot API did not answer.')
        : gatewayState === 'signed-out'
          ? 'Sign in to CodePilot Cloud in Settings to use managed AI.'
          : gatewayState === 'no-provider'
            ? (gateway.error ?? 'The API answered, but it did not report AI availability.')
            : gateway.status
              ? describeGatewayAvailability(gateway.status).detail
              : ''

  return (
    <div className={styles.form} data-compact={compact || undefined}>
      <div className={styles.intro}>
        <div className={styles.introHead}>
          <FlaskConical size={15} />
          <span>Provider &amp; model</span>
        </div>
        <p>
          {managed
            ? 'CodePilot AI runs through the CodePilot API. Requests are authenticated with your account and the provider key never reaches this browser.'
            : routed
              ? 'Requests are routed through the CodePilot API. The key is stored encrypted on the server, never persisted in this browser.'
              : 'This is an advanced local/BYO connection. The browser calls the endpoint you enter directly, so that endpoint sees the request and any key you provide.'}
        </p>
      </div>

      <label className={styles.field} htmlFor={`${id}-preset`}>
        <span className={styles.label}>Provider preset</span>
        <select
          id={`${id}-preset`}
          value={draft.preset}
          onChange={(event) => handlePreset(event.target.value)}
        >
          {presets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <span className={styles.hint}>{preset?.note}</span>
      </label>

      {managed ? (
        <div className={styles.managed} data-state={gatewayState}>
          <div className={styles.managedHead}>
            <ShieldCheck size={15} />
            <strong>
              {gatewayState === 'checking'
                ? 'Checking CodePilot Cloud…'
                : gatewayState === 'offline'
                  ? 'CodePilot API unavailable'
                  : gatewayState === 'signed-out'
                    ? 'Not signed in'
                    : gatewayState === 'no-provider'
                      ? 'No AI provider available'
                      : gateway.status
                        ? describeGatewayAvailability(gateway.status).label
                        : 'CodePilot Cloud'}
            </strong>
            <button
              type="button"
              className={styles.recheck}
              onClick={() => void refreshGateway()}
              disabled={gateway.checking}
            >
              <RefreshCw size={12} data-spinning={gateway.checking || undefined} />
              Recheck
            </button>
          </div>
          <p>{gatewayDetail}</p>
          <small>
            Provider keys are stored encrypted on the API. No platform key is ever shipped to the
            browser.
          </small>
        </div>
      ) : (
        <>
          <label className={styles.field} htmlFor={`${id}-url`}>
            <span className={styles.label}>
              Base URL
              <span className={styles.kind}>{draft.provider === 'ollama' ? 'Ollama API' : 'OpenAI-compatible'}</span>
            </span>
            <input
              id={`${id}-url`}
              type="url"
              spellCheck={false}
              placeholder="http://localhost:11434"
              value={draft.baseUrl}
              onChange={(event) => patch({ baseUrl: event.target.value })}
            />
            <span className={styles.hint}>
              {draft.provider === 'ollama'
                ? 'Ollama serves this at http://localhost:11434. Browser calls need OLLAMA_ORIGINS to allow this origin.'
                : 'Usually ends in /v1. A local proxy URL works if you keep keys server-side.'}
            </span>
          </label>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-model`}>
              Model
              <span className={styles.kind}>
                {snapshot.models.length > 0 ? `${snapshot.models.length} advertised` : 'not listed yet'}
              </span>
            </label>
            <input
              id={`${id}-model`}
              type="text"
              spellCheck={false}
              placeholder={preset?.defaultModel || 'e.g. qwen3:8b'}
              list={`${id}-models`}
              value={draft.model}
              onChange={(event) => patch({ model: event.target.value })}
            />
            <datalist id={`${id}-models`}>
              {snapshot.models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <span className={styles.hint}>
              Must match a model the provider actually has. Test the connection to list them.
            </span>
          </div>

          <label className={styles.field} htmlFor={`${id}-key`}>
            <span className={styles.label}>
              API key
              {preset?.keyExpected ? (
                <span className={styles.kind} data-tone={keyNeedsAttention ? 'warn' : 'ok'}>
                  {keyNeedsAttention ? 'required by this provider' : 'present'}
                </span>
              ) : (
                <span className={styles.kind}>optional</span>
              )}
            </span>
            <div className={styles.keyRow}>
              <KeyRound size={14} className={styles.keyIcon} />
              <input
                id={`${id}-key`}
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-… (never compiled into the app)"
                value={draft.apiKey}
                onChange={(event) => patch({ apiKey: event.target.value })}
              />
              <button
                type="button"
                className={styles.showKey}
                onClick={() => setShowKey((current) => !current)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <span className={styles.hint}>
              {routed
                ? 'Sent once to the CodePilot API when you save, stored encrypted, and never returned to this browser. Leave blank to keep the key already stored on the server.'
                : 'Kept in memory for this tab by default. Use a local proxy if a key must never reach the browser.'}
            </span>
          </label>

          <label className={styles.check} htmlFor={`${id}-route`}>
            <input
              id={`${id}-route`}
              type="checkbox"
              checked={routed}
              disabled={gatewayChecking || gateway.user === null}
              onChange={(event) =>
                patch({
                  route: event.target.checked ? 'gateway' : 'direct',
                  rememberKey: event.target.checked ? false : draft.rememberKey,
                })
              }
            />
            <span>
              Send through the CodePilot API
              <small>
                {gatewayChecking
                  ? 'Checking your CodePilot session…'
                  : gateway.user
                    ? 'The key is sent once to your CodePilot account and stored encrypted (AES-256-GCM). It never returns to this browser. Off = direct browser call.'
                    : 'Sign in above to enable this. Until then this browser calls the endpoint directly and the key stays in this tab.'}
              </small>
            </span>
          </label>

          {!routed ? (
            <label className={styles.check} htmlFor={`${id}-remember`}>
              <input
                id={`${id}-remember`}
                type="checkbox"
                checked={draft.rememberKey}
                onChange={(event) => patch({ rememberKey: event.target.checked })}
              />
              <span>
                Remember the key in this browser&apos;s IndexedDB
                <small>
                  Off by default. This is plaintext, not encrypted. Clearing the key or forgetting
                  settings removes it.
                </small>
              </span>
            </label>
          ) : null}
        </>
      )}

      <button
        type="button"
        className={styles.advancedToggle}
        onClick={() => setAdvanced((current) => !current)}
        aria-expanded={advanced}
      >
        <ChevronDown size={14} data-open={advanced || undefined} />
        Advanced limits
      </button>

      {advanced ? (
        <div className={styles.advanced}>
          <label className={styles.field} htmlFor={`${id}-temp`}>
            <span className={styles.label}>
              Temperature <b>{draft.temperature.toFixed(1)}</b>
            </span>
            <input
              id={`${id}-temp`}
              type="range"
              min={SETTINGS_LIMITS.temperature.min}
              max={SETTINGS_LIMITS.temperature.max}
              step={SETTINGS_LIMITS.temperature.step}
              value={draft.temperature}
              onChange={(event) => patch({ temperature: Number(event.target.value) })}
            />
          </label>
          <label className={styles.field} htmlFor={`${id}-tokens`}>
            <span className={styles.label}>
              Max output tokens <b>{draft.maxTokens}</b>
            </span>
            <input
              id={`${id}-tokens`}
              type="range"
              min={SETTINGS_LIMITS.maxTokens.min}
              max={SETTINGS_LIMITS.maxTokens.max}
              step={SETTINGS_LIMITS.maxTokens.step}
              value={draft.maxTokens}
              onChange={(event) => patch({ maxTokens: Number(event.target.value) })}
            />
          </label>
          <label className={styles.field} htmlFor={`${id}-context`}>
            <span className={styles.label}>
              Context budget <b>{Math.round(draft.contextChars / 1000)}k chars</b>
            </span>
            <input
              id={`${id}-context`}
              type="range"
              min={SETTINGS_LIMITS.contextChars.min}
              max={SETTINGS_LIMITS.contextChars.max}
              step={SETTINGS_LIMITS.contextChars.step}
              value={draft.contextChars}
              onChange={(event) => patch({ contextChars: Number(event.target.value) })}
            />
          </label>
          <label className={styles.field} htmlFor={`${id}-history`}>
            <span className={styles.label}>
              Conversation turns sent <b>{draft.historyDepth}</b>
            </span>
            <input
              id={`${id}-history`}
              type="range"
              min={SETTINGS_LIMITS.historyDepth.min}
              max={SETTINGS_LIMITS.historyDepth.max}
              step={SETTINGS_LIMITS.historyDepth.step}
              value={draft.historyDepth}
              onChange={(event) => patch({ historyDepth: Number(event.target.value) })}
            />
            <span className={styles.hint}>
              Prior turns are sent without the previous file snapshot unless the file is still
              shared below.
            </span>
          </label>
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void runTest()}
          disabled={testing || !canTest || gatewayChecking}
        >
          {testing ? <Loader2 size={14} className={styles.spin} /> : <FlaskConical size={14} />}
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void save()}
          disabled={saving || !canSave}
        >
          {saving ? <Loader2 size={14} className={styles.spin} /> : <Save size={14} />}
          Save provider
        </Button>
        <button type="button" className={styles.forget} onClick={() => void forget()}>
          <Trash2 size={13} />
          Forget stored settings
        </button>
      </div>

      {problem ? (
        <p className={styles.problem} role="alert">
          <CircleAlert size={14} />
          {problem}
        </p>
      ) : null}

      {report ? (
        <div className={styles.report} data-ok={report.ok || undefined} role="status">
          <div className={styles.reportHead}>
            {report.ok ? <Check size={14} /> : <CircleAlert size={14} />}
            <strong>
              {report.ok
                ? routed
                  ? 'Gateway responded'
                  : 'Endpoint responded'
                : routed
                  ? 'No provider available'
                  : 'Connection failed'}
            </strong>
            <span>{report.latencyMs} ms</span>
          </div>
          <p>{report.ok ? report.message : describeReport(report)}</p>
          {report.ok && report.models.length > 0 ? (
            <p className={styles.models}>
              Advertised: {report.models.slice(0, 8).join(', ')}
              {report.models.length > 8 ? ` +${report.models.length - 8} more` : ''}
            </p>
          ) : null}
          <small>
            {report.ok
              ? 'The endpoint answered. This does not prove the selected model will answer until you send a request.'
              : routed
                ? managed
                  ? 'No provider is available for this account or server yet. Configure managed CodePilot AI on the server, or connect a personal provider below.'
                  : 'The CodePilot API tried this endpoint from the server and it did not answer. Check the URL and model; the key never reached this browser.'
                : 'Nothing is saved automatically. Check the URL, the key and whether the provider allows browser requests (CORS).'}
          </small>
        </div>
      ) : null}

      {saved ? (
        <p className={styles.saved} role="status">
          <Check size={14} />
          Saved
          {managed
            ? ' — managed mode uses your CodePilot account and stores no provider key in this browser.'
            : routed
              ? ' — the key is stored encrypted on the CodePilot API, not in this browser.'
              : draft.rememberKey
                ? ' with the key remembered in this browser (plaintext IndexedDB — not encrypted).'
                : ' (key kept in memory only).'}
          {' '}The connection is unverified until a real request succeeds.
        </p>
      ) : null}

      {!snapshot.loaded ? <p className={styles.hint}>Loading stored settings…</p> : null}
    </div>
  )
}

function describeReport(report: ConnectionReport): string {
  if (report.kind) {
    return describeAiError(new AiError(report.kind, report.message))
  }
  return report.message
}
