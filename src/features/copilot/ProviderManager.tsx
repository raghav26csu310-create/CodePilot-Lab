import {
  Check,
  CircleAlert,
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '../../design-system/primitives/Button'
import { Link } from 'react-router-dom'
import { refreshGateway, useGateway } from './gateway/store'
import {
  deleteGatewayConnection,
  saveGatewayConnection,
  setGatewayProviderPreferences,
  testGatewayConnection,
  testSavedGatewayConnection,
  type GatewayConnection,
  type GatewayProviderId,
  type GatewayTestResult,
} from './gateway/client'
import { SETTINGS_LIMITS } from './providerPresets'
import { saveAiSettings, useAiSettings } from './settingsStore'
import type { AiSettings } from './types'
import styles from './ProviderManager.module.css'

type ProviderChoice = {
  id: GatewayProviderId
  label: string
  baseUrl: string
  requiresKey: boolean
  note: string
}

const PROVIDERS: ProviderChoice[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    note: 'OpenAI API · key is encrypted on the CodePilot API.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    requiresKey: true,
    note: 'Anthropic Messages API · model list is fetched from Anthropic.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresKey: true,
    note: 'Gemini API · credentials are sent in a request header, never in a URL.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434',
    requiresKey: false,
    note: 'Local Ollama server · start Ollama before testing; an installed model is not assumed to be running.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    note: 'DeepSeek OpenAI-compatible API.',
  },
  {
    id: 'openai-compatible',
    label: 'Custom OpenAI-compatible',
    baseUrl: '',
    requiresKey: false,
    note: 'Custom hosted API, local inference server, or compatible proxy.',
  },
]

type ConnectionDraft = {
  id?: string
  provider: GatewayProviderId
  label: string
  baseUrl: string
  model: string
  apiKey: string
  hasSavedKey: boolean
}

type Props = {
  compact?: boolean
  onSaved?: (settings: AiSettings) => void
}

function providerChoice(id: GatewayProviderId): ProviderChoice {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0]!
}

function emptyDraft(providerId: GatewayProviderId = 'openai'): ConnectionDraft {
  const provider = providerChoice(providerId)
  return {
    provider: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    model: '',
    apiKey: '',
    hasSavedKey: false,
  }
}

