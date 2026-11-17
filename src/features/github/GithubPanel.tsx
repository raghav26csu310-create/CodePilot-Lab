import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, RefreshCw } from 'lucide-react'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { Select } from '../../design-system/primitives/Select'
import { getTerminalToken, setTerminalToken } from '../terminal/client'
import {
  cloneGithubRepository,
  commitGitChanges,
  createGithubRepository,
  createGitBranch,
  disconnectGithub,
  fetchGithubRepositories,
  fetchGithubStatus,
  fetchGitBranches,
  fetchGitDiff,
  fetchGitHistory,
  fetchGitStatus,
  runGitRemoteAction,
  stageGitPaths,
  switchGitBranch,
  type GitCommit,
  type GitStatus,
  type GithubRepository,
  type GithubStatus,
  GithubServiceError,
} from './client'
import styles from './GithubPanel.module.css'

function repositoryName(repository: GithubRepository): string {
  return repository.nameWithOwner ?? repository.fullName ?? repository.name ?? 'Unknown repository'
}

function describeError(error: unknown): string {
  if (error instanceof GithubServiceError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'The GitHub operation failed.'
}

export function GithubPanel() {
  const [token, setToken] = useState(() => getTerminalToken())
  const [tokenDraft, setTokenDraft] = useState(() => getTerminalToken())
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [serviceError, setServiceError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [repositories, setRepositories] = useState<GithubRepository[]>([])
  const [selectedRepository, setSelectedRepository] = useState('')
  const [repoName, setRepoName] = useState('')
  const [repoDescription, setRepoDescription] = useState('')
  const [privateRepository, setPrivateRepository] = useState(true)
  const [clonePath, setClonePath] = useState('')
  const [workspacePath, setWorkspacePath] = useState('')
  const [loadedWorkspacePath, setLoadedWorkspacePath] = useState('')
  const workspaceRequestId = useRef(0)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [diff, setDiff] = useState('')
  const [showStagedDiff, setShowStagedDiff] = useState(false)
  const [history, setHistory] = useState<GitCommit[]>([])

  const refreshStatus = useCallback(async () => {
    try {
      setServiceError('')
      setStatus(await fetchGithubStatus())
    } catch (cause) {
      setStatus(null)
      setServiceError(describeError(cause))
    }
  }, [])

  useEffect(() => {
    if (!token) return
    let active = true
    fetchGithubStatus()
      .then((result) => {
        if (active) {
          setStatus(result)
          setServiceError('')
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setStatus(null)
          setServiceError(describeError(cause))
        }
      })
    return () => {
      active = false
    }
  }, [token])

  const perform = async (action: () => Promise<void>, successMessage: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(successMessage)
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  const connectToken = () => {
    const cleaned = tokenDraft.trim()
    setTerminalToken(cleaned)
    setToken(cleaned)
    setStatus(null)
    setServiceError('')
    setError('')
  }

  const loadWorkspace = async (path = workspacePath) => {
    const requestId = ++workspaceRequestId.current
    const [nextStatus, nextBranches] = await Promise.all([
      fetchGitStatus(path),
      fetchGitBranches(path),
    ])
    if (requestId !== workspaceRequestId.current) return
    setGitStatus(nextStatus)
    setBranches(nextBranches.branches)
    setCurrentBranch(nextBranches.current)
    setLoadedWorkspacePath(path)
    setHistory([])
    setDiff('')
  }

  const refreshRepositories = async () => {
      const result = await fetchGithubRepositories(search)
      setRepositories(result.repositories)
      setSelectedRepository('')
  }

  const loadRepositories = () =>
    perform(refreshRepositories, 'Repository list updated.')

  const loadDiff = (cached: boolean) =>
    perform(async () => {
      setShowStagedDiff(cached)
      const result = await fetchGitDiff(loadedWorkspacePath, cached)
      setDiff(result.diff)
    }, cached ? 'Staged diff loaded.' : 'Working-tree diff loaded.')

  const remoteAction = (action: 'fetch' | 'pull' | 'push') =>
    perform(async () => {
      await runGitRemoteAction(loadedWorkspacePath, action, currentBranch)
      await loadWorkspace(loadedWorkspacePath)
    }, `${action[0]?.toUpperCase()}${action.slice(1)} completed.`)

  const branchOptions = branches.map((branch) => ({ value: branch, label: branch }))
  const selectedRepo = repositories.find((repository) => repositoryName(repository) === selectedRepository)
  const canUseGit = Boolean(token && status?.gitAvailable && workspacePath.trim() && !busy)

  return (
    <div className={styles.stack}>
      <p className={styles.message}>
        GitHub and Git run through the local companion. GitHub CLI owns OAuth and credential storage;
        access tokens never enter this browser or the CodePilot API. The CLI uses the OS credential
        store when available and may fall back to its local config file on systems without one.
      </p>

      <div className={styles.connection}>
        <label className={styles.label} htmlFor="github-pairing-token">
          Local companion pairing token
        </label>
        <div className={styles.row}>
          <input
            id="github-pairing-token"
            className={styles.input}
            type="password"
            autoComplete="off"
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            placeholder="Paste token from npm run exec"
          />
          <Button size="sm" variant="secondary" onClick={connectToken} disabled={!tokenDraft.trim()}>
            Pair
          </Button>
        </div>
        <p className={styles.hint}>
          Start <code>npm run exec</code>, then paste its console token. It is shared with Terminal
          and stays in this tab&apos;s session storage.
        </p>
      </div>

      {serviceError ? (
        <p className={styles.error} role="alert">{serviceError}</p>
      ) : status ? (
        <div className={styles.connection}>
          <div className={styles.row}>
            <Badge tone={status.authenticated ? 'live' : status.githubCliAvailable ? 'warn' : 'planned'}>
              {status.authenticated
                ? `Connected as ${status.profile?.login ?? 'GitHub user'}`
                : status.githubCliAvailable
                  ? 'Not authenticated'
                  : 'GitHub CLI unavailable'}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={12} />}
              onClick={() => void refreshStatus()}
              disabled={busy}
            >
              Re-check
            </Button>
          </div>
          {!status.gitAvailable ? (
            <p className={styles.error}>Git is not installed or is not available on PATH.</p>
          ) : null}
          {!status.githubCliAvailable ? (
            <p className={styles.message}>
              Install GitHub CLI (<code>gh</code>) from{' '}
              <a className={styles.link} href="https://cli.github.com/" target="_blank" rel="noreferrer">
                its official download guide <ExternalLink size={12} />
              </a>
              . On Windows, use <code>winget install --id GitHub.cli</code>, then re-check. Git
              operations on local repositories remain available when Git itself is installed.
            </p>
          ) : status.authenticated ? (
            <div className={styles.row}>
              {status.profile?.url ? (
                <a className={styles.link} href={status.profile.url} target="_blank" rel="noreferrer">
                  {status.profile.name || status.profile.login} <ExternalLink size={12} />
                </a>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void perform(async () => {
                  await disconnectGithub()
                  await refreshStatus()
                }, 'Signed out locally. Revoke the GitHub CLI grant separately in GitHub Settings if needed.')}
                disabled={busy}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className={styles.stackTight}>
              <p className={styles.message}>
                Run this command in a local terminal and complete GitHub&apos;s device authorization.
                Then select Re-check. No CodePilot callback URL or GitHub App registration is used.
              </p>
              <code className={styles.command}>{status.authCommand}</code>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy size={12} />}
                onClick={() => void perform(async () => {
                  if (!navigator.clipboard) throw new Error('Clipboard access is unavailable in this browser.')
                  await navigator.clipboard.writeText(status.authCommand)
                }, 'Login command copied.')}
                disabled={busy || !status.githubCliAvailable}
              >
                Copy login command
              </Button>
            </div>
          )}
        </div>
      ) : token ? (
        <p className={styles.message} role="status">Checking the local Git companion…</p>
      ) : null}

      {token && status?.githubCliAvailable && status.authenticated ? (
        <>
          <div className={styles.section}>
            <h3>Repositories</h3>
            <div className={styles.row}>
              <input
                className={styles.input}
                aria-label="Search GitHub repositories"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search GitHub repositories (blank lists yours)"
              />
              <Button size="sm" variant="secondary" onClick={() => void loadRepositories()} disabled={busy}>
                Search
              </Button>
            </div>
            {repositories.length ? (
              <ul className={styles.repoList}>
                {repositories.map((repository) => {
                  const name = repositoryName(repository)
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        className={styles.repo}
                        aria-pressed={selectedRepository === name}
                        onClick={() => setSelectedRepository(name)}
                      >
                        <span className={styles.repoName}>{name}</span>
                        <span className={styles.repoDescription}>
                          {repository.description ||
                            (repository.isPrivate || repository.visibility?.toLowerCase() === 'private'
                              ? 'Private repository'
                              : 'Public repository')}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            <div className={styles.form}>
              <label className={styles.label} htmlFor="github-repo-name">Create repository</label>
              <input
                id="github-repo-name"
                className={styles.input}
                value={repoName}
                onChange={(event) => setRepoName(event.target.value)}
                placeholder="repository-name"
              />
              <input
                className={styles.input}
                aria-label="Repository description"
                value={repoDescription}
                onChange={(event) => setRepoDescription(event.target.value)}
                placeholder="Description (optional)"
              />
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={privateRepository}
                  onChange={(event) => setPrivateRepository(event.target.checked)}
                />
                Private repository
              </label>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void perform(async () => {
                  await createGithubRepository({
                    name: repoName,
                    description: repoDescription,
                    private: privateRepository,
                  })
                  setRepoName('')
                  await refreshRepositories()
                }, 'Repository created.')}
                disabled={busy || !repoName.trim()}
              >
                Create repository
              </Button>
            </div>
            {selectedRepository ? (
              <div className={styles.form}>
                {selectedRepo ? (
                  <div className={styles.repoDetails}>
                    <span>
                      {selectedRepo.isPrivate || selectedRepo.visibility?.toLowerCase() === 'private'
                        ? 'Private'
                        : 'Public'}
                      {selectedRepo.defaultBranchRef?.name
                        ? ` · default branch ${selectedRepo.defaultBranchRef.name}`
                        : ''}
                    </span>
                    {selectedRepo.url ? (
                      <a className={styles.link} href={selectedRepo.url} target="_blank" rel="noreferrer">
                        Open on GitHub <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </div>
                ) : null}
                <label className={styles.label} htmlFor="github-clone-path">Clone destination (absolute OS path)</label>
                <input
                  id="github-clone-path"
                  className={styles.input}
                  value={clonePath}
                  onChange={(event) => setClonePath(event.target.value)}
                  placeholder="C:\Users\you\source\repository"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void perform(async () => {
                    const result = await cloneGithubRepository({ repository: selectedRepository, path: clonePath })
                    setWorkspacePath(result.path)
                    await loadWorkspace(result.path)
                  }, 'Repository cloned.')}
                  disabled={busy || !clonePath.trim()}
                >
                  Clone repository
                </Button>
                <p className={styles.hint}>
                  Cloning writes to that local path. To add it to the CodePilot project picker, use Workspace → Import folder.
                </p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div className={styles.section}>
        <h3>Local source control</h3>
        <p className={styles.message}>
          Enter the repository&apos;s explicit OS path. CodePilot does not infer a path from a browser folder handle.
          Git commands run on this machine and may invoke your configured Git credential helper and hooks.
        </p>
        <label className={styles.label} htmlFor="github-workspace-path">Repository root path</label>
        <div className={styles.row}>
          <input
            id="github-workspace-path"
            className={styles.input}
            value={workspacePath}
            onChange={(event) => {
              workspaceRequestId.current += 1
              setWorkspacePath(event.target.value)
              setLoadedWorkspacePath('')
              setGitStatus(null)
              setBranches([])
              setHistory([])
              setDiff('')
            }}
            placeholder="C:\Users\you\source\repository"
          />
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw size={12} />}
            onClick={() => void perform(() => loadWorkspace(), 'Repository status refreshed.')}
            disabled={!canUseGit}
          >
            Open
          </Button>
        </div>

        {gitStatus && loadedWorkspacePath === workspacePath ? (
          <div className={styles.stackTight}>
            <div className={styles.toolbar}>
              <Badge tone="live">{gitStatus.branch || 'Detached HEAD'}</Badge>
              <Select
                value={currentBranch}
                options={branchOptions}
                ariaLabel="Switch Git branch"
                placeholder="Select branch"
                onChange={(branch) => void perform(async () => {
                  await switchGitBranch(loadedWorkspacePath, branch)
                  await loadWorkspace(loadedWorkspacePath)
                }, `Switched to ${branch}.`)}
                disabled={busy || branches.length === 0}
                compact
              />
            </div>
            <div className={styles.row}>
              <input
                className={styles.input}
                aria-label="New Git branch name"
                value={newBranch}
                onChange={(event) => setNewBranch(event.target.value)}
                placeholder="New branch name"
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<GitBranch size={12} />}
                onClick={() => void perform(async () => {
                  await createGitBranch(loadedWorkspacePath, newBranch)
                  setNewBranch('')
                  await loadWorkspace(loadedWorkspacePath)
                }, `Created branch ${newBranch}.`)}
                disabled={busy || !newBranch.trim()}
              >
                Create
              </Button>
            </div>
            <div className={styles.fileList}>
              {gitStatus.entries.length ? gitStatus.entries.map((file) => {
                const isStaged = file.indexStatus !== ' ' && file.indexStatus !== '?'
                return (
                  <div className={styles.file} key={`${file.indexStatus}${file.worktreeStatus}${file.path}${file.originalPath ?? ''}`}>
                    <code>{file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}</code>
                    <span>{file.indexStatus}{file.worktreeStatus}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void perform(async () => {
                        await stageGitPaths(
                          loadedWorkspacePath,
                          [file.path, ...(file.originalPath ? [file.originalPath] : [])],
                          isStaged,
                        )
                        await loadWorkspace(loadedWorkspacePath)
                      }, isStaged ? 'File unstaged.' : 'File staged.')}
                      disabled={busy}
                    >
                      {isStaged ? 'Unstage' : 'Stage'}
                    </Button>
                  </div>
                )
              }) : <p className={styles.message}>Working tree clean.</p>}
            </div>
            <div className={styles.row}>
              <input
                className={styles.input}
                aria-label="Commit message"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Commit message"
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<GitCommitHorizontal size={12} />}
                onClick={() => void perform(async () => {
                  await commitGitChanges(loadedWorkspacePath, commitMessage)
                  setCommitMessage('')
                  await loadWorkspace(loadedWorkspacePath)
                }, 'Commit created.')}
                disabled={busy || !commitMessage.trim()}
              >
                Commit
              </Button>
            </div>
            <div className={styles.actions}>
              {(['fetch', 'pull', 'push'] as const).map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant="secondary"
                  icon={action === 'pull' ? <GitPullRequest size={12} /> : undefined}
                  onClick={() => void remoteAction(action)}
                  disabled={busy}
                >
                  {action[0]?.toUpperCase()}{action.slice(1)}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void perform(async () => {
                  const result = await fetchGitHistory(loadedWorkspacePath)
                  setHistory(result.commits)
                }, 'Commit history loaded.')}
                disabled={busy}
              >
                History
              </Button>
            </div>
            <div className={styles.actions}>
              <Button size="sm" variant={showStagedDiff ? 'secondary' : 'ghost'} onClick={() => void loadDiff(true)} disabled={busy}>
                Staged diff
              </Button>
              <Button size="sm" variant={!showStagedDiff ? 'secondary' : 'ghost'} onClick={() => void loadDiff(false)} disabled={busy}>
                Working diff
              </Button>
            </div>
            {diff ? <pre className={styles.diff}>{diff}</pre> : null}
            {history.length ? (
              <ol className={styles.history}>
                {history.map((commit) => (
                  <li key={commit.hash}>
                    <code>{commit.hash.slice(0, 8)}</code>
                    <span>{commit.subject}</span>
                    <small>{commit.author} · {new Date(commit.timestamp * 1000).toLocaleString()}</small>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {busy ? <p className={styles.message} role="status">Waiting for the local Git operation to finish…</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    </div>
  )
}
