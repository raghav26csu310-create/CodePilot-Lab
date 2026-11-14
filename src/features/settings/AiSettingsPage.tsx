import { GitBranch, KeyRound, Laptop, Radio, ShieldCheck, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { GatewayAccountPanel } from '../copilot/gateway/AccountPanel'
import { useGateway } from '../copilot/gateway/store'
import { ProviderSettingsForm } from '../copilot/ProviderSettingsForm'
import { providerLabel, usesGateway } from '../copilot/providerPresets'
import { useAiSettings } from '../copilot/settingsStore'
import { GithubPanel } from '../github/GithubPanel'
import styles from './AiSettingsPage.module.css'

export function AiSettingsPage() {
  const snapshot = useAiSettings()
  const gateway = useGateway()
  const routed = usesGateway(snapshot.settings)

  const gatewayManaged = gateway.status?.managed.available === true
  const gatewayVerified =
    gatewayManaged || (gateway.status?.connection?.verifiedAt ?? null) !== null
  const gatewayReady =
    gatewayManaged || gateway.status?.connection !== null && gateway.status !== null

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

  return (
    <section className={styles.page} aria-labelledby="settings-title">
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Settings · AI</p>
          <h1 id="settings-title" className={styles.title}>
            AI &amp; credentials
          </h1>
          <p className={styles.lead}>
            CodePilot AI runs through the CodePilot API: your account authenticates the request and
            provider keys stay on the server. A local or bring-your-own endpoint remains available
            as an explicitly labelled advanced mode.
          </p>
        </div>
        <Badge tone={status === 'verified' ? 'live' : 'planned'}>{badge}</Badge>
      </header>

      <div className={styles.grid}>
        <div className={styles.formCard}>
          <ProviderSettingsForm />
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
              <GitBranch size={15} />
              GitHub integration
            </h2>
            <GithubPanel />
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
                Direct browser mode still exists as an advanced fallback. In that mode the key lives
                in tab memory by default, and “remember” writes it in plaintext to this
                browser&apos;s IndexedDB.
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
              The gateway is only shown as available after a real status request succeeded in this
              session. A direct provider is only marked verified after a real request listed models
              or a completed chat response. Saving settings clears that claim.
            </p>
            <p>
              Quotas are enforced by the API. When the managed daily or monthly limit is reached the
              request fails with the real reason; nothing is retried automatically.
            </p>
          </div>

          <div className={styles.panel}>
            <h2>
              <Laptop size={15} />
              Local-first options
            </h2>
            <p>
              Ollama, LM Studio and llama.cpp run on this machine and need no account. They remain
              supported as the advanced direct mode; remote OpenAI-compatible providers work too,
              but the browser makes a cross-origin request, so the provider or a proxy must allow
              it.
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
                <dd>{providerLabel(snapshot.settings)}</dd>
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
                <dd>
                  {routed
                    ? 'none'
                    : snapshot.settings.apiKey
                      ? snapshot.settings.rememberKey
                        ? 'saved (plaintext IndexedDB)'
                        : 'memory only'
                      : 'none'}
                </dd>
              </div>
            </dl>
            <p className={styles.footNote}>
              Context controls and conversation history live inside a workspace.{' '}
              <Link to="/copilot">How the Copilot works</Link>.
            </p>
          </div>
        </aside>
      </div>
    </section>
  )
}
