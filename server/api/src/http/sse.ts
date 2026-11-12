import type { ServerResponse } from 'node:http'

export type SseEvent =
  | { type: 'meta'; mode: 'managed' | 'byo'; provider: string; model: string; label: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; completionChars: number; promptChars: number; latencyMs: number; estimatedTokens: number }
  | { type: 'error'; code: string; message: string }

export function beginSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  })
  res.write(': connected\n\n')
}

export function writeSse(res: ServerResponse, event: SseEvent): void {
  if (res.writableEnded) return
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

export function endSse(res: ServerResponse): void {
  if (res.writableEnded) return
  res.end()
}
