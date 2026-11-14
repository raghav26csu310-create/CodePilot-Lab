import type { AppConfig } from '../config/env.ts'

/**
 * Honest GitHub configuration report. It answers one question — are the GitHub
 * App credentials present on this API process? — and never returns a value.
 *
 * Possessing credentials is not the same as a working integration: the install
 * flow, repository listing and commit/push actions are not implemented in this
 * build, so `actionsAvailable` stays false until they are.
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
}

const MISSING_NOTE =
  'The GitHub App is not configured on this API process. Set GITHUB_APP_ID, ' +
  'GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and ' +
  'GITHUB_CALLBACK_URL in the API environment. The install flow and repository ' +
  'actions are not implemented in this build.'

const PRESENT_NOTE =
  'GitHub App credentials are present on the API process. The install/OAuth flow ' +
  'and repository, commit and pull-request actions are not implemented in this ' +
  'build, so no GitHub request can be made yet.'

function hasValue(value: string): boolean {
  return value.trim().length > 0
}

export function describeGithubConfig(config: AppConfig): GithubStatus {
  const present = {
    appId: hasValue(config.GITHUB_APP_ID),
    privateKey: hasValue(config.GITHUB_APP_PRIVATE_KEY),
    clientId: hasValue(config.GITHUB_CLIENT_ID),
    clientSecret: hasValue(config.GITHUB_CLIENT_SECRET),
    callbackUrl: hasValue(config.GITHUB_CALLBACK_URL),
  }

  const missing: string[] = []
  if (!present.appId) missing.push('GITHUB_APP_ID')
  if (!present.privateKey) missing.push('GITHUB_APP_PRIVATE_KEY')
  if (!present.clientId) missing.push('GITHUB_CLIENT_ID')
  if (!present.clientSecret) missing.push('GITHUB_CLIENT_SECRET')
  if (!present.callbackUrl) missing.push('GITHUB_CALLBACK_URL')

  return {
    configured: missing.length === 0,
    missing,
    present,
    actionsAvailable: false,
    note: missing.length === 0 ? PRESENT_NOTE : MISSING_NOTE,
  }
}
