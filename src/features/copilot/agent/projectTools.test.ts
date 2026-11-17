import { describe, expect, it } from 'vitest'

import {
  buildProjectExecutionSnapshot,
  createProjectReport,
  type AgentProjectFile,
} from './projectTools'

const files: AgentProjectFile[] = [
  {
    path: 'package.json',
    content: '{"type":"module","dependencies":{"zod":"^3.0.0"}}',
    language: 'JSON',
    source: 'stored',
  },
  {
    path: 'src/format.js',
    content: "export function format(value) { return `result: ${value}` }",
    language: 'JavaScript',
    source: 'stored',
  },
  {
    path: 'tests/format.test.js',
    content: [
      "import assert from 'node:assert/strict'",
      "import { format } from '../src/format.js'",
      "assert.equal(format('ready'), 'result: ready')",
      '// request timeout regression test',
    ].join('\n'),
    language: 'JavaScript',
    source: 'draft',
  },
]

describe('project-aware agent tools', () => {
  it('reports grounded dependencies, local import edges and search hits', () => {
    const report = createProjectReport({
      paths: files.map((file) => file.path),
      files,
      query: 'request timeout',
      omitted: [],
      omittedCount: 0,
      totalBytesRead: files.reduce((total, file) => total + file.content.length, 0),
    })

    expect(report.dependencies).toEqual([
      { manifest: 'package.json', names: ['zod'] },
    ])
    expect(report.imports).toContainEqual({
      path: 'tests/format.test.js',
      line: 2,
      specifier: '../src/format.js',
      resolvedPath: 'src/format.js',
      kind: 'local',
    })
    expect(report.search.hits).toContainEqual({
      path: 'tests/format.test.js',
      line: 4,
      preview: '// request timeout regression test',
    })
  })

  it('stages only the test entry and its resolved local files', () => {
    const report = createProjectReport({
      paths: [...files.map((file) => file.path), 'docs/unused.md'],
      files,
      query: 'format',
      omitted: [],
      omittedCount: 0,
      totalBytesRead: files.reduce((total, file) => total + file.content.length, 0),
    })

    const snapshot = buildProjectExecutionSnapshot(
      report,
      'tests/format.test.js',
      'javascript',
    )

    expect(snapshot.includedPaths).toEqual(
      expect.arrayContaining(['package.json', 'tests/format.test.js', 'src/format.js']),
    )
    expect(snapshot.includedPaths).not.toContain('docs/unused.md')
    expect(snapshot.externalImports).toEqual(['node:assert/strict'])
  })

  it('refuses to stage a test whose relative import could not be read', () => {
    const report = createProjectReport({
      paths: ['tests/missing.test.js'],
      files: [
        {
          path: 'tests/missing.test.js',
          content: "import '../src/missing.js'",
          language: 'JavaScript',
          source: 'stored',
        },
      ],
      query: '',
      omitted: [],
      omittedCount: 0,
      totalBytesRead: 30,
    })

    expect(() =>
      buildProjectExecutionSnapshot(report, 'tests/missing.test.js', 'javascript'),
    ).toThrow(/local file was not read/)
  })
})
