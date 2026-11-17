import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const isWin = process.platform === 'win32'
const processes = []
let shuttingDown = false
let exitCode = 0

function termProcess(name, child) {
  if (!child || !child.pid || child.killed || child.exitCode !== null) return

  try {
    if (isWin) {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL')
        }
      }, 2000).unref()
    }
  } catch {
    // Ignore errors if the process already exited
  }
}

function addProcess(name, command, args, options = {}) {
  const bin = isWin && ['npm', 'npx'].includes(command) ? `${command}.cmd` : command

  const child = spawn(bin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, FORCE_COLOR: '1', ...options.env },
    cwd: options.cwd || process.cwd(),
  })

  processes.push({ name, child })

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString().trimEnd()
    if (text) {
      console.log(`[${name}] ${text.split('\n').join(`\n[${name}] `)}`)
    }
  })

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trimEnd()
    if (text) {
      console.error(`[${name}] ${text.split('\n').join(`\n[${name}] `)}`)
    }
  })

  child.on('error', (error) => {
    console.error(`[${name}] failed to start: ${error.message}`)
    exitCode = 1
    if (!shuttingDown) {
      shutdown()
    }
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }
    const message = `[${name}] exited unexpectedly with code=${code ?? 'null'} signal=${signal ?? 'none'}`
    if (options.optional) {
      console.warn(`${message}. Continuing without optional execution service.`)
      return
    }
    console.error(message)
    exitCode = 1
    shutdown()
  })
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const command = isWin ? 'netstat' : 'ss'
    const args = isWin ? ['-ano'] : ['-lnt']
    const tester = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let output = ''
    tester.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    tester.stderr.on('data', () => {
      // ignore stderr for environment-specific tooling differences
    })

    tester.on('error', () => resolve(false))
    tester.on('exit', (code) => {
      if (code !== 0) {
        resolve(false)
        return
      }
      const portPattern = isWin
        ? new RegExp(`(?:\\]|\\b):${port}\\s`)
        : new RegExp(`:${port}(?:\\s|$)`)
      const match = output.split(/\r?\n/).some((line) => {
        if (isWin && !/\bLISTENING\b/i.test(line)) {
          return false
        }
        return portPattern.test(line)
      })
      resolve(match)
    })
  })
}

async function ensurePortFree(port, label, optional = false) {
  if (await isPortOpen(port)) {
    const message = `[${label}] Port ${port} is already in use.`
    if (optional) {
      console.warn(`${message} Continuing without the optional service.`)
      return false
    }
    console.error(`${message} Stopping startup.`)
    process.exit(1)
  }
  return true
}

async function waitForHealthy(label, url, timeoutMs = 45000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) {
        return true
      }
    } catch {
      // retry until timeout
    }
    await delay(500)
  }
  console.warn(`[${label}] health check timed out at ${url}`)
  return false
}

async function startup() {
  console.log('Starting CodePilot Lab development environment...')
  const frontendReady = await ensurePortFree(5173, 'frontend')
  const apiReady = await ensurePortFree(8787, 'api')
  const executionReady = await ensurePortFree(5310, 'execution', true)

  if (!frontendReady || !apiReady) {
    process.exit(1)
  }

 addProcess('frontend', 'node', ['node_modules/vite/bin/vite.js'], { cwd: process.cwd() })
  if (executionReady) {
    addProcess('execution', 'node', ['server/index.mjs'], {
      cwd: process.cwd(),
      optional: true,
    })
  }
  addProcess('api', 'node', ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/api/src/index.ts'], {
    cwd: process.cwd(),
  })

  await waitForHealthy('frontend', 'http://127.0.0.1:5173', 30000)
  if (executionReady) {
    await waitForHealthy('execution', 'http://127.0.0.1:5310/health', 30000)
  }
  await waitForHealthy('api', 'http://127.0.0.1:8787/api/health', 30000)

  console.log('All required CodePilot Lab services started.')
  console.log('Frontend: http://127.0.0.1:5173')
  console.log(
    executionReady
      ? 'Execution: http://127.0.0.1:5310/health'
      : 'Execution: unavailable (port 5310 already in use; frontend remains usable)',
  )
  console.log('API: http://127.0.0.1:8787/api/health')
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\nShutting down CodePilot Lab services...')
  for (const { name, child } of processes) {
    termProcess(name, child)
  }

  setTimeout(() => {
    process.exit(exitCode)
  }, 500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

startup().catch((error) => {
  console.error('[dev:all] failed to start:', error)
  exitCode = 1
  shutdown()
})
