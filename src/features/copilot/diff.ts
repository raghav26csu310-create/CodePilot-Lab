export type DiffRowKind = 'equal' | 'add' | 'remove' | 'change'

export type DiffSide = {
  line: number
  text: string
}

export type DiffRow = {
  kind: DiffRowKind
  left: DiffSide | null
  right: DiffSide | null
}

export type DiffResult = {
  rows: DiffRow[]
  additions: number
  deletions: number
  /** True when very large files were compared over the first N lines only. */
  truncated: boolean
}

const MAX_DIFF_LINES = 1200

type Op =
  | { kind: 'equal'; text: string }
  | { kind: 'insert'; text: string }
  | { kind: 'delete'; text: string }

/**
 * Myers line diff. Common prefix/suffix are trimmed first, which keeps the
 * search small for the typical "one function changed" case.
 */
function myersDiff(before: string[], after: string[]): Op[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1
  }

  let endBefore = before.length
  let endAfter = after.length
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1
    endAfter -= 1
  }

  const a = before.slice(start, endBefore)
  const b = after.slice(start, endAfter)
  const prefix: Op[] = before.slice(0, start).map((text) => ({ kind: 'equal', text }))
  const suffix: Op[] = before.slice(endBefore).map((text) => ({ kind: 'equal', text }))

  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) {
    return [...prefix, ...suffix]
  }
  if (n === 0) {
    return [...prefix, ...b.map((text): Op => ({ kind: 'insert', text })), ...suffix]
  }
  if (m === 0) {
    return [...prefix, ...a.map((text): Op => ({ kind: 'delete', text })), ...suffix]
  }

  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let foundD = 0

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) {
        x = v[offset + k + 1] ?? 0
      } else {
        x = (v[offset + k - 1] ?? 0) + 1
      }

      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        foundD = d
        break
      }
    }
    if ((v[offset + n - m] ?? 0) >= n) {
      break
    }
  }

  const ops: Op[] = []
  let x = n
  let y = m

  for (let d = foundD; d >= 0; d -= 1) {
    const previous = trace[d]
    if (!previous) {
      break
    }
    const k = x - y
    const prevK =
      k === -d || (k !== d && (previous[offset + k - 1] ?? 0) < (previous[offset + k + 1] ?? 0))
        ? k + 1
        : k - 1
    const prevX = previous[offset + prevK] ?? 0
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      x -= 1
      y -= 1
      ops.push({ kind: 'equal', text: a[x] ?? '' })
    }

    if (d > 0) {
      if (x === prevX) {
        y -= 1
        ops.push({ kind: 'insert', text: b[y] ?? '' })
      } else {
        x -= 1
        ops.push({ kind: 'delete', text: a[x] ?? '' })
      }
    }
  }

  ops.reverse()
  return [...prefix, ...ops, ...suffix]
}

function toRows(ops: Op[]): DiffRow[] {
  const rows: DiffRow[] = []
  let leftLine = 1
  let rightLine = 1
  let index = 0

  while (index < ops.length) {
    const op = ops[index]
    if (!op) {
      break
    }

    if (op.kind === 'equal') {
      rows.push({
        kind: 'equal',
        left: { line: leftLine, text: op.text },
        right: { line: rightLine, text: op.text },
      })
      leftLine += 1
      rightLine += 1
      index += 1
      continue
    }

    if (op.kind === 'delete') {
      const removed: string[] = []
      while (index < ops.length && ops[index]?.kind === 'delete') {
        removed.push(ops[index]?.text ?? '')
        index += 1
      }
      const added: string[] = []
      while (index < ops.length && ops[index]?.kind === 'insert') {
        added.push(ops[index]?.text ?? '')
        index += 1
      }

      const paired = Math.min(removed.length, added.length)
      for (let offset = 0; offset < paired; offset += 1) {
        rows.push({
          kind: 'change',
          left: { line: leftLine, text: removed[offset] ?? '' },
          right: { line: rightLine, text: added[offset] ?? '' },
        })
        leftLine += 1
        rightLine += 1
      }
      for (let offset = paired; offset < removed.length; offset += 1) {
        rows.push({
          kind: 'remove',
          left: { line: leftLine, text: removed[offset] ?? '' },
          right: null,
        })
        leftLine += 1
      }
      for (let offset = paired; offset < added.length; offset += 1) {
        rows.push({
          kind: 'add',
          left: null,
          right: { line: rightLine, text: added[offset] ?? '' },
        })
        rightLine += 1
      }
      continue
    }

    rows.push({
      kind: 'add',
      left: null,
      right: { line: rightLine, text: op.text },
    })
    rightLine += 1
    index += 1
  }

  return rows
}

export function computeDiff(beforeText: string, afterText: string): DiffResult {
  let before = beforeText.split(/\r?\n/)
  let after = afterText.split(/\r?\n/)

  // A trailing newline is not a meaningful extra line for review.
  if (before.length > 1 && before[before.length - 1] === '') {
    before = before.slice(0, -1)
  }
  if (after.length > 1 && after[after.length - 1] === '') {
    after = after.slice(0, -1)
  }

  const truncated = before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES
  if (truncated) {
    before = before.slice(0, MAX_DIFF_LINES)
    after = after.slice(0, MAX_DIFF_LINES)
  }

  const rows = toRows(myersDiff(before, after))
  const additions = rows.filter((row) => row.kind === 'add' || row.kind === 'change').length
  const deletions = rows.filter((row) => row.kind === 'remove' || row.kind === 'change').length

  return { rows, additions, deletions, truncated }
}
