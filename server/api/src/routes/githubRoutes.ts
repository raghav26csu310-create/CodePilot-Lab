import { describeGithubConfig } from '../github/status.ts'
import { sendJson } from '../http/respond.ts'
import { requireUser } from '../http/router.ts'
import type { Router } from '../http/router.ts'

/**
 * Session-scoped GitHub configuration readout. There is deliberately no
 * connect/install/commit route: those need a registered GitHub App and cannot
 * be verified in this environment. The status route must never expose a
 * credential value, only presence flags and the names of missing variables.
 */
export function registerGithubRoutes(router: Router): void {
  router.add('GET', '/api/github/status', 'required', async (ctx) => {
    requireUser(ctx)
    sendJson(ctx.res, 200, {
      ...describeGithubConfig(ctx.config),
      checkedAt: new Date(ctx.now()).toISOString(),
    })
  })
}
