import { z } from 'zod'

import { readJsonBody } from '../http/body.ts'
import { enforceLimit } from '../http/limits.ts'
import { sendJson } from '../http/respond.ts'
import type { Router } from '../http/router.ts'
import { parseWith } from '../http/validate.ts'

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).optional(),
  language: z.string().max(32).optional(),
})

const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2_000).optional(),
    language: z.string().max(32).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')

const PutFileSchema = z.object({
  path: z.string().min(1).max(400),
  kind: z.enum(['file', 'folder']).optional(),
  content: z.string().max(1_000_000).optional(),
})

export function registerProjectRoutes(router: Router): void {
  router.add('GET', '/api/projects', 'required', async (ctx) => {
    enforceLimit(ctx, 'general', ctx.user!.id)
    const projects = await ctx.projects.list(ctx.user!.id)
    sendJson(ctx.res, 200, { projects })
  })

  router.add('POST', '/api/projects', 'required', async (ctx) => {
    const body = parseWith(CreateProjectSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    const project = await ctx.projects.create(ctx.user!.id, body)
    sendJson(ctx.res, 201, { project })
  })

  router.add('GET', '/api/projects/:projectId', 'required', async (ctx) => {
    const project = await ctx.projects.get(ctx.user!.id, ctx.params.projectId ?? '')
    sendJson(ctx.res, 200, { project })
  })

  router.add('PATCH', '/api/projects/:projectId', 'required', async (ctx) => {
    const body = parseWith(UpdateProjectSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    const project = await ctx.projects.update(ctx.user!.id, ctx.params.projectId ?? '', body)
    sendJson(ctx.res, 200, { project })
  })

  router.add('DELETE', '/api/projects/:projectId', 'required', async (ctx) => {
    await ctx.projects.remove(ctx.user!.id, ctx.params.projectId ?? '')
    sendJson(ctx.res, 200, { ok: true })
  })

  router.add('GET', '/api/projects/:projectId/files', 'required', async (ctx) => {
    const files = await ctx.projects.listFiles(ctx.user!.id, ctx.params.projectId ?? '')
    sendJson(ctx.res, 200, { files })
  })

  router.add('POST', '/api/projects/:projectId/files', 'required', async (ctx) => {
    const body = parseWith(PutFileSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    const file = await ctx.projects.putFile(ctx.user!.id, ctx.params.projectId ?? '', body)
    sendJson(ctx.res, 200, { file })
  })

  router.add(
    'DELETE',
    '/api/projects/:projectId/files/:fileId',
    'required',
    async (ctx) => {
      await ctx.projects.deleteFile(
        ctx.user!.id,
        ctx.params.projectId ?? '',
        ctx.params.fileId ?? '',
      )
      sendJson(ctx.res, 200, { ok: true })
    },
  )
}
