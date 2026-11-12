import type { ServerResponse } from 'node:http'

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
} as const

export function setSecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(BASE_HEADERS)) {
    res.setHeader(name, value)
  }
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...BASE_HEADERS,
    ...extraHeaders,
  })
  res.end(body)
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, BASE_HEADERS)
  res.end()
}
