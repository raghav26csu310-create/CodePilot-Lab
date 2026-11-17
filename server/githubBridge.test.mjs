import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createGithubBridge } from './githubBridge.mjs'

const origin = 'http://localhost:5173'
let root = ''
let server
let endpoint = ''
let lastGhEnv
let lastGhArgs

function commandRunner(command, args, options = {}) {
  if (command === 'gh') {
    lastGhEnv = options.env
    lastGhArgs = args
    if (args[0] === '--version') {
      return Promise.resolve({ code: 0, stdout: 'gh version test', stderr: '' })
    }
    if (args[0] === 'auth' && options.env.GH_TEST_AUTH === '1') {
      return Promise.resolve({ code: 0, stdout: 'authenticated', stderr: '' })
    }
    if (args[0] === 'auth') {
      return Promise.resolve({ code: 1, stdout: '', stderr: 'not logged in' })
    }
    if (args[0] === 'api') {
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ login: 'test-user', name: 'Test User', avatarUrl: null, url: 'https://github.com/test-user' }),
        stderr: '',
      })
    }
    if (args[0] === 'repo' && args[1] === 'list') {
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify([{
          nameWithOwner: 'test-user/private-repository',
          name: 'private-repository',
          description: 'private code',
          isPrivate: true,
          url: 'https://github.com/test-user/private-repository',
          defaultBranchRef: { name: 'main' },
        }]),
        stderr: '',
      })
    }
    if (args[0] === 'repo' && (args[1] === 'create' || args[1] === 'clone')) {
      return Promise.resolve({ code: 0, stdout: 'completed', stderr: '' })
    }
    if (args[0] === 'search' && args[1] === 'repos') {
      return Promise.resolve({ code: 0, stdout: '[]', stderr: '' })
    }
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
  })
  if (result.error) return Promise.reject(result.error)
  return Promise.resolve({
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  })
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function request(pathname, body, headers = {}) {
  return fetch(`${endpoint}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      'X-CodePilot-Pairing': 'test-pairing',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('local GitHub bridge', () => {
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'codepilot-git-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'CodePilot Test'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
    await writeFile(path.join(root, 'README.md'), 'initial\n')
    execFileSync('git', ['add', '--', 'README.md'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })

    const bridge = createGithubBridge({
      pairingToken: 'test-pairing',
      origins: new Set([origin]),
      readJsonBody,
      sendJson,
      spawnCommand: commandRunner,
      env: {
        ...process.env,
        GH_TOKEN: 'fixture-value-not-a-secret',
        GITHUB_TOKEN: 'fixture-value-not-a-secret',
      },
    })
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
      if (!(await bridge.handle(req, res, url))) sendJson(res, 404, { error: 'not_found' })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.')
    endpoint = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    await rm(root, { recursive: true, force: true })
  })

  it('requires an allowed origin and the per-start pairing token', async () => {
    const missingPairing = await request('/git/status', { path: root }, { 'X-CodePilot-Pairing': '' })
    expect(missingPairing.status).toBe(401)
    expect(await missingPairing.json()).toMatchObject({ error: 'pairing_required' })

    const wrongOrigin = await request('/git/status', { path: root }, { Origin: 'https://example.invalid' })
    expect(wrongOrigin.status).toBe(403)

    const invalidBody = await request('/git/status', null)
    expect(invalidBody.status).toBe(400)
    expect(await invalidBody.json()).toMatchObject({ error: 'invalid_input' })
  })

  it('reports real working-tree changes and blocks path traversal when staging', async () => {
    await writeFile(path.join(root, 'change file.txt'), 'new content\n')
    const status = await request('/git/status', { path: root })
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({
      branch: 'main',
      entries: [{ path: 'change file.txt', indexStatus: '?', worktreeStatus: '?' }],
    })

    const rejected = await request('/git/stage', { path: root, paths: ['../outside.txt'] })
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ error: 'invalid_paths' })

    const staged = await request('/git/stage', { path: root, paths: ['change file.txt'] })
    expect(staged.status).toBe(200)
    const diff = await request('/git/diff', { path: root, cached: true })
    expect((await diff.json()).diff).toContain('+new content')
  })

  it('supports branch changes, commits and bounded history without exposing GitHub CLI output', async () => {
    const auth = await request('/github/status')
    expect(auth.status).toBe(200)
    expect(await auth.json()).toMatchObject({
      githubCliAvailable: true,
      authenticated: false,
      profile: null,
    })
    expect(lastGhEnv.GH_TOKEN).toBeUndefined()
    expect(lastGhEnv.GITHUB_TOKEN).toBeUndefined()

    const created = await request('/git/branch/create', { path: root, branch: 'feature/test' })
    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({ branch: 'feature/test' })

    await writeFile(path.join(root, 'feature.txt'), 'feature\n')
    await request('/git/stage', { path: root, paths: ['feature.txt'] })
    const committed = await request('/git/commit', { path: root, message: 'add feature' })
    expect(committed.status).toBe(200)
    const history = await request('/git/history', { path: root })
    expect((await history.json()).commits[0]).toMatchObject({
      author: 'CodePilot Test',
      subject: 'add feature',
    })
  })

  it('keeps rename paths intact so the UI can unstage both sides', async () => {
    execFileSync('git', ['mv', 'README.md', 'renamed.md'], { cwd: root })
    const status = await request('/git/status', { path: root })
    expect(await status.json()).toMatchObject({
      entries: [{ path: 'renamed.md', originalPath: 'README.md', indexStatus: 'R' }],
    })

    const staged = await request('/git/unstage', {
      path: root,
      paths: ['renamed.md', 'README.md'],
    })
    expect(staged.status).toBe(200)
  })

  it('rejects non-GitHub fetch and push destinations before running remote operations', async () => {
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/repo.git'], { cwd: root })
    const fetch = await request('/git/fetch', { path: root })
    expect(fetch.status).toBe(400)
    expect(await fetch.json()).toMatchObject({ error: 'github_remote_required' })

    execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/example/repo.git'], { cwd: root })
    execFileSync('git', ['remote', 'set-url', '--push', 'origin', 'https://example.invalid/repo.git'], { cwd: root })

    const push = await request('/git/push', { path: root, branch: 'main' })
    expect(push.status).toBe(400)
    expect(await push.json()).toMatchObject({ error: 'github_remote_required' })
  })

  it('includes authorized private repositories in search results without exposing CLI tokens', async () => {
    const bridge = createGithubBridge({
      pairingToken: 'test-pairing',
      origins: new Set([origin]),
      readJsonBody,
      sendJson,
      spawnCommand: commandRunner,
      env: {
        ...process.env,
        GH_TEST_AUTH: '1',
        GH_TOKEN: 'fixture-value-not-a-secret',
      },
    })
    const responseServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
      if (!(await bridge.handle(req, res, url))) sendJson(res, 404, { error: 'not_found' })
    })
    await new Promise((resolve) => responseServer.listen(0, '127.0.0.1', resolve))
    const address = responseServer.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/github/repos?q=private`, {
        headers: { Origin: origin, 'X-CodePilot-Pairing': 'test-pairing' },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        repositories: [{ nameWithOwner: 'test-user/private-repository', isPrivate: true }],
      })
      expect(lastGhEnv.GH_TOKEN).toBeUndefined()

      const created = await fetch(`http://127.0.0.1:${address.port}/github/repos`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'X-CodePilot-Pairing': 'test-pairing',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new-repository', description: 'test repo', private: true }),
      })
      expect(created.status).toBe(201)
      expect(lastGhArgs).toEqual([
        'repo',
        'create',
        'new-repository',
        '--private',
        '--confirm',
        '--description',
        'test repo',
      ])

      const clonePath = path.join(root, 'cloned-repository')
      const cloned = await fetch(`http://127.0.0.1:${address.port}/github/clone`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'X-CodePilot-Pairing': 'test-pairing',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repository: 'test-user/private-repository', path: clonePath }),
      })
      expect(cloned.status).toBe(201)
      expect(await cloned.json()).toMatchObject({ cloned: true, path: clonePath })
      expect(lastGhArgs).toEqual(['repo', 'clone', 'test-user/private-repository', clonePath])
    } finally {
      await new Promise((resolve, reject) => {
        responseServer.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
