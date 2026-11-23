import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { createServer } from 'node:http'

import { createApp } from '../server/api/src/app.ts'
import {
  buildConfig,
  ConfigurationError,
  loadDotEnv,
} from '../server/api/src/config/env.ts'

loadDotEnv()

if (process.env.PORT && !process.env.API_PORT) {
  process.env.API_PORT = process.env.PORT
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development'
}
if (process.env.API_HOST === undefined) {
  process.env.API_HOST = '0.0.0.0'
}

let config
try {
  config = buildConfig()
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`[production] configuration error: ${error.message}`)
  } else {
    console.error('[production] configuration error:', error)
  }
  process.exit(1)
}
const distDir = resolve(process.cwd(), 'dist')

if (!existsSync(resolve(distDir, 'index.html'))) {
  throw new Error('Production build is missing dist/index.html. Run npm run build before npm start.')
}

const app = await createApp({ config, runMigrationsOnStart: true })

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
}

const server = createServer((req, res) => {
  void serveRequest(req, res)
})

async function serveRequest(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  if (url.pathname.startsWith('/api/')) {
    await app.router.handle(app.context, req, res)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400)
    res.end('Bad Request')
    return
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  let filePath = resolve(distDir, relativePath)
  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = resolve(distDir, 'index.html')
  }

  const contentType = mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', filePath.endsWith('index.html')
    ? 'no-cache'
    : 'public, max-age=31536000, immutable')

  if (req.method === 'HEAD') {
    res.writeHead(200)
    res.end()
    return
  }

  const stream = createReadStream(filePath)
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(404)
    res.end()
  })
  res.writeHead(200)
  stream.pipe(res)
}

try {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(config.API_PORT, config.API_HOST, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    console.error(`[production] Port ${config.API_PORT} is already in use.`)
  } else {
    console.error('[production] failed to start:', error)
  }
  await app.context.store.close()
  process.exitCode = 1
  throw error
}

console.log(
  JSON.stringify({
    level: 'info',
    event: 'production.started',
    service: 'codepilot-lab',
    listen: `http://${config.API_HOST}:${config.API_PORT}`,
    database: app.context.storeKind,
    durable: app.context.storeKind === 'postgresql',
    managedAi: config.managedAi !== null,
  }),
)

let closing = false
async function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(JSON.stringify({ level: 'info', event: 'production.shutdown', signal }))
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  })
  await app.context.store.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
