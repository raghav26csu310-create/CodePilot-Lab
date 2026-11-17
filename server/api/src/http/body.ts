import type { IncomingMessage } from 'node:http'

import { ApiError, badRequest } from './errors.ts'

/**
 * Reads a JSON body with a hard byte cap. The stream is destroyed as soon as
 * the cap is exceeded so a large payload cannot be buffered indefinitely.
 */
export async function readJsonBody<T = unknown>(
  req: IncomingMessage,
  maxBytes: number,
): Promise<T> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', 'Send this request with Content-Type: application/json.')
  }

  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      throw new ApiError(413, 'payload_too_large', `The request body exceeds ${maxBytes} bytes.`)
    }
    chunks.push(buffer)
  }

  if (chunks.length === 0) {
    throw badRequest('A JSON request body is required.')
  }

  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as T
  } catch {
    throw badRequest('The request body is not valid JSON.')
  }
}
