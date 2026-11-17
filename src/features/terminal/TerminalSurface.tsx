import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from 'react'

import type { TerminalConnection } from './client'
import styles from './TerminalSurface.module.css'

import '@xterm/xterm/css/xterm.css'

export type TerminalStream = {
  write: (data: string) => void
}

export type TerminalSurfaceHandle = {
  write: (data: string) => void
  clear: () => void
  /** Returns the current xterm selection, or undefined when nothing is selected. */
  copy: () => string | undefined
  resize: (cols: number, rows: number) => void
  focus: () => void
  /** Re-fit the terminal to its host (use after showing a previously hidden session). */
  fit: () => void
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
 *
 * A handle (`write`, `clear`, `copy`, `fit`, `focus`) is exposed through a
 * ref so a parent can clear or copy the active session without knowing about xterm.
 */
export const TerminalSurface = forwardRef<TerminalSurfaceHandle, Props>(
  function TerminalSurface({ connection, onReady, onDispose }: Props, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const fitRef = useRef<FitAddon | null>(null)
    const callbacks = useRef({ onReady, onDispose })
    const frameRef = useRef(0)

    useEffect(() => {
      callbacks.current = { onReady, onDispose }
    })

    const fitNow = useCallback(() => {
      const host = hostRef.current
      const terminal = terminalRef.current
      const fit = fitRef.current
      if (!host || !terminal || !fit) {
        return
      }
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
    }, [connection])

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          terminalRef.current?.write(data)
        },
        clear: () => {
          terminalRef.current?.clear()
        },
        copy: () => {
          return terminalRef.current?.getSelection()
        },
        resize: (cols: number, rows: number) => {
          try {
            terminalRef.current?.resize(cols, rows)
          } catch {
            // ConPTY rejects resizes on a dead process; the exit event follows.
          }
          fitNow()
        },
        focus: () => {
          terminalRef.current?.focus()
        },
        fit: fitNow,
      }),
      [fitNow]
    )

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
      terminalRef.current = terminal

      const fit = new FitAddon()
      fitRef.current = fit
      terminal.loadAddon(fit)
      terminal.open(host)

      const stream: TerminalStream = { write: (data) => terminal.write(data) }
      callbacks.current.onReady(stream)
      const input = terminal.onData((data) => connection.sendInput(data))

      fitNow()

      const observer = new ResizeObserver(() => {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = window.requestAnimationFrame(fitNow)
      })
      observer.observe(host)
      terminal.focus()

      return () => {
        observer.disconnect()
        window.cancelAnimationFrame(frameRef.current)
        input.dispose()
        callbacks.current.onDispose()
        terminal.dispose()
        terminalRef.current = null
        fitRef.current = null
      }
    }, [connection, fitNow])

    return <div ref={hostRef} className={styles.host} aria-label="Interactive terminal" />
  }
)

export default TerminalSurface
