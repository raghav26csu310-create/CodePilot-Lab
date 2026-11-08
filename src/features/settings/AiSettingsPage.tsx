import { KeyRound, Laptop, Radio, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { ProviderSettingsForm } from '../copilot/ProviderSettingsForm'
import { useAiSettings } from '../copilot/settingsStore'
import styles from './AiSettingsPage.module.css'

export function AiSettingsPage() {
  const snapshot = useAiSettings()
  const status = !snapshot.settings.baseUrl.trim() || !snapshot.settings.model.trim()
    ? 'unconfigured'
    : snapshot.lastTest?.ok
      ? 'verified'
      : 'configured'

  return (
    <section className={styles.page} aria-labelledby="settings-title">
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Settings · AI bridge</p>
          <h1 id="settings-title" className={styles.title}>
            Provider &amp; credentials
          </h1>
          <p className={styles.lead}>
            CodePilot Lab has no backend. Model calls go directly from this tab to the endpoint you
            configure, which is why the default is a local Ollama server. Nothing is sent unless
            you press Send in a workspace.
          </p>
        </div>
        <Badge tone={status === 'verified' ? 'live' : 'planned'}>
          {status === 'verified'
            ? 'Endpoint responded'
            : status === 'configured'
              ? 'Configured · unverified'
              : 'No provider'}
        </Badge>
      </header>

      <div className={styles.grid}>
        <div className={styles.formCard}>
          <ProviderSettingsForm />
        </div>

        <aside className={styles.side}>
          <div className={styles.panel}>
            <h2>
              <ShieldCheck size={15} />
              How credentials are handled
            </h2>
            <ul>
              <li>
                Keys are typed at runtime and never compiled into the bundle. There is no key in
                the repository or in build output.
              </li>
              <li>
                By default a key lives only in this tab&apos;s memory. It disappears on reload.
              </li>
              <li>
                Opting into “remember” stores the key in this browser&apos;s IndexedDB. Anyone with
                access to this profile can read it; that trade-off is explicit.
              </li>
              <li>
                A local proxy can hold keys server-side: point the base URL at it and leave the key
                field empty here.
              </li>
            </ul>
          </div>

          <div className={styles.panel}>
            <h2>
              <Radio size={15} />
              What “verified” means
            </h2>
            <p>
              A provider is only marked verified after a real request succeeded in this session —
              either a connection test that listed models or a completed chat response. Saving
              settings clears that claim.
            </p>
            <p>
              Free tiers are not unlimited. Rate limits surface as errors with the provider&apos;s
              own HTTP status; nothing is retried automatically.
            </p>
          </div>

          <div className={styles.panel}>
            <h2>
              <Laptop size={15} />
              Local-first options
            </h2>
            <p>
              Ollama, LM Studio and llama.cpp all run on this machine and need no account. Remote
              OpenAI-compatible providers work too, but the browser will make a cross-origin
              request, so the provider or a proxy must allow it.
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
                <dt>Provider</dt>
                <dd>{snapshot.settings.preset}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{snapshot.settings.model || '—'}</dd>
              </div>
              <div>
                <dt>Key in memory</dt>
                <dd>{snapshot.settings.apiKey ? 'yes' : 'no'}</dd>
              </div>
              <div>
                <dt>Key persisted</dt>
                <dd>{snapshot.settings.rememberKey && snapshot.settings.apiKey ? 'yes' : 'no'}</dd>
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
