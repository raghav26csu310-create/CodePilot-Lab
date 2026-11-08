import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import styles from './markdown.module.css'

type Block =
  | { kind: 'heading'; depth: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; language: string; code: string; open: boolean }
  | { kind: 'table'; header: string[]; rows: string[][] }

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isDivider(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim())
}

function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/)
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const fence = /^(`{3,})([^\s`]*)\s*$/.exec(trimmed)
    if (fence) {
      const marker = fence[1] ?? '```'
      const language = fence[2] ?? ''
      const code: string[] = []
      let closed = false
      index += 1

      while (index < lines.length) {
        const candidate = (lines[index] ?? '').trim()
        if (candidate.startsWith(marker) && candidate.replace(/`/g, '') === '') {
          closed = true
          index += 1
          break
        }
        code.push(lines[index] ?? '')
        index += 1
      }

      blocks.push({
        kind: 'code',
        language,
        code: code.join('\n'),
        open: !closed,
      })
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      blocks.push({
        kind: 'heading',
        depth: heading[1]?.length ?? 1,
        text: heading[2] ?? '',
      })
      index += 1
      continue
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quote.push((lines[index] ?? '').trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', lines: quote })
      continue
    }

    const listMatch = /^([-*+]|\d+\.)\s+/.exec(trimmed)
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1] ?? '')
      const items: string[] = []
      while (index < lines.length) {
        const itemMatch = /^([-*+]|\d+\.)\s+(.*)$/.exec((lines[index] ?? '').trim())
        if (!itemMatch) {
          break
        }
        items.push(itemMatch[2] ?? '')
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (trimmed.includes('|') && isDivider(lines[index + 1] ?? '')) {
      const header = splitRow(trimmed)
      const rows: string[][] = []
      index += 2
      while (index < lines.length) {
        const row = (lines[index] ?? '').trim()
        if (!row || !row.includes('|')) {
          break
        }
        rows.push(splitRow(row))
        index += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    const paragraph: string[] = [trimmed]
    index += 1
    while (index < lines.length) {
      const next = (lines[index] ?? '').trim()
      if (
        !next ||
        next.startsWith('```') ||
        next.startsWith('#') ||
        next.startsWith('>') ||
        /^([-*+]|\d+\.)\s+/.test(next)
      ) {
        break
      }
      paragraph.push(next)
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

const SAFE_LINK = /^https?:\/\//i

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g
  let lastIndex = 0
  let matchIndex = 0

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start))
    }

    const token = match[0]
    const key = `${keyPrefix}-${matchIndex}`
    matchIndex += 1

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      const label = link?.[1] ?? token
      const href = link?.[2] ?? ''
      nodes.push(
        SAFE_LINK.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      )
    }

    lastIndex = start + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function CopyBlockButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className={styles.copyCode}
      onClick={() => {
        void navigator.clipboard
          .writeText(code)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => setCopied(false))
      }}
      aria-label={copied ? 'Code copied' : 'Copy code block'}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)

  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => {
        const key = `block-${index}`

        switch (block.kind) {
          case 'heading': {
            const content = inline(block.text, key)
            return block.depth <= 1 ? (
              <h3 key={key}>{content}</h3>
            ) : block.depth === 2 ? (
              <h4 key={key}>{content}</h4>
            ) : (
              <h5 key={key}>{content}</h5>
            )
          }
          case 'paragraph':
            return <p key={key}>{inline(block.text, key)}</p>
          case 'list':
            return block.ordered ? (
              <ol key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ul>
            )
          case 'quote':
            return (
              <blockquote key={key}>
                {block.lines.map((line, lineIndex) => (
                  <p key={`${key}-${lineIndex}`}>{inline(line, `${key}-${lineIndex}`)}</p>
                ))}
              </blockquote>
            )
          case 'table':
            return (
              <div key={key} className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={`${key}-h-${cellIndex}`}>{inline(cell, `${key}-h-${cellIndex}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}-r-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${key}-r-${rowIndex}-${cellIndex}`}>
                            {inline(cell, `${key}-r-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'code':
            return (
              <div key={key} className={styles.codeBlock} data-open={block.open || undefined}>
                <div className={styles.codeHead}>
                  <span>{block.language || 'code'}</span>
                  <CopyBlockButton code={block.code} />
                </div>
                <pre>
                  <code>{block.code}</code>
                </pre>
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
