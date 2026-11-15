import { z } from 'zod'

import { toPublicUser } from '../auth/authService.ts'
import { clearSessionCookie, parseCookies, serializeSessionCookie } from '../auth/cookies.ts'
import { emailRateKey } from '../auth/authService.ts'
import { buildAccountExport } from '../services/accountExport.ts'
import { readJsonBody } from '../http/body.ts'
import { unauthorized } from '../http/errors.ts'
import { enforceLimit } from '../http/limits.ts'
import { requireUser } from '../http/router.ts'
import { sendJson } from '../http/respond.ts'
import type { RequestContext } from '../http/types.ts'
import { parseWith } from '../http/validate.ts'
import type { Router } from '../http/router.ts'

const Email = z
  .string()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.')

const RegisterSchema = z.object({
  email: Email,
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(80),
})

const LoginSchema = z.object({
  email: Email,
  password: z.string().min(1).max(200),
})

const ProfileSchema = z.object({
  displayName: z.string().min(1).max(80),
})

const PasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  nextPassword: z.string().min(10).max(200),
})

const DeleteSchema = z.object({
  password: z.string().min(1).max(200),
})

function setSessionCookie(ctx: RequestContext, token: string, maxAgeSeconds: number): void {
  ctx.res.setHeader(
    'Set-Cookie',
    serializeSessionCookie(ctx.config.SESSION_COOKIE_NAME, token, {
      maxAgeSeconds,
      secure: ctx.config.SESSION_COOKIE_SECURE,
    }),
  )
}

export function registerAuthRoutes(router: Router): void {
  router.add('POST', '/api/auth/register', 'public', async (ctx) => {
    enforceLimit(ctx, 'register', ctx.ip)
    const body = parseWith(RegisterSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    const result = await ctx.auth.register(body)
    setSessionCookie(ctx, result.token, Math.floor((result.expiresAt - ctx.now()) / 1000))
    sendJson(ctx.res, 201, { user: result.user, expiresAt: result.expiresAt })
  })

  router.add('POST', '/api/auth/login', 'public', async (ctx) => {
    const body = parseWith(LoginSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    enforceLimit(ctx, 'login', `${ctx.ip}:${emailRateKey(body.email)}`)
    const result = await ctx.auth.login(body.email, body.password)
    setSessionCookie(ctx, result.token, Math.floor((result.expiresAt - ctx.now()) / 1000))
    sendJson(ctx.res, 200, { user: result.user, expiresAt: result.expiresAt })
  })

  router.add('POST', '/api/auth/logout', 'required', async (ctx) => {
    const token = parseCookies(ctx.req.headers.cookie).get(ctx.config.SESSION_COOKIE_NAME)
    if (token) {
      await ctx.auth.logout(token)
    }
    ctx.res.setHeader(
      'Set-Cookie',
      clearSessionCookie(ctx.config.SESSION_COOKIE_NAME, ctx.config.SESSION_COOKIE_SECURE),
    )
    sendJson(ctx.res, 200, { ok: true })
  })

  router.add('GET', '/api/auth/session', 'optional', async (ctx) => {
    sendJson(ctx.res, 200, {
      user: ctx.user ? toPublicUser(ctx.user) : null,
      expiresAt: ctx.session?.expiresAt ?? null,
      managedAiAvailable: ctx.config.managedAi !== null,
    })
  })

  router.add('GET', '/api/account', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    sendJson(ctx.res, 200, { user: toPublicUser(user) })
  })

  router.add('GET', '/api/account/export', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    const payload = await buildAccountExport({
      store: ctx.store,
      ai: ctx.ai,
      user: toPublicUser(user),
      now: ctx.now(),
    })
    sendJson(ctx.res, 200, payload, {
      'Content-Disposition': `attachment; filename="codepilot-account-${user.id}.json"`,
    })
  })

  router.add('GET', '/api/account/sessions', 'required', async (ctx) => {
    const { user, session } = requireUser(ctx)
    const sessions = await ctx.auth.listSessions(user.id)
    sendJson(ctx.res, 200, {
      currentSessionId: session?.id ?? null,
      sessions,
    })
  })

  router.add('DELETE', '/api/account/sessions/:sessionId', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    enforceLimit(ctx, 'general', `sessions:${user.id}`)
    const sessionId = ctx.params.sessionId ?? ''
    await ctx.auth.revokeSession(user.id, sessionId)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.add('POST', '/api/account/sessions/revoke-others', 'required', async (ctx) => {
    const { user, session } = requireUser(ctx)
    enforceLimit(ctx, 'general', `sessions:${user.id}`)
    if (!session) throw unauthorized('Sign in again to manage sessions.')
    const revoked = await ctx.auth.revokeOtherSessions(user.id, session.id)
    sendJson(ctx.res, 200, { ok: true, revoked })
  })

  router.add('PATCH', '/api/account', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    const body = parseWith(ProfileSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    const updated = await ctx.auth.updateProfile(user.id, body.displayName)
    sendJson(ctx.res, 200, { user: updated })
  })

  router.add('POST', '/api/account/password', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    const body = parseWith(PasswordSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    await ctx.auth.changePassword(user.id, body.currentPassword, body.nextPassword)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.add('DELETE', '/api/account', 'required', async (ctx) => {
    const { user } = requireUser(ctx)
    const body = parseWith(DeleteSchema, await readJsonBody(ctx.req, ctx.config.MAX_BODY_BYTES))
    await ctx.auth.deleteAccount(user.id, body.password)
    ctx.res.setHeader(
      'Set-Cookie',
      clearSessionCookie(ctx.config.SESSION_COOKIE_NAME, ctx.config.SESSION_COOKIE_SECURE),
    )
    sendJson(ctx.res, 200, { ok: true })
  })
}