export function ProviderManager({ compact = false, onSaved }: Props) {
  const gateway = useGateway()
  const aiSettings = useAiSettings()
  const [draft, setDraft] = useState<ConnectionDraft | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [report, setReport] = useState<GatewayTestResult | null>(null)
  const [working, setWorking] = useState<'test' | 'save' | 'delete' | 'preferences' | 'limits' | null>(
    null,
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [limits, setLimits] = useState(() => aiSettings.settings)
  const id = useId()
  const connections = gateway.status?.connections ?? []
  const signedIn = gateway.user !== null

  const persistGatewaySettings = async (): Promise<AiSettings> => {
    const stored = await saveAiSettings({
      ...aiSettings.settings,
      preset: 'codepilot',
      provider: 'gateway',
      route: 'gateway',
      baseUrl: '',
      model: '',
      apiKey: '',
      rememberKey: false,
    })
    onSaved?.(stored)
    return stored
  }

  const beginAdd = () => {
    setDraft(emptyDraft())
    setModels([])
    setReport(null)
    setProblem(null)
    setNotice(null)
  }

  const beginEdit = (connection: GatewayConnection) => {
    setDraft({
      id: connection.id,
      provider: connection.provider,
      label: connection.label,
      baseUrl: connection.baseUrl,
      model: connection.model,
      apiKey: '',
      hasSavedKey: connection.hasKey,
    })
    setModels([])
    setReport(null)
    setProblem(null)
    setNotice(null)
  }

  const patchDraft = (patch: Partial<ConnectionDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    setReport(null)
    setProblem(null)
  }

  const test = async () => {
    if (!draft) return
    setWorking('test')
    setProblem(null)
    setNotice(null)
    try {
      const saved = connections.find((connection) => connection.id === draft.id)
      const unchanged =
        draft.id !== undefined &&
        draft.apiKey.trim().length === 0 &&
        saved !== undefined &&
        saved.provider === draft.provider &&
        saved.label === draft.label &&
        saved.baseUrl === draft.baseUrl &&
        saved.model === draft.model
      const result = unchanged && draft.id
        ? (await testSavedGatewayConnection(draft.id)).result
        : await testGatewayConnection({
            connectionId: draft.id,
            provider: draft.provider,
            baseUrl: draft.baseUrl.trim(),
            model: draft.model.trim() || undefined,
            apiKey: draft.apiKey.trim() || undefined,
          })
      setReport(result)
      setModels(result.models)
      if (unchanged) {
        await refreshGateway()
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'The provider test failed.')
    } finally {
      setWorking(null)
    }
  }

  const save = async () => {
    if (!draft) return
    setWorking('save')
    setProblem(null)
    setNotice(null)
    try {
      const result = await saveGatewayConnection({
        id: draft.id,
        provider: draft.provider,
        label: draft.label.trim(),
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        apiKey: draft.apiKey.trim() || undefined,
      })
      setDraft(null)
      setReport(null)
      await refreshGateway()
      await persistGatewaySettings()
      setNotice(`${result.connection.label} saved. Its credential is stored encrypted on the API.`)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'The provider could not be saved.')
    } finally {
      setWorking(null)
    }
  }

  const remove = async (connection: GatewayConnection) => {
    if (!window.confirm(`Remove ${connection.label}? Its encrypted credential will be deleted.`)) {
      return
    }
    setWorking('delete')
    setProblem(null)
    setNotice(null)
    try {
      await deleteGatewayConnection(connection.id)
      await refreshGateway()
      setNotice(`${connection.label} was removed.`)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'The provider could not be removed.')
    } finally {
      setWorking(null)
    }
  }

  const updatePreferences = async (defaultProviderId: string | null, fallbackProviderId: string | null) => {
    setWorking('preferences')
    setProblem(null)
    setNotice(null)
    try {
      await setGatewayProviderPreferences({
        defaultProviderId,
        fallbackProviderId:
          defaultProviderId && defaultProviderId === fallbackProviderId
            ? null
            : fallbackProviderId,
      })
      await refreshGateway()
      await persistGatewaySettings()
      setNotice('Provider defaults saved.')
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Provider defaults could not be saved.')
    } finally {
      setWorking(null)
    }
  }

  const saveLimits = async () => {
    setWorking('limits')
    setProblem(null)
    try {
      const stored = await saveAiSettings({
        ...limits,
        preset: 'codepilot',
        provider: 'gateway',
        route: 'gateway',
        baseUrl: '',
        model: '',
        apiKey: '',
        rememberKey: false,
      })
      onSaved?.(stored)
      setNotice('Generation defaults saved in this browser. Provider credentials remain on the API.')
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Generation defaults could not be saved.')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className={styles.manager} data-compact={compact || undefined}>
      <div className={styles.intro}>
        <div className={styles.introTitle}>
          <ShieldCheck size={15} />
          <strong>Provider vault</strong>
          <button
            type="button"
            className={styles.recheck}
            onClick={() => void refreshGateway()}
            disabled={gateway.checking}
          >
            <RefreshCw size={12} data-spinning={gateway.checking || undefined} />
            Refresh
          </button>
        </div>
        <p>
          OpenAI, Anthropic, Gemini, Ollama and compatible providers use the authenticated CodePilot
          API. Keys are encrypted at rest and never returned to this browser.
        </p>
      </div>

      {!gateway.reachable ? (
        <div className={styles.notice} role="status">
          <CircleAlert size={14} />
          {gateway.error ?? 'The CodePilot API is not reachable. Start it with npm run api:dev.'}
        </div>
      ) : !signedIn ? (
        <div className={styles.notice} role="status">
          <CircleAlert size={14} />
          Sign in to the CodePilot API account to create a secure provider configuration.{' '}
          <Link to="/settings">Open account settings</Link>.
        </div>
      ) : (
        <>
          <section className={styles.defaults} aria-label="Provider defaults">
            <label>
              <span>Default provider</span>
              <select
                value={gateway.status?.defaultProviderId ?? ''}
                onChange={(event) => {
                  const nextDefault = event.target.value || null
                  void updatePreferences(
                    nextDefault,
                    nextDefault ? gateway.status?.fallbackProviderId ?? null : null,
                  )
                }}
                disabled={working !== null || connections.length === 0}
              >
                <option value="">Use managed CodePilot AI when configured</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.label} · {connection.model || 'no model'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Fallback provider</span>
              <select
                value={gateway.status?.fallbackProviderId ?? ''}
                onChange={(event) =>
                  void updatePreferences(
                    gateway.status?.defaultProviderId ?? null,
                    event.target.value || null,
                  )
                }
                disabled={
                  working !== null ||
                  connections.length < 2 ||
                  !gateway.status?.defaultProviderId
                }
              >
                <option value="">No fallback</option>
                {connections
                  .filter((connection) => connection.id !== gateway.status?.defaultProviderId)
                  .map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.label} · {connection.model || 'no model'}
                    </option>
                  ))}
              </select>
            </label>
            <small>
              Fallback is tried for provider outages before any text is returned. It is not retried
              after partial output or when you cancel a request.
            </small>
          </section>

          <div className={styles.listHead}>
            <div>
              <h3>Configured providers</h3>
              <span>{connections.length} saved</span>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={beginAdd}>
              <Plus size={14} />
              Add provider
            </Button>
          </div>

          {connections.length === 0 ? (
            <p className={styles.empty}>
              No providers are configured. Add one to enable AI. Managed CodePilot AI is available
              only when the API operator configures it.
            </p>
          ) : (
            <div className={styles.connectionList}>
              {connections.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  isDefault={connection.id === gateway.status?.defaultProviderId}
                  isFallback={connection.id === gateway.status?.fallbackProviderId}
                  disabled={working !== null}
                  onEdit={() => beginEdit(connection)}
                  onRemove={() => void remove(connection)}
                />
              ))}
            </div>
          )}

          {draft ? (
            <section className={styles.editor} aria-label="Provider configuration">
              <div className={styles.editorHead}>
                <div>
                  <h3>{draft.id ? 'Update provider' : 'Add provider'}</h3>
                  <p>Credential input is sent only to your authenticated CodePilot API.</p>
                </div>
                <button
                  type="button"
                  className={styles.cancel}
                  onClick={() => setDraft(null)}
                  disabled={working !== null}
                >
                  Cancel
                </button>
              </div>
              <div className={styles.fields}>
                <label>
                  <span>Provider</span>
                  <select
                    value={draft.provider}
                    onChange={(event) => {
                      const choice = providerChoice(event.target.value as GatewayProviderId)
                      patchDraft({
                        provider: choice.id,
                        label: choice.label,
                        baseUrl: choice.baseUrl,
                        model: '',
                        apiKey: '',
                        hasSavedKey: false,
                      })
                      setModels([])
                    }}
                    disabled={Boolean(draft.id)}
                  >
                    {PROVIDERS.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Display name</span>
                  <input
                    value={draft.label}
                    onChange={(event) => patchDraft({ label: event.target.value })}
                    maxLength={80}
                  />
                </label>
                <label className={styles.wide}>
                  <span>API base URL</span>
                  <input
                    type="url"
                    value={draft.baseUrl}
                    onChange={(event) => patchDraft({ baseUrl: event.target.value })}
                    spellCheck={false}
                    placeholder={providerChoice(draft.provider).baseUrl}
                  />
                  <small>{providerChoice(draft.provider).note}</small>
                </label>
                <label>
                  <span>Model</span>
                  <input
                    value={draft.model}
                    onChange={(event) => patchDraft({ model: event.target.value })}
                    list={`${id}-models`}
                    spellCheck={false}
                    placeholder="Fetch models, then select or enter one"
                  />
                  <datalist id={`${id}-models`}>
                    {models.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>
                <label>
                  <span>
                    API key
                    {providerChoice(draft.provider).requiresKey ? ' · required' : ' · optional'}
                  </span>
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) => patchDraft({ apiKey: event.target.value })}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder={
                      draft.hasSavedKey
                        ? 'Saved securely · leave blank to keep'
                        : providerChoice(draft.provider).requiresKey
                          ? 'Enter provider key'
                          : 'No key required'
                    }
                  />
                  <small>
                    Never stored in this browser. Saved on the API using AES-256-GCM; only key
                    presence and last four characters are returned.
                  </small>
                </label>
              </div>
              <div className={styles.actions}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void test()}
                  disabled={working !== null || !draft.baseUrl.trim()}
                >
                  {working === 'test' ? <Loader2 className={styles.spin} size={14} /> : <FlaskConical size={14} />}
                  {working === 'test' ? 'Testing…' : 'Fetch models & test'}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => void save()}
                  disabled={
                    working !== null ||
                    !draft.label.trim() ||
                    !draft.baseUrl.trim() ||
                    !draft.model.trim()
                  }
                >
                  {working === 'save' ? <Loader2 className={styles.spin} size={14} /> : <Save size={14} />}
                  {draft.id ? 'Update provider' : 'Save provider'}
                </Button>
              </div>
              {report ? <TestReport report={report} /> : null}
            </section>
          ) : null}

          <section className={styles.generation}>
            <h3>Generation defaults</h3>
            <label>
              Temperature <b>{limits.temperature.toFixed(1)}</b>
              <input
                type="range"
                min={SETTINGS_LIMITS.temperature.min}
                max={SETTINGS_LIMITS.temperature.max}
                step={SETTINGS_LIMITS.temperature.step}
                value={limits.temperature}
                onChange={(event) => setLimits({ ...limits, temperature: Number(event.target.value) })}
              />
            </label>
            <label>
              Max output tokens <b>{limits.maxTokens}</b>
              <input
                type="range"
                min={SETTINGS_LIMITS.maxTokens.min}
                max={SETTINGS_LIMITS.maxTokens.max}
                step={SETTINGS_LIMITS.maxTokens.step}
                value={limits.maxTokens}
                onChange={(event) => setLimits({ ...limits, maxTokens: Number(event.target.value) })}
              />
            </label>
            <label>
              Context budget <b>{Math.round(limits.contextChars / 1000)}k chars</b>
              <input
                type="range"
                min={SETTINGS_LIMITS.contextChars.min}
                max={SETTINGS_LIMITS.contextChars.max}
                step={SETTINGS_LIMITS.contextChars.step}
                value={limits.contextChars}
                onChange={(event) =>
                  setLimits({ ...limits, contextChars: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Conversation turns <b>{limits.historyDepth}</b>
              <input
                type="range"
                min={SETTINGS_LIMITS.historyDepth.min}
                max={SETTINGS_LIMITS.historyDepth.max}
                step={SETTINGS_LIMITS.historyDepth.step}
                value={limits.historyDepth}
                onChange={(event) => setLimits({ ...limits, historyDepth: Number(event.target.value) })}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void saveLimits()}
              disabled={working !== null || !aiSettings.loaded}
            >
              {working === 'limits' ? <Loader2 className={styles.spin} size={14} /> : <Save size={14} />}
              Save generation defaults
            </Button>
          </section>
        </>
      )}

      {problem ? (
        <p className={styles.problem} role="alert">
          <CircleAlert size={14} />
          {problem}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          <Check size={14} />
          {notice}
        </p>
      ) : null}
    </div>
  )
}

