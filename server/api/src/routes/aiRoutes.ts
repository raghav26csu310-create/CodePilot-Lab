import { z } from 'zod'

import { ProviderError } from '../ai/providers.ts'
import { readJsonBody } from '../http/body.ts'
import { ApiError } from '../http/errors.ts'
import { enforceLimit } from '../http/limits.ts'
import { sendJson } from '../http/respond.ts'
import { requireUser } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { beginSse, endSse, writeSse } from '../http/sse.ts'
import { parseWith } from '../http/validate.ts'
import type { ChatMessage } from '../ai/providers.ts'

const ConnectionSchema = z.object({
  provider: z.enum(['ollama', 'deepseek', 'openai-compatible']),
  label: z.string().max(80).optional(),
  baseUrl: z.string().min(1).max(2_000),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(8_000).optional(),
})

const TestSchema = z.object({
  mode: z.enum(['managed', 'byo']).optional(),
  provider: z.enum(['ollama', 'deepseek', 'openai-compatible']).optional(),
  label: z.string().max(80).optional(),
  baseUrl: z.string().max(2_000).optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(8_000).optional(),
})

const ModeSchema = z.object({
  mode: z.enum(['managed', 'byo']),
})

const ChatSchema = z.object({
  mode: z.enum(['managed', 'byo']).optional(),
  model: z.string().max(200).optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  maxTokens: z.number().int().min(64).max(16_384).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1)
    .max(200),
})

export function registerAiRoutes(router: Router): void {
  router.add('GET', '/api/ai/status', 'required', async (ctx) => {
    const status = await ctx.ai.getStatus(ctx.user!.id)
    sendJson(ctx.res, 200, { status })
  })

  router.add('GET', '/api/ai/usage', 'required', async (ctx) => {
    const status = await ctx.ai.getStatus(ctx.user!.id)
    sendJson(ctx.res, 200, {
      usage: status.usage,
      quota: status.quota,
      note: status.usageNote,
    })
  })

  router.add('POST', '/api/ai/mode', 'required', async (ctx) => {
    const body = parseWith(ModeSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    await ctx.ai.setPreferredMode(ctx.user!.id, body.mode)
    const status = await ctx.ai.getStatus(ctx.user!.id)
    sendJson(ctx.res, 200, { status })
  })

  router.add('PUT', '/api/ai/connection', 'required', async (ctx) => {
    const body = parseWith(ConnectionSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    // The key is accepted here and written straight into the encrypted store.
    // It is never echoed, logged, or persisted anywhere in the browser bundle.
    const connection = await ctx.ai.saveConnection(ctx.user!.id, body)
    const status = await ctx.ai.getStatus(ctx.user!.id)
    sendJson(ctx.res, 200, { connection, status })
  })

  router.add('DELETE', '/api/ai/connection', 'required', async (ctx) => {
    await ctx.ai.deleteConnection(ctx.user!.id)
    const status = await ctx.ai.getStatus(ctx.user!.id)
    sendJson(ctx.res, 200, { status })
  })

  router.add('POST', '/api/ai/connection/test', 'required', async (ctx) => {
    enforceLimit(ctx, 'connectionTest', ctx.user!.id)
    const body = parseWith(TestSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    const result = await ctx.ai.testConnection(ctx.user!.id, body)
    sendJson(ctx.res, 200, { result })
  })

  router.add('POST', '/api/ai/chat', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    enforceLimit(ctx, 'chat', user.id)
    const body = parseWith(ChatSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    const controller = new AbortController()
    let closed = false

    ctx.res.on('close', () => {
      closed = true
      controller.abort()
    })

    beginSse(ctx.res)

    try {
      await ctx.ai.chat(
        user.id,
        {
          mode: body.mode,
          messages: body.messages as ChatMessage[],
          model: body.model,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
        },
        {
          signal: controller.signal,
          onEvent: (event) => writeSse(ctx.res, event),
        },
      )
    } catch (error) {
      if (!closed) {
        const failure = describeFailure(error, ctx.requestId)
        writeSse(ctx.res, { type: 'error', code: failure.code, message: failure.message })
      }
    } finally {
      endSse(ctx.res)
    }
  })
}

function describeFailure(error: unknown, requestId?: string): { code: string; message: string } {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'aborted', message: 'The request was cancelled.' }
  }
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'ai.request.failure',
      requestId: requestId ?? null,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }),
  )
  return {
    code: 'internal_error',
    message: 'The AI request failed before it could answer. Check the API console.',
  }
}

/** Exported for route-level tests that exercise SSE formatting without a socket. */
export function sseFailure(error: unknown): { code: string; message: string } {
  return describeFailure(error)
}
