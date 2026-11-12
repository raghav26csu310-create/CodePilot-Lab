import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { readSidebarPreference, writeSidebarPreference } from '../lib/sidebarPreference'
import { CommandPalette } from './CommandPalette'
import { MobileMenu } from './MobileMenu'
import { PageTransition } from './PageTransition'
import { RouteErrorBoundary, RouteFallback } from './RouteBoundary'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'
import styles from './AppShell.module.css'

export function AppShell() {
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarPreference)

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openMenu = useCallback(() => setMenuOpen(true), [])
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  const toggleSidebar = useCallback(() => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    writeSidebarPreference(next)
  }, [sidebarCollapsed])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((current) => !current)
      }
    }

    const onPopState = () => {
      setPaletteOpen(false)
      setMenuOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  return (
    <div className={styles.shell} data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      <div className={styles.body}>
        <TopBar onOpenPalette={openPalette} onOpenMenu={openMenu} menuOpen={menuOpen} />

        <main id="main" className={styles.main}>
          <RouteErrorBoundary key={location.pathname}>
            <Suspense fallback={<RouteFallback />}>
              <PageTransition key={location.pathname}>
                <Outlet />
              </PageTransition>
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>

      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <MobileMenu open={menuOpen} onClose={closeMenu} />
      <div className={styles.grain} aria-hidden="true" />
    </div>
  )
}
