/**
 * CodePilot Lab — local execution service.
 *
 * Loopback-only HTTP bridge between the Vite SPA and the real compilers and
 * interpreters installed on this machine. It is not a public service and it
 * is not a hardened sandbox: it applies timeouts, temp-dir isolation, output
 * caps and process-tree kills, then tells the user exactly that in the UI.
 *
 *   npm run exec          # http://127.0.0.1:5310
 */

import { createServer } from 'node:http'

import {
  LIMITS,
  cancelAllJobs,
  cancelJob,
  detectRuntimes,
  gradeSubmission,
  healthReport,
  runCode,
  traceCode,
} from './executor.mjs'
import { PROBLEM_IDS, PROBLEM_SETS } from './problems.mjs'
import { createGithubBridge } from './githubBridge.mjs'
import { createTerminalHub } from './terminal.mjs'

const PORT = Number(process.env.EXEC_PORT || 5310)
const HOST = process.env.EXEC_HOST || '127.0.0.1'
const MAX_BODY_BYTES = 2_000_000

/**
 * Public-beta hardening. The runner is a local developer tool, not a sandbox:
 * it stays bound to loopback unless the operator explicitly opts into a remote
 * bind, and a remote bind additionally requires a bearer token. Nothing here
 * makes untrusted public execution safe — see docs/security.md.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const REMOTE_ENABLED = process.env.EXEC_ALLOW_REMOTE === '1'
const REMOTE_TOKEN = (process.env.EXEC_TOKEN || '').trim()

const parsedConcurrency = Number(process.env.EXEC_MAX_CONCURRENCY || 2)
const MAX_CONCURRENT_EXECUTIONS = Number.isFinite(parsedConcurrency)
  ? Math.min(4, Math.max(1, Math.trunc(parsedConcurrency)))
  : 2

let activeExecutions = 0

const ALLOWED_ORIGINS = new Set(
  (process.env.EXEC_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== '*'),
)

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(host)
}

/**
 * The terminal is a real shell, so it needs its own gate on top of the loopback
 * bind: an allow-listed Origin plus a per-start pairing token that never leaves
 * the service console until the operator pastes it into the UI.
 */
const terminal = createTerminalHub({ origins: ALLOWED_ORIGINS })
const githubBridge = createGithubBridge({
  pairingToken: terminal.describe().token,
  origins: ALLOWED_ORIGINS,
  readJsonBody,
  sendJson,
})

function authorized(request) {
  if (isLoopbackHost(HOST)) {
    return true
  }
  if (!REMOTE_TOKEN) {
    return false
  }
  const header = request.headers.authorization ?? ''
  return header === `Bearer ${REMOTE_TOKEN}`
}

function applyCors(request, response) {
  const origin = request.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CodePilot-Pairing')
  response.setHeader('Access-Control-Max-Age', '600')
  // Chrome Private Network Access preflights loopback requests from a public
  // HTTPS page. Only answer when the calling origin is explicitly allowed.
  if (
    origin &&
    ALLOWED_ORIGINS.has(origin) &&
    request.headers['access-control-request-private-network'] === 'true'
  ) {
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  response.end(body)
}

/** Runs one execution request at a time within the configured concurrency cap. */
async function withExecutionSlot(response, work) {
  if (activeExecutions >= MAX_CONCURRENT_EXECUTIONS) {
    sendJson(response, 429, {
      error: 'busy',
      message: `The local runner is already executing ${activeExecutions} job(s). Wait for one to finish or stop it before trying again.`,
    })
    return
  }

  activeExecutions += 1
  try {
    await work()
  } finally {
    activeExecutions -= 1
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body exceeds 2 MB.'), { statusCode: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('error', reject)
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('The request body is not valid JSON.'), { statusCode: 400 }))
      }
    })
  })
}

