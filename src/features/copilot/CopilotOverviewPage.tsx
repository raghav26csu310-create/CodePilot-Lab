import {
  ArrowRight,
  BookOpen,
  Bug,
  FileDiff,
  FlaskConical,
  GraduationCap,
  KeyRound,
  Layers,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { useAiSettings } from '../copilot/settingsStore'
import { providerLabel } from '../copilot/providerPresets'
import styles from './CopilotOverviewPage.module.css'

const CAPABILITIES = [
  {
    icon: MessageSquare,
    title: 'Ask about the project',
    copy: 'Free-form chat scoped to the files, selection, tree and diagnostics you allow.',
  },
  {
    icon: BookOpen,
    title: 'Explain code',
    copy: 'Line-by-line explanations with beginner, intermediate and advanced depth.',
  },
  {
    icon: Bug,
    title: 'Debug assistant',
    copy: 'Reads real Monaco diagnostics, separates evidence from hypotheses, proposes the fix.',
  },
  {
    icon: Wand2,
    title: 'Generate code',
    copy: 'Functions, snippets and complete files that follow the conventions already in the tree.',
  },
  {
    icon: ShieldCheck,
    title: 'Code review',
    copy: 'Bugs, readability, performance and common security issues — with file references.',
  },
  {
    icon: FlaskConical,
    title: 'Test generation',
    copy: 'Suggested cases, edge cases and expected outcomes, or a complete test file.',
  },
  {
    icon: GraduationCap,
    title: 'Learning assistant',
    copy: 'Progressive hints and questions first; the full solution only when you ask.',
  },
]

export function CopilotOverviewPage() {
  const snapshot = useAiSettings()
  const configured = snapshot.settings.baseUrl.trim() !== '' && snapshot.settings.model.trim() !== ''
  const status = !configured
    ? 'unconfigured'
    : snapshot.lastTest?.ok
      ? 'verified'
      : 'configured'

  return (
    <section className={styles.page} aria-labelledby="copilot-title">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Phase 5 · intelligent AI Copilot</p>
          <h1 id="copilot-title" className={styles.title}>
            A copilot wired to
            <span> the project you actually have.</span>
          </h1>
          <p className={styles.lead}>
            The assistant reads the active editor model, your selection, the project tree and real
            diagnostics — never the whole project by default. Every proposed file is complete,
            diffed and applied only when you accept it.
          </p>
          <div className={styles.actions}>
            <Button to="/workspace" variant="primary" size="md" iconRight={<ArrowRight size={15} />}>
              Open a workspace
            </Button>
            <Button to="/settings" variant="secondary" size="md">
              Configure provider
            </Button>
          </div>
        </div>

        <aside className={styles.statusCard} aria-label="Provider status">
          <div className={styles.statusHead}>
            <Sparkles size={15} />
            <span>AI bridge</span>
            <Badge tone={status === 'verified' ? 'live' : status === 'configured' ? 'warn' : 'neutral'}>
              {status === 'verified'
                ? 'Verified session'
                : status === 'configured'
                  ? 'Configured · unverified'
                  : 'No provider'}
            </Badge>
          </div>
          <dl>
            <div>
              <dt>Provider</dt>
              <dd>{configured ? providerLabel(snapshot.settings) : 'not selected'}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{snapshot.settings.model || '—'}</dd>
            </div>
            <div>
              <dt>Endpoint</dt>
              <dd>{snapshot.settings.baseUrl || '—'}</dd>
            </div>
            <div>
              <dt>Key</dt>
              <dd>
                {snapshot.settings.apiKey
                  ? snapshot.settings.rememberKey
                    ? 'remembered in this browser'
                    : 'memory only'
                  : 'none'}
              </dd>
            </div>
          </dl>
          <p className={styles.statusNote}>
            Status is evidence, not decoration. A provider is only “verified” after a request
            actually succeeded. With no provider, the workspace keeps working and no AI call is
            attempted.
          </p>
        </aside>
      </header>

      <div className={styles.sectionHead}>
        <h2>Capabilities</h2>
        <span>All seven modes share the same context controls and stop button.</span>
      </div>
      <div className={styles.grid}>
        {CAPABILITIES.map((capability) => {
          const Icon = capability.icon
          return (
            <article key={capability.title} className={styles.card}>
              <span className={styles.cardIcon}>
                <Icon size={15} />
              </span>
              <h3>{capability.title}</h3>
              <p>{capability.copy}</p>
            </article>
          )
        })}
      </div>

      <div className={styles.split}>
        <article className={styles.panel}>
          <h2>
            <Layers size={16} />
            How context is chosen
          </h2>
          <ol>
            <li>
              Toggles decide whether the active file, selection, tree names and diagnostics are
              eligible.
            </li>
            <li>
              The active file is added only when its toggle is on. Everything else must be attached
              explicitly from a tab or the explorer.
            </li>
            <li>
              A character budget caps the bundle; truncation and unreadable files are reported to
              the model and to you.
            </li>
            <li>
              The context panel can read the exact bundle before you send, and every request stores
              what was shared.
            </li>
          </ol>
        </article>

        <article className={styles.panel}>
          <h2>
            <FileDiff size={16} />
            How changes are applied
          </h2>
          <ol>
            <li>Models answer with complete-file proposals in a typed fenced block.</li>
            <li>CodePilot parses the block defensively; unsafe paths become unappliable, not silent writes.</li>
            <li>You review a side-by-side diff against the live draft, saved copy or folder copy.</li>
            <li>Accepting edits the Monaco buffer as one undoable operation. Saving stays yours.</li>
            <li>Every applied proposal keeps the previous whole-file content for restore.</li>
          </ol>
        </article>
      </div>

      <div className={styles.split}>
        <article className={styles.panel}>
          <h2>
            <KeyRound size={16} />
            Credentials in an honest local-first app
          </h2>
          <p>
            CodePilot Lab is a static SPA with no backend. Keys are entered at runtime, never
            compiled into source, and stay in memory unless you opt into IndexedDB persistence. For
            server-side secrets, run a local proxy and point the base URL at it.
          </p>
        </article>

        <article className={styles.panel}>
          <h2>
            <Bug size={16} />
            Known limits
          </h2>
          <ul>
            <li>CORS can block browser calls to a provider that does not allow this origin.</li>
            <li>Free tiers rate-limit; the UI reports the provider&apos;s status instead of retrying.</li>
            <li>Proposals are complete files, so very large files hit the diff review line cap.</li>
            <li>Conversation history is per workspace session; it is not archived to disk yet.</li>
            <li>The copilot cannot run code, tests or commands — that belongs to a later phase.</li>
          </ul>
        </article>
      </div>

      <p className={styles.footerNote}>
        Context controls, streaming and diff review are inside the workspace dock.{' '}
        <Link to="/workspace">Pick a project</Link> or{' '}
        <Link to="/settings">review provider settings</Link>.
      </p>
    </section>
  )
}
