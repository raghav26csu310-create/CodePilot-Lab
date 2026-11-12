import { PanelLeftClose, PanelLeftOpen, Settings2 } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import { Brand } from '../brand/Brand'
import { NAV_ROUTES } from './routes'
import styles from './Sidebar.module.css'

type SidebarProps = {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside className={styles.sidebar} data-collapsed={collapsed}>
      <div className={styles.brandRow}>
        <Brand compact={collapsed} />
        {collapsed ? null : <span className={styles.version}>v{__APP_VERSION__}</span>}
      </div>

      <div className={styles.navHead}>
        <span className={styles.navHeadLabel}>Modules</span>
        {collapsed ? null : (
          <span className={styles.navHeadCount}>
            {String(NAV_ROUTES.length).padStart(2, '0')}
          </span>
        )}
      </div>

      <nav id="primary-navigation" className={styles.nav} aria-label="Primary">
        <ul className={styles.list}>
          {NAV_ROUTES.map((route) => {
            const Icon = route.icon
            return (
              <li key={route.path}>
                <NavLink
                  to={route.path}
                  end={route.path === '/'}
                  className={({ isActive }) =>
                    `${styles.link} ${isActive ? styles.linkActive : ''}`
                  }
                  title={collapsed ? route.label : undefined}
                  aria-label={collapsed ? route.label : undefined}
                >
                  <span className={styles.icon}>
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <span className={styles.label}>{route.label}</span>
                  {route.status === 'live' ? (
                    <span className={styles.liveDot} aria-hidden="true" />
                  ) : (
                    <span className={styles.soon}>Soon</span>
                  )}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className={styles.footer}>
        <p className={styles.milestone}>
          Milestone 07 · <span>Public beta</span>
        </p>

        <Link
          to="/settings"
          className={styles.settings}
          title={collapsed ? 'Settings' : undefined}
          aria-label={collapsed ? 'Settings' : undefined}
        >
          <Settings2 size={16} aria-hidden="true" />
          <span>Settings</span>
        </Link>

        <button
          type="button"
          className={styles.toggle}
          onClick={onToggle}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={16} aria-hidden="true" />
          )}
          <span>Collapse</span>
        </button>

        <p className={styles.localNote}>
          <span className={styles.localDot} aria-hidden="true" />
          Local only · no telemetry
        </p>
      </div>
    </aside>
  )
}