const server = createServer(async (request, response) => {
  applyCors(request, response)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? HOST}`)

  if (!authorized(request)) {
    sendJson(response, 401, {
      error: 'unauthorized',
      message: 'This runner is bound to a non-loopback address and requires a bearer token.',
    })
    return
  }

  try {
    if (await githubBridge.handle(request, response, url)) {
      return
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, await healthReport())
      return
    }

    if (request.method === 'GET' && url.pathname === '/terminal/health') {
      sendJson(response, 200, terminal.health())
      return
    }

    if (request.method === 'GET' && url.pathname === '/problems') {
      sendJson(response, 200, {
        problems: PROBLEM_IDS.map((id) => ({
          id,
          supported: PROBLEM_SETS[id].supported,
          cases: PROBLEM_SETS[id].tests.length,
        })),
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/run') {
      const body = await readJsonBody(request)
      await withExecutionSlot(response, async () => {
        sendJson(response, 200, await runCode(body))
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/trace') {
      const body = await readJsonBody(request)
      await withExecutionSlot(response, async () => {
        sendJson(response, 200, await traceCode(body))
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/grade') {
      const body = await readJsonBody(request)
      await withExecutionSlot(response, async () => {
        sendJson(response, 200, await gradeSubmission(body, PROBLEM_SETS))
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/cancel') {
      const body = await readJsonBody(request)
      sendJson(response, 200, cancelJob(body.jobId))
      return
    }

    sendJson(response, 404, {
      error: 'not_found',
      message: `No route for ${request.method} ${url.pathname}.`,
    })
  } catch (error) {
    const status = Number(error?.statusCode) || 500
    if (status >= 500) {
      // Never echo unexpected internals (paths, stack frames, command lines) to
      // the caller. The operator sees the real error on the server console.
      console.error('[exec] unexpected request failure:', error)
      sendJson(response, 500, {
        error: 'internal_error',
        message: 'The local execution service failed before it could answer. Check its console.',
      })
      return
    }
    sendJson(response, status, {
      error: status === 404 ? 'not_found' : 'invalid_request',
      message: error instanceof Error ? error.message : 'The request was rejected.',
    })
  }
})

if (!isLoopbackHost(HOST)) {
  if (!REMOTE_ENABLED) {
    console.error(
      `Refusing to bind to ${HOST}: the local runner is loopback-only. Set EXEC_ALLOW_REMOTE=1 and EXEC_TOKEN to override, and read docs/security.md first.`,
    )
    process.exit(1)
  }
  if (!REMOTE_TOKEN) {
    console.error('EXEC_ALLOW_REMOTE=1 requires EXEC_TOKEN so the runner is not open to the network.')
    process.exit(1)
  }
}

server.listen(PORT, HOST, async () => {
  const runtimes = await detectRuntimes(true)
  const terminalInfo = terminal.describe()
  const lines = [
    `CodePilot execution service · http://${HOST}:${PORT}`,
    `CORS origins: ${[...ALLOWED_ORIGINS].join(', ') || '(none)'}`,
    `Concurrency: ${MAX_CONCURRENT_EXECUTIONS} · auth: ${isLoopbackHost(HOST) ? 'loopback only' : REMOTE_TOKEN ? 'bearer token required' : 'disabled'}`,
    `Limits: compile ${LIMITS.compileTimeoutMs} ms · run ${LIMITS.runTimeoutMs} ms · ${LIMITS.maxStdoutChars} stdout chars`,
  ]
  for (const [key, value] of Object.entries(runtimes)) {
    lines.push(`  ${key.padEnd(6)} ${value.ok ? value.version : 'not available'}`)
  }
  lines.push(
    `Terminal: ${terminalInfo.shell} · cwd ${terminalInfo.cwd} · ${terminalInfo.generated ? 'generated' : 'env'} pairing token`,
  )
  lines.push(`  pairing token: ${terminalInfo.token}`)
  lines.push('Resource-limited local runner — not a security boundary.')
  lines.push('Terminal: real local shell for this machine, not a sandbox and not cloud isolation.')
  console.log(lines.join('\n'))
})

terminal.attach(server)

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set EXEC_PORT to another port.`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cancelAllJobs()
    githubBridge.closeAll()
    terminal.closeAll()
    server.close(() => process.exit(0))
    // Do not leave a hung keep-alive connection holding the process open.
    setTimeout(() => process.exit(0), 3_000).unref()
  })
}