function ConnectionCard({
  connection,
  isDefault,
  isFallback,
  disabled,
  onEdit,
  onRemove,
}: {
  connection: GatewayConnection
  isDefault: boolean
  isFallback: boolean
  disabled: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const status =
    connection.lastTestOk === true
      ? 'Connected'
      : connection.lastTestOk === false
        ? 'Test failed'
        : 'Not tested'
  return (
    <article className={styles.connection}>
      <div className={styles.connectionHead}>
        <div>
          <h4>{connection.label}</h4>
          <span>{connection.providerLabel} · {connection.model || 'No model selected'}</span>
        </div>
        <div className={styles.badges}>
          {isDefault ? <span data-tone="primary">Default</span> : null}
          {isFallback ? <span data-tone="fallback">Fallback</span> : null}
          <span data-tone={connection.lastTestOk === true ? 'success' : 'muted'}>{status}</span>
        </div>
      </div>
      <dl>
        <div>
          <dt>Credential</dt>
          <dd>
            {connection.hasKey
              ? `Encrypted · ending ${connection.keyLast4 || '••••'}`
              : 'No API key stored'}
          </dd>
        </div>
        <div>
          <dt>Last test</dt>
          <dd>
            {connection.lastTestAt
              ? new Date(connection.lastTestAt).toLocaleString()
              : 'Never tested'}
          </dd>
        </div>
      </dl>
      {connection.lastTestMessage ? <p className={styles.testMessage}>{connection.lastTestMessage}</p> : null}
      <div className={styles.cardActions}>
        <button type="button" onClick={onEdit} disabled={disabled}>Edit</button>
        <button type="button" onClick={onRemove} disabled={disabled}>
          <Trash2 size={12} />
          Remove
        </button>
      </div>
    </article>
  )
}

function TestReport({ report }: { report: GatewayTestResult }) {
  return (
    <div className={styles.testReport} data-ok={report.ok || undefined} role="status">
      <strong>
        {report.ok ? <Check size={13} /> : <CircleAlert size={13} />}
        {report.ok ? `Endpoint responded in ${report.latencyMs} ms` : 'Connection test failed'}
      </strong>
      <p>{report.message}</p>
      {report.models.length > 0 ? (
        <small>{report.models.length} model(s) discovered. Select one in the Model field.</small>
      ) : null}
    </div>
  )
}

