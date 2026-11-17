import { timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, lstat, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const MAX_OUTPUT_BYTES = 1_000_000
const COMMAND_TIMEOUT_MS = 60_000
const GITHUB_FIELDS = 'nameWithOwner,name,description,isPrivate,url,defaultBranchRef'
const SEARCH_FIELDS = 'fullName,name,description,visibility,url,stargazersCount,language'
const AUTH_COMMAND = 'gh auth login --hostname github.com --git-protocol https --web --expiring'

class BridgeError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function isPaired(candidate, expected) {
  if (typeof candidate !== 'string' || !candidate || !expected) return false
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function run(
  command,
  args,
  { cwd, env, timeoutMs = COMMAND_TIMEOUT_MS, maxOutputBytes = MAX_OUTPUT_BYTES } = {},
  onSpawn,
) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      onSpawn?.(child)
    } catch (error) {
      reject(error)
      return
    }

    const stdout = []
    const stderr = []
    let outputBytes = 0
    let timedOut = false
    let outputTooLarge = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    const collect = (target) => (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > maxOutputBytes) {
        outputTooLarge = true
        child.kill()
        return
      }
      target.push(chunk)
    }

    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
      if (timedOut) {
        reject(new BridgeError(504, 'command_timeout', 'The local Git command timed out.'))
      } else if (outputTooLarge) {
        reject(new BridgeError(413, 'output_too_large', 'The command output exceeded the response limit.'))
      } else {
        resolve(result)
      }
    })
  })
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new BridgeError(400, 'invalid_input', 'A text value is invalid.')
  }
  const cleaned = value.trim()
  if (cleaned.length > maxLength) {
    throw new BridgeError(400, 'invalid_input', `Text must be ${maxLength} characters or fewer.`)
  }
  return cleaned
}

function requireString(value, name, maxLength = 4096) {
  const cleaned = cleanText(value, maxLength)
  if (!cleaned) {
    throw new BridgeError(400, 'invalid_input', `${name} is required.`)
  }
  return cleaned
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeError(400, 'invalid_input', 'The request body must be a JSON object.')
  }
  return value
}

function repoSlug(value) {
  const slug = requireString(value, 'Repository', 200)
  if (
    !/^[\w.-]+(?:\/[\w.-]+)?$/.test(slug) ||
    slug.split('/').some((part) => part === '.' || part === '..' || part.startsWith('-'))
  ) {
    throw new BridgeError(400, 'invalid_repository', 'Use a GitHub repository name or owner/name.')
  }
  return slug
}

function normalizePathspecs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new BridgeError(400, 'invalid_paths', 'Choose between 1 and 100 repository paths.')
  }
  return value.map((item) => {
    if (typeof item !== 'string' || !item || item.includes('\0') || item.length > 4096) {
      throw new BridgeError(400, 'invalid_paths', 'A repository path is invalid.')
    }
    const file = item
    const normalized = file.replace(/\\/g, '/')
    const segments = normalized.split('/')
    if (
      normalized.startsWith('/') ||
      /^[a-zA-Z]:/.test(file) ||
      segments.some((segment) => !segment || segment === '..' || segment === '.')
    ) {
      throw new BridgeError(400, 'invalid_paths', 'Repository paths must stay inside the selected repository.')
    }
    return `:(literal)${file}`
  })
}

function parseGitStatus(output) {
  let branch = ''
  const entries = []
  const records = output.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.startsWith('## ')) {
      branch = record.slice(3).split('...')[0].replace(/^No commits yet on /, '')
      continue
    }
    const indexStatus = record[0] ?? ' '
    const worktreeStatus = record[1] ?? ' '
    const filePath = record.slice(3)
    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      entries.push({
        indexStatus,
        worktreeStatus,
        path: filePath,
        originalPath: records[index + 1] ?? '',
      })
      index += 1
      continue
    }
    entries.push({ indexStatus, worktreeStatus, path: filePath })
  }
  return { branch, entries }
}

