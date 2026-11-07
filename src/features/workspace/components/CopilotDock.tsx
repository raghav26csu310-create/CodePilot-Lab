import { Info, Lock, MessagesSquare, Send, Sparkles, X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '../../../design-system/primitives/Badge'
import { findNode } from '../state/fileTree'
import type { WorkspaceTab } from '../state/types'
import { useWorkspace } from '../state/useWorkspace'
import { FileGlyph } from './FileGlyph'
import styles from './CopilotDock.module.css'

type CopilotDockProps = {
  variant?: 'inline' | 'drawer'
  onRequestClose?: () => void
}

const MAX_DRAFT = 4000

export function CopilotDock({ variant = 'inline', onRequestClose }: CopilotDockProps) {
  const { state, dispatch } = useWorkspace()
  const { tabs } = state.tree
  const { copilotContext } = state.ui
  const [draft, setDraft] = useState('')

  const attachedNotOpen = copilotContext.filter(
    (path) => !tabs.some((tab) => tab.path === path),
  )

  return (
    <aside className={styles.panel} data-variant={variant} aria-label="AI Copilot dock">
      <header className={styles.head}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            <Sparkles size={15} />
            <span className={styles.avatarRing} />
          </span>
          <div className={styles.identityCopy}>
            <p className={styles.kicker}>AI Copilot</p>
            <h2 className={styles.title}>Copilot dock</h2>
          </div>
        </div>

        {onRequestClose ? (
          <button
            type="button"
            className={styles.close}
            onClick={onRequestClose}
            aria-label={variant === 'drawer' ? 'Close Copilot drawer' : 'Close Copilot dock'}
            title={variant === 'drawer' ? 'Close Copilot drawer' : 'Close Copilot dock'}
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className={styles.status}>
        <Badge tone="planned">Bridge scheduled</Badge>
        <span className={styles.statusNote}>
          <span className={styles.statusDot} aria-hidden="true" />
          No model connected
        </span>
      </div>

      <div className={styles.scroll}>
        <section className={styles.section} aria-labelledby="copilot-context-title">
          <div className={styles.sectionHead}>
            <span id="copilot-context-title" className={styles.sectionTitle}>
              Context controls
            </span>
            <span className={styles.sectionMeta}>
              {copilotContext.length} attached
            </span>
          </div>

          <p className={styles.sectionCopy}>
            Only files you attach here would be prepared for a future local model. No file content
            is read in this phase.
          </p>

          {tabs.length === 0 && copilotContext.length === 0 ? (
            <p className={styles.contextEmpty}>
              Open a file from the explorer, or use “Attach to Copilot context” in a file tab.
            </p>
          ) : (
            <ul className={styles.contextList}>
              {tabs.map((tab) => (
                <ContextRow
                  key={tab.path}
                  tab={tab}
                  checked={copilotContext.includes(tab.path)}
                  onToggle={() =>
                    dispatch({ type: 'ui/toggle-copilot-context', path: tab.path })
                  }
                />
              ))}
            </ul>
          )}

          {attachedNotOpen.length > 0 ? (
            <div className={styles.pinned}>
              <div className={styles.pinnedHead}>
                <span>Attached by path</span>
                <button
                  type="button"
                  className={styles.clear}
                  onClick={() => dispatch({ type: 'ui/clear-copilot-context' })}
                >
                  Clear all
                </button>
              </div>
              <ul className={styles.pinnedList}>
                {attachedNotOpen.map((path) => {
                  const node = findNode(state.tree.nodes, path)
                  return (
                    <li key={path} className={styles.pinnedRow}>
                      <FileGlyph name={node?.name ?? path} kind="file" size={12} />
                      <code title={path}>{path}</code>
                      <button
                        type="button"
                        className={styles.remove}
                        onClick={() =>
                          dispatch({ type: 'ui/toggle-copilot-context', path })
                        }
                        aria-label={`Remove ${path} from Copilot context`}
                      >
                        <X size={10} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {copilotContext.length > 0 && attachedNotOpen.length === 0 ? (
            <button
              type="button"
              className={styles.clear}
              onClick={() => dispatch({ type: 'ui/clear-copilot-context' })}
            >
              Clear attached context
            </button>
          ) : null}
        </section>

        <section className={styles.conversation} aria-labelledby="conversation-title">
          <div className={styles.sectionHead}>
            <span id="conversation-title" className={styles.sectionTitle}>
              Conversation
            </span>
            <span className={styles.sectionMeta}>0 messages</span>
          </div>

          <div className={styles.emptyConversation}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <MessagesSquare size={21} />
            </span>
            <p className={styles.emptyTitle}>No model bridge connected</p>
            <p className={styles.emptyCopy}>
              Responses are not generated, streamed, or stored. The composer below keeps a local
              draft only — nothing is sent anywhere.
            </p>
            <span className={styles.emptyBadge}>AI responses intentionally unavailable</span>
          </div>
        </section>
      </div>

      <footer className={styles.composer}>
        <div className={styles.composerHead}>
          <label htmlFor="copilot-draft" className={styles.composerLabel}>
            Message
          </label>
          <span className={styles.draftState}>Draft · not sent</span>
        </div>

        <textarea
          id="copilot-draft"
          className={styles.textarea}
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MAX_DRAFT))}
          placeholder="Ask about the attached files…"
          rows={3}
          spellCheck={false}
          aria-describedby="copilot-composer-note"
        />

        <div className={styles.composerFoot}>
          <span id="copilot-composer-note" className={styles.composerNote}>
            <Info size={11} aria-hidden="true" />
            Local draft · {draft.length}/{MAX_DRAFT}
          </span>
          <button
            type="button"
            className={styles.send}
            disabled
            title="No local model bridge is connected in this phase"
          >
            <Lock size={11} aria-hidden="true" />
            Send unavailable
            <Send size={11} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </aside>
  )
}

function ContextRow({
  tab,
  checked,
  onToggle,
}: {
  tab: WorkspaceTab
  checked: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <label className={styles.contextRow} data-checked={checked}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          onChange={onToggle}
        />
        <span className={styles.checkmark} aria-hidden="true" />
        <FileGlyph name={tab.name} kind="file" size={12} />
        <span className={styles.contextName} title={tab.path}>
          {tab.name}
        </span>
        <span className={styles.contextPath}>{tab.path}</span>
      </label>
    </li>
  )
}
