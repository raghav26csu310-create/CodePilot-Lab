import {
  Download,
  FileCode2,
  GitBranch,
  KeyRound,
  Laptop,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { clearActivities, db } from '../../lib/db'
import { formatBytes } from '../../lib/format'
import {
  clampFontSize,
  readEditorPreferences,
  writeEditorPreferences,
  type EditorPreferences,
} from '../editor/editorPreferences'
import { exportAccountData } from '../copilot/gateway/client'
import { GatewayAccountPanel } from '../copilot/gateway/AccountPanel'
import { useGateway } from '../copilot/gateway/store'
import { ProviderManager } from '../copilot/ProviderManager'
import { usesGateway } from '../copilot/providerPresets'
import { useAiSettings } from '../copilot/settingsStore'
import { GithubPanel } from '../github/GithubPanel'
import { getTerminalToken, setTerminalToken } from '../terminal/client'
import styles from './AiSettingsPage.module.css'

type SettingsTab = 'ai' | 'editor' | 'terminal' | 'github' | 'general'

export function AiSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentTab = (searchParams.get('tab') as SettingsTab) || 'ai'

  const setTab = (tab: SettingsTab) => {
    setSearchParams({ tab })
  }

  // AI & Gateway State
  const snapshot = useAiSettings()
  const gateway = useGateway()
  const routed = usesGateway(snapshot.settings)

  const gatewayManaged = gateway.status?.managed.available === true
  const gatewayVerified =
    gatewayManaged || (gateway.status?.connection?.verifiedAt ?? null) !== null
  const gatewayReady =
    gatewayManaged || (gateway.status?.connection !== null && gateway.status !== null)

  const status: 'unconfigured' | 'configured' | 'verified' = routed
    ? gatewayVerified
      ? 'verified'
      : gatewayReady
        ? 'configured'
        : 'unconfigured'
    : !snapshot.settings.baseUrl.trim() || !snapshot.settings.model.trim()
      ? 'unconfigured'
      : snapshot.lastTest?.ok
        ? 'verified'
        : 'configured'

  const badge =
    status === 'verified'
      ? routed
        ? 'Gateway available'
        : 'Endpoint responded'
      : status === 'configured'
        ? routed
          ? 'Connection saved · unverified'
          : 'Configured · unverified'
        : routed
          ? 'Gateway not available'
          : 'No provider'

  // Editor Preferences State
  const [editorPrefs, setEditorPrefs] = useState<EditorPreferences>(() => readEditorPreferences())
  const [editorSavedNotice, setEditorSavedNotice] = useState(false)

  const handleUpdateEditor = (patch: Partial<EditorPreferences>) => {
    const next: EditorPreferences = { ...editorPrefs, ...patch }
    setEditorPrefs(next)
    writeEditorPreferences(next)
    setEditorSavedNotice(true)
    setTimeout(() => setEditorSavedNotice(false), 2000)
  }

  // Terminal Settings State
  const [defaultShell, setDefaultShell] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('codepilot.terminal.defaultShell') || 'powershell.exe'
    }
    return 'powershell.exe'
  })
  const [pairingTokenInput, setPairingTokenInput] = useState<string>(() => getTerminalToken() || '')
  const [terminalSavedNotice, setTerminalSavedNotice] = useState(false)

  const handleSaveTerminal = () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('codepilot.terminal.defaultShell', defaultShell)
    }
    setTerminalToken(pairingTokenInput.trim())
    setTerminalSavedNotice(true)
    setTimeout(() => setTerminalSavedNotice(false), 2000)
  }

  // General & Storage State
  const [storageUsage, setStorageUsage] = useState<string>('Measuring...')
  const [storageQuota, setStorageQuota] = useState<string>('Measuring...')
  const [projectCount, setProjectCount] = useState<number>(0)
  const [fileCount, setFileCount] = useState<number>(0)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
          const est = await navigator.storage.estimate()
          if (!cancelled && est.usage) setStorageUsage(formatBytes(est.usage))
          if (!cancelled && est.quota) setStorageQuota(formatBytes(est.quota))
        }
        const [pCount, fCount] = await Promise.all([db.projects.count(), db.files.count()])
        if (!cancelled) {
          setProjectCount(pCount)
          setFileCount(fCount)
        }
      } catch {
        // Ignore fallback
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleExportData = async () => {
    setExporting(true)
    setExportMessage(null)
    try {
      const result = await exportAccountData()
      const url = URL.createObjectURL(result.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename
      a.click()
      URL.revokeObjectURL(url)
      setExportMessage(`Saved: ${result.filename} (${formatBytes(result.blob.size)})`)
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : 'Account export failed. Ensure API is running.')
    } finally {
      setExporting(false)
    }
  }

  const handleClearActivities = async () => {
    if (window.confirm('Clear all local application activity history?')) {
      await clearActivities()
      alert('Activity history cleared.')
    }
  }

  return (
    <section className={styles.page} aria-labelledby="settings-title">
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Settings Hub</p>
          <h1 id="settings-title" className={styles.title}>
            Configuration &amp; Controls
          </h1>
          <p className={styles.lead}>
            Customize your development environment, configure AI providers, manage your local
            terminal, and inspect local-first storage.
          </p>
        </div>
        <Badge tone={status === 'verified' ? 'live' : 'planned'}>{badge}</Badge>
      </header>

      {/* Settings Navigation Tabs */}
      <nav className={styles.tabs} aria-label="Settings Categories">
        <button
          className={`${styles.tab} ${currentTab === 'ai' ? styles.activeTab : ''}`}
          onClick={() => setTab('ai')}
        >
          <Sparkles size={16} />
          AI &amp; Credentials
        </button>
        <button
          className={`${styles.tab} ${currentTab === 'editor' ? styles.activeTab : ''}`}
          onClick={() => setTab('editor')}
        >
          <FileCode2 size={16} />
          Editor &amp; Workspace
        </button>
        <button
          className={`${styles.tab} ${currentTab === 'terminal' ? styles.activeTab : ''}`}
          onClick={() => setTab('terminal')}
        >
          <Terminal size={16} />
          Integrated Terminal
        </button>
        <button
          className={`${styles.tab} ${currentTab === 'github' ? styles.activeTab : ''}`}
          onClick={() => setTab('github')}
        >
          <GitBranch size={16} />
          GitHub &amp; Git
        </button>
        <button
          className={`${styles.tab} ${currentTab === 'general' ? styles.activeTab : ''}`}
          onClick={() => setTab('general')}
        >
          <Settings2 size={16} />
          General &amp; Storage
        </button>
      </nav>

      {/* TAB 1: AI & CREDENTIALS */}
      {currentTab === 'ai' && (
        <div className={styles.grid}>
          <div className={styles.formCard}>
            <ProviderManager />
          </div>

          <aside className={styles.side}>
            <div className={styles.panel}>
              <h2>
                <UserRound size={15} />
                CodePilot Cloud account
              </h2>
              <GatewayAccountPanel />
            </div>

            <div className={styles.panel}>
              <h2>
                <ShieldCheck size={15} />
                How credentials are handled
              </h2>
              <ul>
                <li>
                  Managed mode: the API holds the platform provider key. It is never sent to the
                  browser, bundled into the app, or returned by an endpoint.
                </li>
                <li>
                  Bring-your-own mode: a saved key is encrypted with AES-256-GCM on the API and only
                  the last four characters are returned.
                </li>
                <li>
                  Provider keys are never stored in browser storage. Legacy keys in AI settings are
                  removed when settings load.
                </li>
                <li>
                  No key is present in the repository or the production bundle. Nothing is sent until
                  you ask for a completion.
                </li>
              </ul>
            </div>

            <div className={styles.panel}>
              <h2>
                <Radio size={15} />
                What “verified” means
              </h2>
              <p>
                A provider is only marked connected after its real model-list test succeeds. Test
                time, result and message are shown for each saved provider.
              </p>
              <p>
                Managed quotas are enforced by the API. Configured fallback providers are attempted
                only before any response text has been streamed; cancellation and partial output are
                never retried.
              </p>
            </div>

            <div className={styles.panel}>
              <h2>
                <Laptop size={15} />
                Local-first options
              </h2>
              <p>
                Ollama is called by the local API at its configured server URL. Start Ollama before
                testing; installing a model does not mean the service is running.
              </p>
              <Button to="/workspace" variant="secondary" size="sm">
                Open a workspace
              </Button>
            </div>

            <div className={styles.panel}>
              <h2>
                <KeyRound size={15} />
                Current slot
              </h2>
              <dl className={styles.slot}>
                <div>
                  <dt>Route</dt>
                  <dd>{routed ? 'CodePilot API gateway' : 'Direct browser provider'}</dd>
                </div>
                <div>
                  <dt>Preset</dt>
                  <dd>
                    {gateway.status?.connection?.label ??
                      (gateway.status?.managed.available ? gateway.status.managed.label : 'not selected')}
                  </dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>
                    {snapshot.settings.model ||
                      gateway.status?.managed.model ||
                      gateway.status?.connection?.model ||
                      'provider default'}
                  </dd>
                </div>
                <div>
                  <dt>Key in this browser</dt>
                  <dd>none</dd>
                </div>
              </dl>
              <p className={styles.footNote}>
                Context controls and conversation history live inside a workspace.{' '}
                <Link to="/copilot">How the Copilot works</Link>.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* TAB 2: EDITOR & WORKSPACE */}
      {currentTab === 'editor' && (
        <div style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className={styles.sectionCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 className={styles.settingTitle}>Monaco Code Editor Configuration</h3>
                <p className={styles.settingDesc}>
                  Preferences are stored locally in your browser and apply across all project workspaces immediately.
                </p>
              </div>
              {editorSavedNotice && <Badge tone="ok">Preferences Saved</Badge>}
            </div>

            {/* Font Size */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Font Size</h4>
                <p className={styles.settingDesc}>Controls the editor text scale in pixels (11px – 22px).</p>
              </div>
              <div className={styles.controlGroup}>
                <input
                  type="range"
                  min="11"
                  max="22"
                  value={editorPrefs.fontSize}
                  onChange={(e) => handleUpdateEditor({ fontSize: clampFontSize(Number(e.target.value)) })}
                  className={styles.sliderInput}
                />
                <span style={{ fontFamily: 'var(--font-mono)', minWidth: '40px', textAlign: 'right' }}>
                  {editorPrefs.fontSize}px
                </span>
              </div>
            </div>

            {/* Theme */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Editor Surface Theme</h4>
                <p className={styles.settingDesc}>Monaco color theme for source files and diff views.</p>
              </div>
              <div className={styles.controlGroup}>
                <select
                  value={editorPrefs.theme}
                  onChange={(e) => handleUpdateEditor({ theme: e.target.value as 'midnight' | 'graphite' })}
                  className={styles.selectInput}
                >
                  <option value="midnight">Midnight (Deep Blue Slate)</option>
                  <option value="graphite">Graphite (Neutral Carbon)</option>
                </select>
              </div>
            </div>

            {/* Minimap */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Code Minimap</h4>
                <p className={styles.settingDesc}>Display a high-level visual code outline on the right edge.</p>
              </div>
              <div className={styles.controlGroup}>
                <input
                  type="checkbox"
                  id="minimap-toggle"
                  checked={editorPrefs.minimap}
                  onChange={(e) => handleUpdateEditor({ minimap: e.target.checked })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="minimap-toggle" style={{ cursor: 'pointer', fontSize: 'var(--fs-12)' }}>
                  {editorPrefs.minimap ? 'Enabled' : 'Disabled'}
                </label>
              </div>
            </div>

            {/* Word Wrap */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Word Wrap</h4>
                <p className={styles.settingDesc}>Wrap long code lines to prevent horizontal scrolling.</p>
              </div>
              <div className={styles.controlGroup}>
                <input
                  type="checkbox"
                  id="wordwrap-toggle"
                  checked={editorPrefs.wordWrap}
                  onChange={(e) => handleUpdateEditor({ wordWrap: e.target.checked })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="wordwrap-toggle" style={{ cursor: 'pointer', fontSize: 'var(--fs-12)' }}>
                  {editorPrefs.wordWrap ? 'Wrap on viewport edge' : 'No wrap (scroll horizontally)'}
                </label>
              </div>
            </div>

            {/* Format on Save */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Format on Save</h4>
                <p className={styles.settingDesc}>Automatically run the local Prettier formatter when saving files.</p>
              </div>
              <div className={styles.controlGroup}>
                <input
                  type="checkbox"
                  id="format-toggle"
                  checked={editorPrefs.formatOnSave}
                  onChange={(e) => handleUpdateEditor({ formatOnSave: e.target.checked })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="format-toggle" style={{ cursor: 'pointer', fontSize: 'var(--fs-12)' }}>
                  {editorPrefs.formatOnSave ? 'Auto-format active' : 'Do not format on save'}
                </label>
              </div>
            </div>

            {/* Live Preview Box */}
            <div>
              <h4 className={styles.settingTitle} style={{ marginBottom: '6px' }}>
                Live Typography Preview ({editorPrefs.fontSize}px · {editorPrefs.theme})
              </h4>
              <div
                className={styles.previewBox}
                style={{
                  fontSize: `${editorPrefs.fontSize}px`,
                  lineHeight: `${Math.round(editorPrefs.fontSize * 1.6)}px`,
                  background: editorPrefs.theme === 'midnight' ? '#0a1626' : '#0c111a',
                }}
              >
                {`// CodePilot Lab — Live Monaco Editor Preview
import { useState } from 'react';

export function CodePilotLab() {
  const [active, setActive] = useState(true);
  return <div className="editor">Local-first IDE · ${editorPrefs.fontSize}px</div>;
}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: INTEGRATED TERMINAL */}
      {currentTab === 'terminal' && (
        <div style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className={styles.sectionCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 className={styles.settingTitle}>Integrated Terminal &amp; PTY Configuration</h3>
                <p className={styles.settingDesc}>
                  Configures the loopback WebSocket terminal connected to node-pty on Windows (ConPTY).
                </p>
              </div>
              {terminalSavedNotice && <Badge tone="ok">Terminal Saved</Badge>}
            </div>

            {/* Default Shell */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Default Windows Shell</h4>
                <p className={styles.settingDesc}>Preferred shell binary to spawn when creating new terminal tabs.</p>
              </div>
              <div className={styles.controlGroup}>
                <select
                  value={defaultShell}
                  onChange={(e) => setDefaultShell(e.target.value)}
                  className={styles.selectInput}
                >
                  <option value="powershell.exe">Windows PowerShell (powershell.exe)</option>
                  <option value="cmd.exe">Command Prompt (cmd.exe)</option>
                </select>
              </div>
            </div>

            {/* Pairing Token */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Pairing Token (sessionStorage)</h4>
                <p className={styles.settingDesc}>
                  Security token printed to console on companion startup. Required for WebSocket PTY handshake.
                </p>
              </div>
              <div className={styles.controlGroup}>
                <input
                  type="password"
                  placeholder="Paste pairing token..."
                  value={pairingTokenInput}
                  onChange={(e) => setPairingTokenInput(e.target.value)}
                  className={styles.selectInput}
                  style={{ width: '220px' }}
                />
              </div>
            </div>

            {/* Save Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
              <Button variant="primary" onClick={handleSaveTerminal}>
                Save Terminal Settings
              </Button>
            </div>
          </div>

          {/* Terminal Architecture Details */}
          <div className={styles.panel}>
            <h2>
              <Terminal size={15} />
              PTY Architecture &amp; Security Boundaries
            </h2>
            <ul>
              <li>
                <strong>Loopback Only</strong>: Bound strictly to <code>127.0.0.1:5310</code> with Origin allow-list checks.
              </li>
              <li>
                <strong>Ephemeral Pairing Token</strong>: Printed exclusively to the host terminal console upon service boot. Never written to Dexie or disk.
              </li>
              <li>
                <strong>Real OS Shell</strong>: Commands execute on your actual operating system. Not a synthetic sandbox.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* TAB 4: GITHUB INTEGRATION */}
      {currentTab === 'github' && (
        <div style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className={styles.sectionCard}>
            <GithubPanel />
          </div>
        </div>
      )}

      {/* TAB 5: GENERAL & STORAGE */}
      {currentTab === 'general' && (
        <div style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className={styles.sectionCard}>
            <div>
              <h3 className={styles.settingTitle}>Local Storage &amp; Account Data</h3>
              <p className={styles.settingDesc}>
                CodePilot Lab is 100% local-first. All project files, drafts, practice submissions, and activities
                live inside IndexedDB in your browser.
              </p>
            </div>

            {/* App Info */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>CodePilot Lab Release</h4>
                <p className={styles.settingDesc}>React 19 + TypeScript + Vite SPA development build.</p>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--cyan)' }}>
                v{__APP_VERSION__} · Milestone 02
              </div>
            </div>

            {/* Storage Quota */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Browser Storage Estimate</h4>
                <p className={styles.settingDesc}>
                  {projectCount} projects, {fileCount} stored files across Dexie schema v5.
                </p>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
                {storageUsage} used of {storageQuota} quota
              </div>
            </div>

            {/* Export Account Data */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Export Account Data</h4>
                <p className={styles.settingDesc}>
                  Download a complete JSON archive of your user profile, server-side projects, and AI usage quotas.
                </p>
                {exportMessage && (
                  <p style={{ color: 'var(--cyan)', fontSize: 'var(--fs-11)', marginTop: '4px' }}>
                    {exportMessage}
                  </p>
                )}
              </div>
              <Button variant="secondary" onClick={() => void handleExportData()} disabled={exporting}>
                <Download size={14} />
                {exporting ? 'Exporting...' : 'Export Account Data'}
              </Button>
            </div>

            {/* Clear Activity Logs */}
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Activity &amp; Diagnostics Logs</h4>
                <p className={styles.settingDesc}>
                  Purge recorded application action history from your local IndexedDB storage.
                </p>
              </div>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => void handleClearActivities()}
              >
                <Trash2 size={13} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-1px' }} />
                Clear Activity History
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
