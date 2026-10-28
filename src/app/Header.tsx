import { Menu, Search, Settings2 } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import { Brand } from '../brand/Brand'
import { Kbd } from '../design-system/primitives/Kbd'
import { MOD_KEY } from '../lib/platform'
import { NAV_ROUTES } from './routes'
import styles from './Header.module.css'

type HeaderProps = {
  onOpenPalette: () => void
  onOpenMenu: () => void
  menuOpen: boolean
}

export function Header({ onOpenPalette, onOpenMenu, menuOpen }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Brand />

        <nav className={styles.nav} aria-label="Primary">
          {NAV_ROUTES.map((route) => (
            <NavLink
              key={route.path}
              to={route.path}
              end={route.path === '/'}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navActive : ''}`
              }
            >
              {route.label}
            </NavLink>
          ))}
        </nav>

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

          <Link to="/settings" className={styles.iconLink} aria-label="Settings">
            <Settings2 size={16} aria-hidden="true" />
          </Link>

          <span className={styles.local} title="This build loads only local assets.">
            <span className={styles.localDot} aria-hidden="true" />
            Local
          </span>

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
        </div>
      </div>
    </header>
  )
}
