import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { parseCookies } from '../auth/cookies.ts'
import { ApiError, forbidden, notFound, unauthorized } from './errors.ts'
import { enforceLimit } from './limits.ts'
import { sendJson, setSecurityHeaders } from './respond.ts'
import type {
  AppContext,
  AuthMode,
  RequestContext,
  RouteHandler,
} from './types.ts'

type Route = {
  method: string
  segments: string[]
  auth: AuthMode
  handler: RouteHandler
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export class Router {
  private routes: Route[] = []

  add(method: string, path: string, auth: AuthMode, handler: RouteHandler): void {
    this.routes.push({
      method,
      segments: path.split('/').filter(Boolean),
      auth,
      handler,
    })
  }

  async handle(
    context: AppContext,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const requestId = randomUUID()
    const startedAt = context.now()
    res.setHeader('X-Request-Id', requestId)
    setSecurityHeaders(res)
    const origin = req.headers.origin

    if (origin && context.config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
      res.setHeader('Access-Control-Max-Age', '600')
    } else if (origin && context.config.allowedOrigins.length > 0) {
      res.setHeader('Vary', 'Origin')
    }

    if (req.method === 'OPTIONS') {
      if (!origin || !context.config.allowedOrigins.includes(origin)) {
        sendJson(res, 403, {
          error: 'forbidden',
          message: 'This origin is not allowed.',
          requestId,
        })
        return
      }
      res.writeHead(204)
      res.end()
      return
    }

    res.once('finish', () => {
      const path = safePath(req.url)
      const status = res.statusCode
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
      console[level](
        JSON.stringify({
          level,
          event: 'http.request',
          requestId,
          method: req.method ?? 'GET',
          path,
          status,
          durationMs: Math.max(0, context.now() - startedAt),
        }),
      )
    })

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const method = req.method ?? 'GET'
      const match = this.match(method, url.pathname)
      if (!match) {
        throw notFound(`No route for ${method} ${url.pathname}.`)
      }

      if (origin && !context.config.allowedOrigins.includes(origin)) {
        throw forbidden('This browser origin is not allowed to call the API.')
      }

      const cookieToken = parseCookies(req.headers.cookie).get(context.config.SESSION_COOKIE_NAME)
      const session = cookieToken ? await context.auth.resolveSession(cookieToken) : null
      const user = session ? await context.store.findUserById(session.userId) : null

      if (match.auth === 'required' && (!user || !session)) {
        throw unauthorized()
      }

      // CSRF defence: cookie-authenticated state changes must come from an
      // allow-listed origin. Missing Origin is acceptable only for anonymous
      // requests, which have no ambient credentials to abuse.
      if (UNSAFE_METHODS.has(method) && user && !origin) {
        throw forbidden('State-changing requests must include an allowed Origin header.')
      }

      const requestContext: RequestContext = {
        ...context,
        req,
        res,
        url,
        requestId,
        params: match.params,
        user,
        session,
        ip: clientIp(req, context.config.TRUST_PROXY),
      }

      enforceLimit(requestContext, 'general', user?.id ?? requestContext.ip)
      await match.handler(requestContext)
    } catch (error) {
      handleError(res, error, requestId)
    }
  }

  private match(
    method: string,
    pathname: string,
  ): { handler: RouteHandler; auth: AuthMode; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean)
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let index = 0; index < route.segments.length; index += 1) {
        const expected = route.segments[index]!
        const actual = parts[index]!
        if (expected.startsWith(':')) {
          try {
            params[expected.slice(1)] = decodeURIComponent(actual)
          } catch {
            throw new ApiError(400, 'invalid_path', 'The request path contains invalid encoding.')
          }
        } else if (expected !== actual) {
          ok = false
          break
        }
      }
      if (ok) {
        return { handler: route.handler, auth: route.auth, params }
      }
    }
    return null
  }
}

function handleError(res: ServerResponse, error: unknown, requestId: string): void {
  if (res.headersSent) {
    // A streaming handler already owns the response.
    if (!res.writableEnded) {
      res.end()
    }
    return
  }

  if (error instanceof ApiError) {
    sendJson(res, error.status, {
      error: error.code,
      message: error.message,
      requestId,
      ...(error.details === undefined ? {} : { details: error.details }),
    })
    return
  }

  console.error(
    JSON.stringify({
      level: 'error',
      event: 'http.request.failure',
      requestId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }),
  )
  sendJson(res, 500, {
    error: 'internal_error',
    message: 'The API could not complete this request.',
    requestId,
  })
}

function safePath(requestUrl: string | undefined): string {
  if (!requestUrl) return '/'
  try {
    return new URL(requestUrl, 'http://localhost').pathname
  } catch {
    return '/'
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for']
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
    if (first) {
      const candidate = first.split(',')[0]?.trim()
      if (candidate) return candidate
    }
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function requireUser(ctx: RequestContext): {
  user: NonNullable<RequestContext['user']>
  session: RequestContext['session']
} {
  if (!ctx.user) {
    throw unauthorized()
  }
  return { user: ctx.user, session: ctx.session }
}

export { notFound }
