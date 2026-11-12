/**
 * Line diff used by the converter review step.
 *
 * This is a real LCS comparison of the two strings the app actually holds.
 * There is no heuristic "looks converted" state: every row is either unchanged,
 * added, or removed between the source and the converted program.
 */

export type DiffRowKind = 'same' | 'add' | 'remove'

export type DiffRow = {
  kind: DiffRowKind
  text: string
  leftLine: number | null
  rightLine: number | null
}

export type DiffResult =
  | { status: 'ok'; rows: DiffRow[]; added: number; removed: number }
  | { status: 'too-large'; leftLines: number; rightLines: number }

/** Keeps the quadratic table bounded so huge files cannot freeze the UI. */
const MAX_DIFF_LINES = 1400
const MAX_DIFF_CELLS = 1_200_000

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n')
}

export function diffLines(left: string, right: string): DiffResult {
  const leftLines = splitLines(left)
  const rightLines = splitLines(right)

  if (
    leftLines.length > MAX_DIFF_LINES ||
    rightLines.length > MAX_DIFF_LINES ||
    leftLines.length * rightLines.length > MAX_DIFF_CELLS
  ) {
    return { status: 'too-large', leftLines: leftLines.length, rightLines: rightLines.length }
  }

  const rows: DiffRow[] = []
  const n = leftLines.length
  const m = rightLines.length
  // lcs[i][j] = LCS length of leftLines[i:] and rightLines[j:]
  const width = m + 1
  const lcs = new Uint32Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        leftLines[i] === rightLines[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0)
    }
  }

  let i = 0
  let j = 0
  let added = 0
  let removed = 0

  while (i < n && j < m) {
    if (leftLines[i] === rightLines[j]) {
      rows.push({ kind: 'same', text: leftLines[i] ?? '', leftLine: i + 1, rightLine: j + 1 })
      i += 1
      j += 1
    } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      rows.push({ kind: 'remove', text: leftLines[i] ?? '', leftLine: i + 1, rightLine: null })
      removed += 1
      i += 1
    } else {
      rows.push({ kind: 'add', text: rightLines[j] ?? '', leftLine: null, rightLine: j + 1 })
      added += 1
      j += 1
    }
  }

  while (i < n) {
    rows.push({ kind: 'remove', text: leftLines[i] ?? '', leftLine: i + 1, rightLine: null })
    removed += 1
    i += 1
  }
  while (j < m) {
    rows.push({ kind: 'add', text: rightLines[j] ?? '', leftLine: null, rightLine: j + 1 })
    added += 1
    j += 1
  }

  return { status: 'ok', rows, added, removed }
}