function normalizeBranch(value) {
  const branch = requireString(value, 'Branch', 255)
  if (branch.startsWith('-') || /[ ~^:?*[\]\\]/.test(branch)) {
    throw new BridgeError(400, 'invalid_branch', 'The branch name contains unsupported characters.')
  }
  return branch
}

function publicError(error) {
  if (error instanceof BridgeError) {
    return { status: error.status, code: error.code, message: error.message }
  }
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
    return {
      status: error.statusCode,
      code: 'invalid_request',
      message: error instanceof Error ? error.message : 'The request was rejected.',
    }
  }
  if (error?.code === 'ENOENT') {
    return {
      status: 503,
      code: 'tool_missing',
      message: 'Git or GitHub CLI is not installed or is not available on PATH.',
    }
  }
  return { status: 500, code: 'internal_error', message: 'The local Git companion could not complete the request.' }
}

function isGithubRemote(value) {
  const remote = value.trim()
  return (
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(remote) ||
    /^git@github\.com:[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(remote) ||
    /^ssh:\/\/git@github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(remote)
  )
}

function parseRepositories(output) {
  let repositories
  try {
    repositories = JSON.parse(output)
  } catch {
    throw new BridgeError(502, 'invalid_github_response', 'GitHub CLI returned an invalid repository response.')
  }
  if (!Array.isArray(repositories)) {
    throw new BridgeError(502, 'invalid_github_response', 'GitHub CLI returned an invalid repository list.')
  }
  return repositories
}

export function createGithubBridge({
  pairingToken,
  origins,
  readJsonBody,
  sendJson,
  spawnCommand = run,
  env = process.env,
}) {
  const allowedOrigins = origins instanceof Set ? origins : new Set(origins)
  const activeProcesses = new Set()
  const runCommand = spawnCommand === run
    ? (command, args, options) => run(command, args, options, (child) => {
        activeProcesses.add(child)
        child.once('close', () => activeProcesses.delete(child))
      })
    : spawnCommand
  const cliEnv = {
    ...env,
  }
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) {
    delete cliEnv[key]
  }
  const ghEnv = { ...cliEnv, GH_PROMPT_DISABLED: '1' }

  async function execute(command, args, options = {}) {
    const result = await runCommand(command, args, {
      env: command === 'gh' ? ghEnv : command === 'git' ? cliEnv : env,
      ...options,
    })
    if (result.code !== 0) {
      const detail = `${result.stderr}\n${result.stdout}`.toLowerCase()
      if (detail.includes('conflict') || detail.includes('merge failed')) {
        throw new BridgeError(409, 'merge_conflict', 'Git reported a merge conflict. Resolve it in the repository before continuing.')
      }
      if (
        detail.includes('authentication failed') ||
        detail.includes('authentication required') ||
        detail.includes('permission denied') ||
        detail.includes('http 401') ||
        detail.includes('http 403')
      ) {
        throw new BridgeError(403, 'github_permission_denied', 'GitHub rejected the operation. Re-check the active GitHub CLI account and its repository permissions.')
      }
      if (
        detail.includes('could not resolve host') ||
        detail.includes('failed to connect') ||
        detail.includes('network is unreachable') ||
        detail.includes('connection timed out')
      ) {
        throw new BridgeError(502, 'network_error', 'The GitHub operation could not reach the remote service.')
      }
      throw new BridgeError(400, 'command_failed', 'The requested Git or GitHub CLI command failed. Check the repository state, GitHub CLI login and repository permissions.')
    }
    return result.stdout.trim()
  }

  async function gitRoot(workspacePath) {
    const supplied = requireString(workspacePath, 'Local repository path')
    if (!path.isAbsolute(supplied)) {
      throw new BridgeError(400, 'invalid_path', 'Enter an absolute local repository path.')
    }
    let canonical
    try {
      canonical = await realpath(supplied)
      if (!(await stat(canonical)).isDirectory()) {
        throw new Error('not a directory')
      }
    } catch {
      throw new BridgeError(400, 'invalid_path', 'The selected local path does not exist or is not a directory.')
    }
    const top = await execute('git', ['-C', canonical, 'rev-parse', '--show-toplevel'])
    const canonicalTop = await realpath(top)
    const same = process.platform === 'win32'
      ? canonical.toLowerCase() === canonicalTop.toLowerCase()
      : canonical === canonicalTop
    if (!same) {
      throw new BridgeError(400, 'not_repository_root', 'Enter the repository root directory, not a subdirectory.')
    }
    return canonical
  }

  async function git(cwd, args, options) {
    return execute('git', ['-C', cwd, ...args], { cwd, ...options })
  }

  async function requireGithubRemote(cwd, action) {
    let remote
    try {
      remote = await git(cwd, [
        'remote',
        'get-url',
        ...(action === 'push' ? ['--push'] : []),
        'origin',
      ])
    } catch {
      throw new BridgeError(400, 'github_remote_required', 'This operation requires an origin remote hosted on github.com.')
    }
    if (!isGithubRemote(remote)) {
      throw new BridgeError(400, 'github_remote_required', 'The origin remote must be an HTTPS or SSH GitHub URL.')
    }
  }

  async function status() {
    try {
      await execute('gh', ['--version'])
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          gitAvailable: await toolAvailable('git'),
          githubCliAvailable: false,
          authenticated: false,
          profile: null,
          authCommand: AUTH_COMMAND,
        }
      }
      throw error
    }
    const auth = await runCommand('gh', ['auth', 'status', '--hostname', 'github.com'], { env: ghEnv })
    if (auth.code !== 0) {
      return {
        gitAvailable: await toolAvailable('git'),
        githubCliAvailable: true,
        authenticated: false,
        profile: null,
        authCommand: AUTH_COMMAND,
      }
    }
    const profileText = await execute('gh', [
      'api',
      'user',
      '--jq',
      '{login: .login, name: .name, avatarUrl: .avatar_url, url: .html_url}',
    ])
    let profile
    try {
      profile = JSON.parse(profileText)
    } catch {
      throw new BridgeError(502, 'invalid_github_response', 'GitHub CLI returned an invalid profile response.')
    }
    return {
      gitAvailable: await toolAvailable('git'),
      githubCliAvailable: true,
      authenticated: true,
      profile: {
        login: typeof profile.login === 'string' ? profile.login : '',
        name: typeof profile.name === 'string' ? profile.name : null,
        avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : null,
        url: typeof profile.url === 'string' ? profile.url : '',
      },
      authCommand: AUTH_COMMAND,
    }
  }

  async function toolAvailable(command) {
    try {
      await runCommand(command, ['--version'], { env: cliEnv })
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw error
    }
  }

  async function githubRepositories(url) {
    const query = cleanText(url.searchParams.get('q') ?? '', 200)
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))
    const ownedOutput = await execute('gh', [
      'repo',
      'list',
      '--limit',
      '1000',
      '--json',
      GITHUB_FIELDS,
    ])
    const ownedRepositories = parseRepositories(ownedOutput)
    if (!query) return ownedRepositories.slice(0, limit)

    const searchOutput = await execute('gh', [
      'search',
      'repos',
      query,
      '--limit',
      String(limit),
      '--json',
      SEARCH_FIELDS,
    ])
    const publicRepositories = parseRepositories(searchOutput)
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term && !term.includes(':'))
    const matchingOwned = terms.length
      ? ownedRepositories.filter((repo) => {
          const text = `${repo.nameWithOwner ?? ''} ${repo.description ?? ''}`.toLowerCase()
          return terms.every((term) => text.includes(term))
        })
      : []
    const combined = [...matchingOwned, ...publicRepositories]
    const seen = new Set()
    return combined.filter((repo) => {
      const name = repo.nameWithOwner ?? repo.fullName ?? ''
      if (!name || seen.has(name)) return false
      seen.add(name)
      return true
    }).slice(0, limit)
  }

  async function handle(request, response, url) {
    const githubRoute = url.pathname.startsWith('/github/')
    const gitRoute = url.pathname.startsWith('/git/')
    if (!githubRoute && !gitRoute) return false

    const origin = request.headers.origin
    if (!origin || !allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: 'origin_not_allowed', message: 'This origin is not allowed to use the local Git companion.' })
      return true
    }
    if (!isPaired(request.headers['x-codepilot-pairing'], pairingToken)) {
      sendJson(response, 401, { error: 'pairing_required', message: 'Enter the pairing token printed by the local companion.' })
      return true
    }

    try {
      if (request.method === 'GET' && url.pathname === '/github/status') {
        sendJson(response, 200, await status())
        return true
      }
      if (request.method === 'GET' && url.pathname === '/github/repos') {
        const current = await status()
        if (!current.authenticated) {
          throw new BridgeError(409, 'github_auth_required', 'Authenticate with GitHub CLI before browsing repositories.')
        }
        sendJson(response, 200, { repositories: await githubRepositories(url) })
        return true
      }
      if (request.method === 'POST' && url.pathname === '/github/disconnect') {
        const current = await status()
        if (!current.githubCliAvailable) {
          throw new BridgeError(503, 'github_cli_missing', 'Install GitHub CLI before disconnecting an account.')
        }
        if (current.authenticated && current.profile?.login) {
          await execute('gh', [
            'auth',
            'logout',
            '--hostname',
            'github.com',
            '--user',
            current.profile.login,
          ])
        }
        sendJson(response, 200, {
          disconnected: true,
          note: 'GitHub CLI authentication was removed locally. This does not revoke the OAuth grant on GitHub.',
        })
        return true
      }
      if (request.method === 'POST' && url.pathname === '/github/repos') {
        const current = await status()
        if (!current.authenticated) {
          throw new BridgeError(409, 'github_auth_required', 'Authenticate with GitHub CLI before creating repositories.')
        }
        const body = requireObject(await readJsonBody(request))
        const name = repoSlug(body.name)
        const description = cleanText(body.description ?? '', 350)
        if (typeof body.private !== 'boolean') {
          throw new BridgeError(400, 'invalid_input', 'Choose whether the repository is private.')
        }
        const args = ['repo', 'create', name, body.private ? '--private' : '--public', '--confirm']
        if (description) args.push('--description', description)
        await execute('gh', args)
        sendJson(response, 201, { created: true, name })
        return true
      }
      if (request.method === 'POST' && url.pathname === '/github/clone') {
        const current = await status()
        if (!current.authenticated) {
          throw new BridgeError(409, 'github_auth_required', 'Authenticate with GitHub CLI before cloning repositories.')
        }
        const body = requireObject(await readJsonBody(request))
        const repository = repoSlug(body.repository)
        const target = requireString(body.path, 'Clone destination')
        if (!path.isAbsolute(target)) {
          throw new BridgeError(400, 'invalid_path', 'Enter an absolute clone destination path.')
        }
        const canonicalTarget = path.resolve(target)
        try {
          await access(canonicalTarget)
          const targetStat = await lstat(canonicalTarget)
          if (targetStat.isSymbolicLink() || !targetStat.isDirectory() || (await readdir(canonicalTarget)).length > 0) {
            throw new BridgeError(409, 'destination_exists', 'The clone destination must not exist or must be an empty directory.')
          }
        } catch (error) {
          if (error instanceof BridgeError) throw error
          if (error?.code !== 'ENOENT') throw error
        }
        try {
          const parent = await stat(path.dirname(canonicalTarget))
          if (!parent.isDirectory()) throw new Error('not a directory')
        } catch {
          throw new BridgeError(400, 'invalid_path', 'The parent directory for the clone destination must already exist.')
        }
        await execute('gh', ['repo', 'clone', repository, canonicalTarget], { timeoutMs: 300_000 })
        sendJson(response, 201, { cloned: true, repository, path: canonicalTarget })
        return true
      }
      if (request.method === 'GET' && url.pathname === '/git/branches') {
        const cwd = await gitRoot(url.searchParams.get('path'))
        const [current, output] = await Promise.all([
          git(cwd, ['branch', '--show-current']),
          git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
        ])
        sendJson(response, 200, { current, branches: output.split(/\r?\n/).filter(Boolean) })
        return true
      }
      if (request.method === 'POST' && url.pathname.startsWith('/git/')) {
        const body = requireObject(await readJsonBody(request))
        const cwd = await gitRoot(body.path)
        if (url.pathname === '/git/status') {
          const output = await git(cwd, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'])
          sendJson(response, 200, parseGitStatus(output))
          return true
        }
        if (url.pathname === '/git/branch/switch' || url.pathname === '/git/branch/create') {
          const branch = normalizeBranch(body.branch)
          const valid = await runCommand('git', ['-C', cwd, 'check-ref-format', '--branch', branch], { env: cliEnv })
          if (valid.code !== 0) {
            throw new BridgeError(400, 'invalid_branch', 'Git rejected this branch name.')
          }
          await git(cwd, url.pathname.endsWith('/create')
            ? ['switch', '-c', branch]
            : ['switch', '--no-guess', branch])
          sendJson(response, 200, { branch })
          return true
        }
        if (url.pathname === '/git/stage' || url.pathname === '/git/unstage') {
          const args = normalizePathspecs(body.paths)
          await git(cwd, url.pathname === '/git/stage'
            ? ['add', '--', ...args]
            : ['restore', '--staged', '--', ...args])
          sendJson(response, 200, { updated: true })
          return true
        }
        if (url.pathname === '/git/diff') {
          const cached = body.cached === true
          const paths = body.paths === undefined ? [] : normalizePathspecs(body.paths)
          const args = cached
            ? ['diff', '--cached', '--no-ext-diff', ...(paths.length ? ['--', ...paths] : [])]
            : ['diff', '--no-ext-diff', ...(paths.length ? ['--', ...paths] : [])]
          sendJson(response, 200, { diff: await git(cwd, args) })
          return true
        }
        if (url.pathname === '/git/commit') {
          const message = requireString(body.message, 'Commit message', 5000)
          await git(cwd, ['commit', '-m', message])
          sendJson(response, 200, { committed: true })
          return true
        }
        if (url.pathname === '/git/fetch' || url.pathname === '/git/pull' || url.pathname === '/git/push') {
          const action = url.pathname.slice('/git/'.length)
          await requireGithubRemote(cwd, action)
          const branch = body.branch === undefined ? '' : normalizeBranch(body.branch)
          const args = action === 'fetch'
            ? ['fetch', '--prune', 'origin']
            : action === 'pull'
              ? ['pull', '--no-rebase', 'origin', ...(branch ? [branch] : [])]
              : ['push', ...(branch ? ['-u', 'origin', branch] : ['origin'])]
          await git(cwd, args, { timeoutMs: 120_000 })
          sendJson(response, 200, { [action === 'fetch' ? 'fetched' : action === 'pull' ? 'pulled' : 'pushed']: true })
          return true
        }
        if (url.pathname === '/git/history') {
          const output = await git(cwd, ['log', '--max-count=50', '--format=%H%x00%an%x00%at%x00%s'])
          const commits = output.split(/\r?\n/).filter(Boolean).map((line) => {
            const [hash = '', author = '', timestamp = '', ...subject] = line.split('\0')
            return { hash, author, timestamp: Number(timestamp), subject: subject.join('\0') }
          })
          sendJson(response, 200, { commits })
          return true
        }
      }
      sendJson(response, 404, { error: 'not_found', message: `No GitHub route for ${request.method} ${url.pathname}.` })
      return true
    } catch (error) {
      const failure = publicError(error)
      if (failure.status >= 500) {
        console.error(JSON.stringify({
          level: 'error',
          event: 'github_bridge.failure',
          method: request.method ?? 'GET',
          path: url.pathname,
          code: failure.code,
        }))
      }
      sendJson(response, failure.status, { error: failure.code, message: failure.message })
      return true
    }
  }

  function closeAll() {
    for (const child of activeProcesses) child.kill()
  }

  return { handle, closeAll }
}
