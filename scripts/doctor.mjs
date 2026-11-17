import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'

function run(command) {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim()
  } catch (error) {
    return (error.stderr ?? error.stdout ?? String(error)).toString().trim() || 'unavailable'
  }
}

function getNodeInfo() {
  const version = run('node --version')
  const npmVersion = run('npm --version')
  return { version, npmVersion }
}

function hasDependency(name) {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name])
  } catch {
    return false
  }
}

function canBind(port, host) {
  return new Promise((resolve) => {
    const tester = createServer()
    tester.once('error', (error) => {
      resolve(error.code !== 'EADDRINUSE' && error.code !== 'EACCES')
    })
    tester.once('listening', () => tester.close(() => resolve(true)))
    tester.listen(port, host)
  })
}

async function portOpen(port) {
  if (!(await canBind(port, '127.0.0.1'))) {
    return false
  }
  return canBind(port, '::1')
}

async function fetchJson(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return { ok: false, status: response.status, body: await response.text() }
    }
    return { ok: true, status: response.status, body: await response.json() }
  } catch (error) {
    return { ok: false, status: 0, body: String(error) }
  }
}

async function main() {
  console.log('CodePilot Lab doctor')
  console.log('===================')

  const nodeInfo = getNodeInfo()
  console.log(`Node: ${nodeInfo.version}`)
  console.log(`npm: ${nodeInfo.npmVersion}`)

  const packageJsonPath = new URL('../package.json', import.meta.url)
  const hasNodeModules = existsSync(new URL('../node_modules', import.meta.url))
  console.log(`Dependencies installed: ${hasNodeModules ? 'yes' : 'no'}`)

  console.log(`Project file: ${existsSync(packageJsonPath) ? 'present' : 'missing'}`)
  console.log(`Concurrently: ${hasDependency('concurrently') ? 'installed' : 'missing'}`)

  const envIssues = []
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    envIssues.push('CREDENTIAL_ENCRYPTION_KEY not set (development fallback will be ephemeral)')
  }
  if (!process.env.DATABASE_URL) {
    envIssues.push('DATABASE_URL not set (memory-store development mode is active)')
  }
  console.log(`Environment: ${envIssues.length ? envIssues.join('; ') : 'looks usable for local dev'}`)

  const frontendPort = await portOpen(5173)
  const execPort = await portOpen(5310)
  const apiPort = await portOpen(8787)
  console.log(`Frontend port 5173: ${frontendPort ? 'available' : 'in use'}`)
  console.log(`Execution port 5310: ${execPort ? 'available' : 'in use'}`)
  console.log(`API port 8787: ${apiPort ? 'available' : 'in use'}`)

  const frontendHealth = await fetchJson('http://127.0.0.1:5173')
  const execHealth = await fetchJson('http://127.0.0.1:5310/health')
  const apiHealth = await fetchJson('http://127.0.0.1:8787/api/health')

  console.log(`Frontend health: ${frontendHealth.ok ? 'reachable' : 'not reachable'}${frontendHealth.ok ? '' : ` (${frontendHealth.body})`}`)
  console.log(`Execution health: ${execHealth.ok ? 'reachable' : 'not reachable'}${execHealth.ok ? ` (${JSON.stringify(execHealth.body)})` : ` (${execHealth.body})`}`)
  console.log(`API health: ${apiHealth.ok ? 'reachable' : 'not reachable'}${apiHealth.ok ? ` (${JSON.stringify(apiHealth.body)})` : ` (${apiHealth.body})`}`)

  const tools = [
    { name: 'node', command: 'node --version' },
    { name: 'npm', command: 'npm --version' },
    { name: 'tsx', command: 'npx tsx --version' },
    { name: 'vite', command: 'npx vite --version' },
    { name: 'tsc', command: 'npx tsc --version' },
    { name: 'eslint', command: 'npx eslint --version' },
  ]

  console.log('Compiler/tool checks:')
  for (const tool of tools) {
    const output = run(tool.command)
    console.log(`- ${tool.name}: ${output || 'missing'}`)
  }
}

main().catch((error) => {
  console.error('doctor failed:', error)
  process.exitCode = 1
})
