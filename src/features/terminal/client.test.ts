import { describe, expect, it } from 'vitest'
import {
  describeTerminalClose,
  getTerminalToken,
  setTerminalToken,
  terminalSocketUrl,
} from './client'

describe('terminal client', () => {
  it('formats socket URLs with token and optional shell', () => {
    const defaultUrl = terminalSocketUrl('test-token-123')
    expect(defaultUrl).toContain('token=test-token-123')
    expect(defaultUrl.startsWith('ws://') || defaultUrl.startsWith('wss://')).toBe(true)

    const shellUrl = terminalSocketUrl('test-token-123', 'powershell.exe')
    expect(shellUrl).toContain('token=test-token-123')
    expect(shellUrl).toContain('shell=powershell.exe')
  })

  it('stores and retrieves terminal token in session storage or fallback', () => {
    setTerminalToken('tok_abc_xyz')
    expect(getTerminalToken()).toBe('tok_abc_xyz')

    setTerminalToken('')
    expect(getTerminalToken()).toBe('')
  })

  it('describes close reasons honestly', () => {
    expect(describeTerminalClose({ code: 1000, intentional: true })).toBe('Disconnected.')
    expect(describeTerminalClose({ code: 1006, intentional: false })).toContain('handshake')
    expect(describeTerminalClose({ code: 1001, intentional: false })).toContain('shutting down')
  })
})
