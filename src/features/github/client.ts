import { requestJson } from '../copilot/gateway/client'

/**
 * The server's GitHub configuration report. `configured` only means the five
 * App variables are present on the API process; `actionsAvailable` stays false
 * until the install flow and repository actions actually exist.
 */
export type GithubStatus = {
  configured: boolean
  missing: string[]
  present: {
    appId: boolean
    privateKey: boolean
    clientId: boolean
    clientSecret: boolean
    callbackUrl: boolean
  }
  actionsAvailable: boolean
  note: string
  checkedAt: string
}

export function fetchGithubStatus(signal?: AbortSignal): Promise<GithubStatus> {
  return requestJson<GithubStatus>('/api/github/status', { signal })
}
