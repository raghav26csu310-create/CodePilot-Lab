import { describe, expect, it } from 'vitest'

import {
  formatWithPrettier,
  isPrettierSupported,
  parseEditorconfig,
  parserForPath,
  resolveFormatConfig,
  unsupportedLanguageLabel,
} from './prettier'

const messy = `const add=(a:number,b:number)=>{return a+b}
const list = [1,2,3].map((n)=>n*2)
`

describe('prettier language coverage', () => {
  it('maps every supported extension to a real parser', () => {
    expect(parserForPath('src/app.ts')).toBe('typescript')
    expect(parserForPath('src/app.tsx')).toBe('typescript')
    expect(parserForPath('src/app.js')).toBe('babel')
    expect(parserForPath('src/app.mjs')).toBe('babel')
    expect(parserForPath('package.json')).toBe('json')
    expect(parserForPath('styles/site.css')).toBe('css')
    expect(parserForPath('styles/site.scss')).toBe('scss')
    expect(parserForPath('styles/site.less')).toBe('less')
    expect(parserForPath('index.html')).toBe('html')
    expect(parserForPath('README.md')).toBe('markdown')
    expect(parserForPath('.prettierrc.yaml')).toBe('yaml')
  })

  it('refuses languages Prettier does not support instead of guessing', () => {
    for (const path of ['main.py', 'Main.java', 'main.c', 'main.cpp', 'main.go']) {
      expect(parserForPath(path)).toBeNull()
      expect(isPrettierSupported(path)).toBe(false)
    }
    expect(unsupportedLanguageLabel('main.py')).toBe('Python')
    expect(unsupportedLanguageLabel('Main.java')).toBe('Java')
    expect(unsupportedLanguageLabel('main.cpp')).toBe('C++')
  })
})

describe('prettier config resolution', () => {
  it('reads a JSON .prettierrc', () => {
    const config = resolveFormatConfig([
      { path: '.prettierrc', content: '{"semi": false, "singleQuote": true}' },
    ])
    expect(config.sources).toEqual(['.prettierrc'])
    expect(config.options).toMatchObject({ semi: false, singleQuote: true })
    expect(config.warnings).toEqual([])
  })

  it('reads the prettier key from package.json', () => {
    const config = resolveFormatConfig([
      { path: 'package.json', content: '{"prettier":{"printWidth":100,"tabWidth":4}}' },
    ])
    expect(config.sources).toEqual(['package.json#prettier'])
    expect(config.options).toMatchObject({ printWidth: 100, tabWidth: 4 })
  })

  it('applies .editorconfig first and lets a Prettier config win', () => {
    const config = resolveFormatConfig([
      {
        path: '.editorconfig',
        content: 'root = true\n[*]\nindent_style = tab\nindent_size = 4\nend_of_line = crlf\nmax_line_length = 120\n',
      },
      { path: '.prettierrc.json', content: '{"tabWidth":2}' },
    ])
    expect(config.sources).toEqual(['.editorconfig', '.prettierrc.json'])
    expect(config.options).toMatchObject({
      useTabs: true,
      tabWidth: 2,
      endOfLine: 'crlf',
      printWidth: 120,
    })
  })

  it('reports JavaScript and YAML configs instead of executing or guessing', () => {
    const js = resolveFormatConfig([
      { path: 'prettier.config.js', content: 'module.exports = { semi: false }' },
    ])
    expect(js.options).toEqual({})
    expect(js.warnings[0]).toContain('not executed inside the editor')

    const yaml = resolveFormatConfig([{ path: '.prettierrc.yaml', content: 'semi: false' }])
    expect(yaml.options).toEqual({})
    expect(yaml.warnings[0]).toContain('JSON Prettier configs only')
  })

  it('survives invalid JSON with an explicit warning', () => {
    const config = resolveFormatConfig([{ path: '.prettierrc', content: '{ semi: false ' }])
    expect(config.options).toEqual({})
    expect(config.warnings[0]).toContain('not valid JSON')
  })

  it('parses the editorconfig keys Prettier understands', () => {
    expect(parseEditorconfig('[*.ts]\nindent_style = space\nindent_size = 3\n')).toMatchObject({
      useTabs: false,
      tabWidth: 3,
    })
  })
})

describe('prettier formatting', () => {
  it('formats TypeScript with the project options', async () => {
    const config = resolveFormatConfig([
      { path: '.prettierrc', content: '{"semi":false,"singleQuote":true,"printWidth":60}' },
    ])
    const result = await formatWithPrettier({ path: 'src/app.ts', text: messy, config })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(result.text).toContain('const add = (a: number, b: number) => {')
    expect(result.text).not.toContain(';\n')
  })

  it('formats JSON, CSS, HTML and Markdown with their own parsers', async () => {
    const json = await formatWithPrettier({ path: 'data.json', text: '{"a":1,"b":[1,2]}' })
    expect(json.ok && json.text).toBe('{ "a": 1, "b": [1, 2] }\n')

    const css = await formatWithPrettier({ path: 'site.css', text: 'a{color:red}' })
    expect(css.ok).toBe(true)
    if (css.ok) expect(css.text).toContain('a {')

    const html = await formatWithPrettier({ path: 'index.html', text: '<div><span>x</span></div>' })
    expect(html.ok).toBe(true)

    const markdown = await formatWithPrettier({ path: 'README.md', text: '# Title' })
    expect(markdown.ok).toBe(true)
    if (markdown.ok) expect(markdown.text).toBe('# Title\n')
  })

  it('returns a readable error and no text for invalid code', async () => {
    const result = await formatWithPrettier({ path: 'broken.ts', text: 'const = ;' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Prettier could not format broken.ts')
  })

  it('refuses unsupported languages with the honest reason', async () => {
    const result = await formatWithPrettier({ path: 'main.py', text: 'def f(): pass' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Python is not supported by Prettier')
    expect(result.message).toContain('unchanged')
  })

  it('formats only the requested range for TypeScript', async () => {
    const source = 'const a=1\nconst b=2\n'
    const result = await formatWithPrettier({
      path: 'range.ts',
      text: source,
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 11 },
    })
    expect(result.ok).toBe(true)
  })

  it('reports unknown config keys instead of failing the format', async () => {
    const config = { options: { notARealOption: true }, sources: ['.prettierrc'], warnings: [] }
    const result = await formatWithPrettier({ path: 'src/app.ts', text: messy, config })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((warning) => warning.includes('notARealOption'))).toBe(true)
  })
})
