import { describe, expect, it } from 'vitest'

import {
  detectKind,
  extractExports,
  extractImports,
  resolveRelativeImport,
} from './projectAnalysis'

describe('projectAnalysis AST & structure engine', () => {
  it('correctly detects module kinds from path conventions', () => {
    expect(detectKind('src/index.ts')).toBe('entry')
    expect(detectKind('main.py')).toBe('entry')
    expect(detectKind('main.c')).toBe('entry')
    expect(detectKind('src/components/Button.tsx')).toBe('source')
    expect(detectKind('src/utils.test.ts')).toBe('test')
    expect(detectKind('tests/test_math.py')).toBe('test')
    expect(detectKind('package.json')).toBe('config')
    expect(detectKind('tsconfig.json')).toBe('config')
    expect(detectKind('README.md')).toBe('doc')
    expect(detectKind('assets/logo.svg')).toBe('asset')
  })

  it('resolves relative import targets within known project file paths', () => {
    const allPaths = new Set([
      'src/index.ts',
      'src/components/Button.tsx',
      'src/components/index.ts',
      'src/utils/math.ts',
    ])

    // Relative from src/index.ts to src/components/Button.tsx
    const resolved = resolveRelativeImport('src/index.ts', './components/Button', allPaths)
    expect(resolved).toBe('src/components/Button.tsx')

    // Relative from src/components/Button.tsx to src/utils/math.ts
    const resolvedParent = resolveRelativeImport('src/components/Button.tsx', '../utils/math', allPaths)
    expect(resolvedParent).toBe('src/utils/math.ts')

    // Non-relative import returns null
    expect(resolveRelativeImport('src/index.ts', 'react', allPaths)).toBeNull()
  })

  it('extracts imports from TypeScript, JavaScript, Python and C source code', () => {
    const allPaths = new Set(['src/Button.tsx', 'src/styles.css', 'src/helper.py', 'header.h'])

    const tsCode = `
      import React, { useState } from 'react';
      import { Button } from './Button';
      import './styles.css';
    `
    const tsImports = extractImports('src/App.tsx', tsCode, allPaths)
    expect(tsImports).toContain('src/Button.tsx')
    expect(tsImports).toContain('src/styles.css')

    const pyCode = `
      import os
      from .helper import run_task
    `
    const pyImports = extractImports('src/main.py', pyCode, allPaths)
    expect(pyImports).toContain('src/helper.py')

    const cCode = `
      #include <stdio.h>
      #include "header.h"
    `
    const cImports = extractImports('main.c', cCode, allPaths)
    expect(cImports).toContain('header.h')
  })

  it('extracts named and default exports from source files', () => {
    const tsCode = `
      export const API_URL = 'http://localhost:3000';
      export function calculateTotal(a: number, b: number) { return a + b; }
      export class WorkspaceEngine {}
      export type Config = { port: number };
      export default calculateTotal;
    `
    const tsExports = extractExports('src/engine.ts', tsCode)
    expect(tsExports).toContain('API_URL')
    expect(tsExports).toContain('calculateTotal')
    expect(tsExports).toContain('WorkspaceEngine')
    expect(tsExports).toContain('Config')
    expect(tsExports).toContain('default')

    const pyCode = `
      def public_function():
          pass

      def _private_function():
          pass

      class ProjectManager:
          pass
    `
    const pyExports = extractExports('manager.py', pyCode)
    expect(pyExports).toContain('public_function')
    expect(pyExports).toContain('ProjectManager')
    expect(pyExports).not.toContain('_private_function')
  })
})
