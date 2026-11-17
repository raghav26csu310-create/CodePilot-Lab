# Security notes

> **Status note (2026-11-17):** the authenticated API under `server/api` owns accounts,
> per-user provider configurations and AES-256-GCM encrypted BYO credentials. Provider keys
> are not stored in browser settings; legacy keys are removed when settings load. See
> [`technical-audit.md`](./technical-audit.md) §17 and [`ai-gateway.md`](./ai-gateway.md).

This document describes the public-beta security posture. It does not claim that the local
execution service is a sandbox.

## Data and secrets

- No provider key is compiled into the bundle or saved to browser storage. BYO keys are
  submitted to the authenticated API, encrypted at rest, and only key presence / last four
  characters are returned. In development, the encryption key is ephemeral unless
  `CREDENTIAL_ENCRYPTION_KEY` is configured.
- Non-secret UI preferences persist under the Dexie `settings` key `copilot.provider.v1`;
  legacy provider keys are stripped during load/migration.
- Feedback never includes project contents, API keys or analytics identifiers.
- The API provides session-cookie authentication; development defaults to an in-memory
  account store, which is not durable.
- The frontend does not use `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`.
  Model prose is rendered as text/Markdown through the existing renderer, not raw HTML.

## Execution service

Controls implemented in `server/`:

| Control | Value |
| --- | --- |
| Default bind | `127.0.0.1` |
| Remote bind | Refused unless `EXEC_ALLOW_REMOTE=1` **and** `EXEC_TOKEN` are set |
| Auth | Bearer token required on non-loopback binds |
| CORS | Explicit origin allow-list; wildcard rejected |
| Body limit | 2,000,000 bytes |
| Source limit | 200,000 characters |
| stdin limit | 64,000 characters |
| stdout/stderr limits | 96,000 / 48,000 characters |
| Compile timeout | 20 s |
| Run timeout | 8 s (request timeout clamped to 8 s) |
| Tests per request | 16 |
| Trace events | 2,500 |
| Concurrency | 1–4 jobs; excess requests receive HTTP 429 |
| Process cleanup | Fresh temp dir, tree-kill on timeout/cancel/shutdown |
| Error responses | Unexpected 500s are sanitized; details stay on the server console |

**Residual risk:** this is still a resource-limited runner with the user's OS permissions.
It is not containerized, not seccomp-filtered and not safe for untrusted public input. Do not
host it as a public execution API. The default public beta is frontend-only.

## Input validation

- Stored project paths are validated in `src/lib/storedPaths.ts` and enforced in
  `projectStorage.ts` writers (`../`, absolute paths, drive letters, control characters,
  empty segments and reserved names).
- AI proposal paths are validated independently in `proposals.ts` before a diff or write.
- Practice grading returns only case indices, hidden flags, statuses and bounded visible
  stderr. Hidden inputs, expected outputs and full hidden output are never returned.
- Feedback length limits and category/rating validation run before storage.
- The folder importer is a real scan with visible exclusion and file-count caps; it does not
  upload files.

## Error handling and leakage

- The sidecar returns structured `invalid_request`, `not_found`, `busy` and
  `internal_error` responses. Stack traces, paths and command lines are not sent to clients.
- The frontend distinguishes auth, network, provider, CORS and rate-limit failures. It does
  not retry silently or fabricate success.

## Headers and indexing

`vercel.json` sets:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: SAMEORIGIN`
- `Permissions-Policy` without camera/microphone/geolocation
- A Content-Security-Policy with `script-src 'self'`, local images/fonts, `connect-src *`
  for user-configured providers and `worker-src 'self' blob:` for Monaco workers
- `X-Robots-Tag: noindex, nofollow` on private app routes
- `meta robots noindex` in the SPA shell

Public marketing pages live in `public/*.html` and are crawlable. `robots.txt` disallows the
private app routes.

## Dependency audit

Run `npm audit --omit=dev` before each release. On 2026-11-10 the production tree reported
**0 vulnerabilities** after pinning `dompurify` to `3.4.17` with a `package.json` override.
Monaco 0.57.0 declared `dompurify@3.4.15`, which is inside published DOMPurify XSS advisory
ranges; the override replaces it without downgrading Monaco.

The full development tree still reports moderate advisories in the ESLint and
TypeScript-ESLint toolchain. Those packages are not shipped in `dist/`, and the offered
fixes are major version changes, so they are tracked rather than forced. Do not run
`npm audit fix --force` blindly.

Chrome Private Network Access preflights loopback calls from a public HTTPS page. The runner
answers `Access-Control-Allow-Private-Network: true` only when the calling origin is on
`EXEC_ORIGINS`. Browser policy still varies; running the frontend locally remains the most
predictable execution setup.

## Reporting

Use the feedback page for ordinary reports. Do not include secrets, private source or
personal data. There is no bug-bounty program and no guaranteed response time.
