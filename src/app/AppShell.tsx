import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { CommandPalette } from './CommandPalette'
import { Header } from './Header'
import { MobileMenu } from './MobileMenu'
import { StatusBar } from './StatusBar'
import { PageTransition } from './PageTransition'
import styles from './AppShell.module.css'

export function AppShell() {
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openMenu = useCallback(() => setMenuOpen(true), [])
  const closeMenu = useCallback(() => setMenuOpen(false), [])

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
    <div className={styles.shell}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <Header onOpenPalette={openPalette} onOpenMenu={openMenu} menuOpen={menuOpen} />

      <main id="main" className={styles.main}>
        <PageTransition key={location.pathname}>
          <Outlet />
        </PageTransition>
      </main>

      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <MobileMenu open={menuOpen} onClose={closeMenu} />
      <div className={styles.grain} aria-hidden="true" />
    </div>
  )
}
