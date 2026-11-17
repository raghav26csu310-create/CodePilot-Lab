import { getExecEndpoint } from '../execution/api'
import { getTerminalToken } from '../terminal/client'

export type GithubProfile = {
  login: string
  name: string | null
  avatarUrl: string | null
  url: string
}

export type GithubStatus = {
  gitAvailable: boolean
  githubCliAvailable: boolean
  authenticated: boolean
  profile: GithubProfile | null
  authCommand: string
}

export type GithubRepository = {
  name?: string
  nameWithOwner?: string
  fullName?: string
  description?: string | null
  isPrivate?: boolean
  visibility?: string
  url?: string
  defaultBranchRef?: { name?: string } | null
}

export type GitFileStatus = {
  indexStatus: string
  worktreeStatus: string
  path: string
  originalPath?: string
}

export type GitStatus = {
  branch: string
  entries: GitFileStatus[]
}

export type GitCommit = {
  hash: string
  author: string
  timestamp: number
  subject: string
}

export class GithubServiceError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'GithubServiceError'
    this.code = code
    this.status = status
  }
}

async function requestJson<T>(
  pathname: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const token = getTerminalToken()
  if (!token) {
    throw new GithubServiceError(
      'pairing_required',
      'Paste the pairing token printed by the local companion.',
    )
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  init.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await fetch(`${getExecEndpoint()}${pathname}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'X-CodePilot-Pairing': token,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    })
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new GithubServiceError(
        'invalid_response',
        'The local Git companion returned an unreadable response.',
        response.status,
      )
    }
    if (!response.ok) {
      const error = payload as { error?: unknown; message?: unknown }
      throw new GithubServiceError(
        typeof error.error === 'string' ? error.error : 'request_failed',
        typeof error.message === 'string' ? error.message : `The local companion answered ${response.status}.`,
        response.status,
      )
    }
    return payload as T
  } catch (error) {
    if (error instanceof GithubServiceError) throw error
    if (controller.signal.aborted) {
      throw new GithubServiceError('timeout', 'The local Git companion did not respond before the request timed out.')
    }
    throw new GithubServiceError(
      'unreachable',
      `The local Git companion at ${getExecEndpoint()} is offline. Start it with "npm run exec".`,
    )
  } finally {
    window.clearTimeout(timer)
    init.signal?.removeEventListener('abort', onAbort)
  }
}

function post<T>(pathname: string, body: unknown, timeoutMs?: number): Promise<T> {
  return requestJson<T>(
    pathname,
    { method: 'POST', body: JSON.stringify(body) },
    timeoutMs,
  )
}

export function fetchGithubStatus(signal?: AbortSignal): Promise<GithubStatus> {
  return requestJson<GithubStatus>('/github/status', { signal })
}

export function fetchGithubRepositories(query = ''): Promise<{ repositories: GithubRepository[] }> {
  const params = new URLSearchParams({ limit: '50' })
  if (query.trim()) params.set('q', query.trim())
  return requestJson(`/github/repos?${params.toString()}`)
}

export function disconnectGithub(): Promise<{ disconnected: boolean }> {
  return post('/github/disconnect', {})
}

export function createGithubRepository(input: {
  name: string
  description: string
  private: boolean
}): Promise<{ created: boolean; name: string }> {
  return post('/github/repos', input)
}

export function cloneGithubRepository(input: {
  repository: string
  path: string
}): Promise<{ cloned: boolean; repository: string; path: string }> {
  return post('/github/clone', input, 300_000)
}

export function fetchGitStatus(path: string): Promise<GitStatus> {
  return post('/git/status', { path })
}

export function fetchGitBranches(path: string): Promise<{ current: string; branches: string[] }> {
  return requestJson(`/git/branches?path=${encodeURIComponent(path)}`)
}

export function switchGitBranch(path: string, branch: string): Promise<{ branch: string }> {
  return post('/git/branch/switch', { path, branch })
}

export function createGitBranch(path: string, branch: string): Promise<{ branch: string }> {
  return post('/git/branch/create', { path, branch })
}

export function stageGitPaths(path: string, paths: string[], staged: boolean): Promise<{ updated: boolean }> {
  return post(staged ? '/git/unstage' : '/git/stage', { path, paths })
}

export function fetchGitDiff(path: string, cached: boolean): Promise<{ diff: string }> {
  return post('/git/diff', { path, cached })
}

export function commitGitChanges(path: string, message: string): Promise<{ committed: boolean }> {
  return post('/git/commit', { path, message })
}

export function runGitRemoteAction(
  path: string,
  action: 'fetch' | 'pull' | 'push',
  branch?: string,
): Promise<Record<string, boolean>> {
  return post(`/git/${action}`, { path, ...(branch ? { branch } : {}) }, 120_000)
}

export function fetchGitHistory(path: string): Promise<{ commits: GitCommit[] }> {
  return post('/git/history', { path })
}
