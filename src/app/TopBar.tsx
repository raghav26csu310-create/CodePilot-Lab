import { Menu, Search, Settings2 } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { Brand } from '../brand/Brand'
import { Kbd } from '../design-system/primitives/Kbd'
import { MOD_KEY } from '../lib/platform'
import { getSectionRoute } from './routes'
import styles from './TopBar.module.css'

type TopBarProps = {
  onOpenPalette: () => void
  onOpenMenu: () => void
  menuOpen: boolean
}

export function TopBar({ onOpenPalette, onOpenMenu, menuOpen }: TopBarProps) {
  const location = useLocation()
  const section = getSectionRoute(location.pathname)

  return (
    <header className={styles.topbar}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
          >
            <Menu size={18} aria-hidden="true" />
          </button>

          <div className={styles.mobileBrand}>
            <Brand />
          </div>

          <div className={styles.section}>
            <span className={styles.kicker}>Module</span>
            <span className={styles.sectionName}>{section.label}</span>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.palette}
            onClick={onOpenPalette}
            aria-haspopup="dialog"
          >
            <Search size={14} aria-hidden="true" />
            <span className={styles.paletteLabel}>Jump to</span>{' '}
            <span className={styles.paletteKeys}>
              <Kbd>{MOD_KEY}</Kbd>{' '}
              <Kbd>K</Kbd>
            </span>
            <span className="sr-only"> command palette</span>
          </button>

          <Link
            to="/settings"
            className={styles.iconLink}
            aria-label="Settings"
            title="Settings"
          >
            <Settings2 size={16} aria-hidden="true" />
          </Link>

          <span className={styles.local} title="This build loads only local assets.">
            <span className={styles.localDot} aria-hidden="true" />
            Local
          </span>
        </div>
      </div>
    </header>
  )
}
