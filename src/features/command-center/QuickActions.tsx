import {
  ArrowUpRight,
  Code2,
  FlaskConical,
  FolderInput,
  FolderPlus,
  Network,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import styles from './CommandCenter.module.css'

type QuickActionsProps = {
  onCreate: () => void
  onImport: () => void
}

export function QuickActions({ onCreate, onImport }: QuickActionsProps) {
  return (
    <section className={styles.panel} aria-labelledby="quick-actions-title">
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelKicker}>Dispatch</p>
          <h2 id="quick-actions-title" className={styles.panelTitle}>
            Quick actions
          </h2>
        </div>
      </div>

      <ul className={styles.actionList}>
        <li>
          <Link to="/workspace" className={styles.action}>
            <span className={styles.actionIcon} aria-hidden="true">
              <Code2 size={16} />
            </span>
            <span className={styles.actionBody}>
              <span className={styles.actionTitle}>Open workspace</span>
              <span className={styles.actionHint}>Project picker · real session workspace</span>
            </span>
            <ArrowUpRight size={14} className={styles.actionArrow} aria-hidden="true" />
          </Link>
        </li>

        <li>
          <button type="button" className={styles.action} onClick={onCreate}>
            <span className={styles.actionIcon} aria-hidden="true">
              <FolderPlus size={16} />
            </span>
            <span className={styles.actionBody}>
              <span className={styles.actionTitle}>Create project</span>
              <span className={styles.actionHint}>Write a record to this browser</span>
            </span>
            <ArrowUpRight size={14} className={styles.actionArrow} aria-hidden="true" />
          </button>
        </li>

        <li>
          <button type="button" className={styles.action} onClick={onImport}>
            <span className={styles.actionIcon} aria-hidden="true">
              <FolderInput size={16} />
            </span>
            <span className={styles.actionBody}>
              <span className={styles.actionTitle}>Import project</span>
              <span className={styles.actionHint}>Scan a real folder into the registry</span>
            </span>
            <ArrowUpRight size={14} className={styles.actionArrow} aria-hidden="true" />
          </button>
        </li>

        <li>
          <Link to="/atlas" className={styles.action}>
            <span className={styles.actionIcon} aria-hidden="true">
              <Network size={16} />
            </span>
            <span className={styles.actionBody}>
              <span className={styles.actionTitle}>Explore Project Atlas</span>
              <span className={styles.actionHint}>Atlas scheduled · placeholder</span>
            </span>
            <span className={styles.actionChip}>Soon</span>
            <ArrowUpRight size={14} className={styles.actionArrow} aria-hidden="true" />
          </Link>
        </li>

        <li>
          <Link to="/lab" className={styles.action}>
            <span className={styles.actionIcon} aria-hidden="true">
              <FlaskConical size={16} />
            </span>
            <span className={styles.actionBody}>
              <span className={styles.actionTitle}>Open Execution Lab</span>
              <span className={styles.actionHint}>Real local runs and Python traces</span>
            </span>
            <ArrowUpRight size={14} className={styles.actionArrow} aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </section>
  )
}
