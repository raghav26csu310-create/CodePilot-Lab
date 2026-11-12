import { z } from 'zod'

import { readJsonBody } from '../http/body.ts'
import { sendJson } from '../http/respond.ts'
import { requireUser } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { parseWith } from '../http/validate.ts'
import type { SettingsService } from '../services/settingsService.ts'

const SettingsSchema = z.record(z.string(), z.unknown())

export function registerSettingsRoutes(router: Router, settings: SettingsService): void {
  router.add('GET', '/api/settings', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    const record = await settings.get(user.id)
    sendJson(ctx.res, 200, { settings: record.settings, updatedAt: record.updatedAt })
  })

  router.add('PUT', '/api/settings', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    const body = parseWith(SettingsSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    const record = await settings.put(user.id, body)
    sendJson(ctx.res, 200, { settings: record.settings, updatedAt: record.updatedAt })
  })
}
