import { GitBranch, KeyRound, Laptop, Radio, ShieldCheck, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { GatewayAccountPanel } from '../copilot/gateway/AccountPanel'
import { useGateway } from '../copilot/gateway/store'
import { ProviderManager } from '../copilot/ProviderManager'
import { usesGateway } from '../copilot/providerPresets'
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
            Manage several real providers through the authenticated CodePilot API. Provider
            credentials are encrypted server-side, and requests stream through provider-specific
            adapters.
          </p>
        </div>
        <Badge tone={status === 'verified' ? 'live' : 'planned'}>{badge}</Badge>
      </header>

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
                <dd>
                  none
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
