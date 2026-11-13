import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import type { TerminalConnection } from './client'
import styles from './TerminalSurface.module.css'

import '@xterm/xterm/css/xterm.css'

export type TerminalStream = {
  write: (data: string) => void
}

type Props = {
  connection: TerminalConnection
  onReady: (stream: TerminalStream) => void
  onDispose: () => void
}

/**
 * The real xterm.js surface. Loaded lazily so the workspace bundle does not
 * pay for the renderer until a terminal session is actually opened.
 *
 * It owns no session state: output arrives through `onReady`, input and size
 * changes go back through the connection object owned by TerminalPanel.
 */
export default function TerminalSurface({ connection, onReady, onDispose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onReady, onDispose })

  useEffect(() => {
    callbacks.current = { onReady, onDispose }
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const fontFamily =
      getComputedStyle(host).getPropertyValue('--font-mono').trim() || 'monospace'

    const terminal = new Terminal({
      cursorBlink: !reducedMotion,
      fontFamily,
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: {
        background: '#05080d',
        foreground: '#e9eff8',
        cursor: '#57e2e6',
        cursorAccent: '#05080d',
        selectionBackground: 'rgba(87, 226, 230, 0.25)',
        black: '#0b111a',
        red: '#ff7e8c',
        green: '#5be0a8',
        yellow: '#f0c46a',
        blue: '#6aa8ff',
        magenta: '#b08cff',
        cyan: '#57e2e6',
        white: '#c9d6e8',
        brightBlack: '#5a6779',
        brightRed: '#ff9aa5',
        brightGreen: '#7ff0c4',
        brightYellow: '#ffd98a',
        brightBlue: '#8fc3ff',
        brightMagenta: '#c9aaff',
        brightCyan: '#8ff5f7',
        brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)

    callbacks.current.onReady({ write: (data) => terminal.write(data) })
    const input = terminal.onData((data) => connection.sendInput(data))

    let frame = 0
    const fitNow = () => {
      // Hidden tabs report zero size; fitting there would send nonsense.
      if (host.clientWidth < 24 || host.clientHeight < 24) {
        return
      }
      try {
        fit.fit()
      } catch {
        return
      }
      connection.resize(terminal.cols, terminal.rows)
    }

    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(fitNow)
    })
    observer.observe(host)
    fitNow()
    terminal.focus()

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      input.dispose()
      callbacks.current.onDispose()
      terminal.dispose()
    }
  }, [connection])

  return <div ref={hostRef} className={styles.host} aria-label="Interactive terminal" />
}
