# Technical audit — CodePilot Lab

**Audit date:** 2026-11-11  
**Scope:** the repository at `C:\Users\19rag\Code\codepilot-lab` (uncommitted working tree).  
**Purpose:** establish the real current state before Milestone 1, identify root causes, and
separate what exists from what is still promised by the interface.

> This document reports only what was inspected or executed. It does not claim that a
> deployed service, a real terminal, GitHub integration, multi-user isolation, or a
> production AI gateway exists. Where a capability is absent, that is stated as absent.

---

## 0. Verdict

| Question | Answer |
| --- | --- |
| Is the frontend usable as a local, single-user lab? | **Yes, with limits.** The editor, stored projects, local execution, tracer and converter UI are real. |
| Is there a running application backend? | **No.** `server/api/` is an incomplete TypeScript scaffold: no entry point, no route wiring, no tests, not typechecked by the root build. |
| Is AI production-safe today? | **No.** The browser calls user-configured providers directly; BYO keys can be persisted in plaintext IndexedDB. |
| Is the execution runner a sandbox? | **No.** It is a loopback-only, resource-limited local runner with process-tree kills and timeouts. Code runs with the operator's OS permissions. |
| Is there a terminal? | **No.** The Terminal tab honestly reports that no shell exists. |
| Is there GitHub integration? | **No.** No OAuth/App flow, token storage, clone, branch, commit, push or PR code exists. |
| Can users edit their device files? | **Partially, read-only.** A selected folder can be scanned and re-read as a fallback; there is no disk write-through, Save As, export or drag-and-drop. |
| Is the product multi-user? | **No.** Projects, settings and practice data are browser-local. No accounts, sessions or server-side isolation are active. |
| Is it production-ready? | **No.** It is a frontend beta. Public deployment, cloud AI, cloud files, terminal, GitHub and multi-user data isolation are not implemented or verified. |
| Overall status | **NOT PRODUCTION READY.** Frontend beta only, with the documented local-only limits. |

---

## 1. Method and evidence

Inspected: `src/**`, `server/**`, `public/**`, `docs/**`, root config, `vercel.json`,
`package.json`, tests and build output. Executed on 2026-11-11:

| Gate | Command | Result |
| --- | --- | --- |
| Frontend typecheck | `npm run typecheck` | **Pass** |
| Unit tests | `npm test` | **Pass — 4 files, 35 tests** |
| Lint | `npm run lint` | **Fail — 6 errors, 2 warnings** |
| Production build | `npm run build` | **Pass** with the existing large-chunk warning |
| Backend typecheck | `npx tsc -p server/api/tsconfig.json` | **Fail — 7 errors** |
| Production dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Full dependency audit | `npm audit` | **10 moderate** (dev toolchain) |
| Secret scan of `dist/` | patterns for `sk-…`, `ghp_…`, `AIza…`, private keys, `MANAGED_AI_*` | **0 matches** |

The 35 tests cover stored paths, feedback, diffing and the executor request contract. There
are **no tests** for conversion parsing/end-to-end conversion, AI gateway behaviour, auth,
project isolation, API routes, terminal or GitHub.

---

## 2. Architecture as it exists

```
Browser (React 19 + Vite, no router server)
├── app shell / routes / palette / status bar
├── Command Center ......... projects in IndexedDB (Dexie v4)
├── Workspace .............. Monaco, tree, tabs, dirty buffers, Copilot dock
├── AI Copilot ............. browser → user-configured provider (direct fetch)
├── Converter .............. browser → same provider, parser + LCS diff
├── Execution Lab .......... HTTP → 127.0.0.1:5310 (manual start)
├── Practice ............... local catalog + local sidecar grading
├── Settings ............... provider URL/model/key in an external store
└── Feedback ............... IndexedDB first, optional endpoint POST

Local sidecar (Node, loopback, started with `npm run exec`)
├── /health /run /trace /grade /cancel /problems
├── executor.mjs ........... runtime probes, temp dirs, compile/run, tree-kill
├── trace_python.py ........ real sys.settrace recorder (Python only)
└── problems.mjs ........... hidden practice suites, never bundled

Server API scaffold (TypeScript, NOT runnable)
└── server/api/src/** ...... config, pg/memory stores, auth, rate limits,
                            encrypted credentials, provider client, routes
    Missing: app.ts, index.ts, wiring, scripts, tsconfig reference, tests, docs.
```

### Frontend structure

- `src/app/` — `App.tsx` routes, `AppShell`, sidebar, top bar, palette, mobile dialog,
  status bar. Route metadata is centralized in `src/app/routes.ts`.
- `src/features/` — command center, workspace, copilot, converter, execution, practice,
  settings, feedback, placeholder.
- `src/design-system/` — CSS Modules primitives and tokens. No Tailwind.
- `src/lib/` — Dexie storage, import, path validation, focus trap, formatting.
- Monaco and Three.js are lazy chunks. `monacoSetup` 1.26 MB, `editor.api` 2.74 MB and
  `CoreScene` 918 kB remain large; the warning is real but not a functional failure.
- History API routing works on the static host through `vercel.json` rewrites.

### What is genuinely real in the frontend

- Monaco editing with owned models, dirty tracking, save/save-all/find/reveal.
- Persisted project tree and contents in IndexedDB, including legacy migration.
- Folder import through the File System Access API or `webkitdirectory`, with explicit
  exclusions and a scan cap.
- Local execution and Python tracing through the sidecar, with real output and errors.
- Practice grading against hidden local suites (hidden data stays in `server/problems.mjs`).
- Conversion request/streaming/diff/accept/save-as-new/replace-with-confirmation UI.
- Honest empty, unavailable and reduced-motion states in most surfaces.

---

## 3. Findings, root causes and ratings

Severity: **Critical** = blocks the stated production goal or creates a security exposure;
**High** = a core promised capability is missing or unsafe; **Medium** = a real usability or
robustness defect; **Low** = hygiene/documentation.

### C1 — No active multi-user backend, accounts or isolation (Critical)

**Current state.** There is no running API. `server/api/src` contains a partial design:
PostgreSQL migration `001_init.sql` with `users`, `sessions`, `projects`, `project_files`,
`user_settings`, `ai_connections`, `ai_usage_events` and `ai_usage_daily`; memory and pg
stores; auth, password hashing, session cookies, rate limiting, encrypted credentials and
route modules. But there is no `app.ts`, no `index.ts`, no store wiring, no root scripts, no
API tsconfig reference, no `.env.example`, no tests and no documentation. The root
`tsconfig.json` only references the app and node configs, so the API is not part of
`npm run typecheck`.

**Root cause.** The API was started bottom-up (types → stores → routes) and stopped before
composition and entry-point work. Because the frontend still reads Dexie directly, nothing
forces the API to be complete.

**Consequences.** No user owns a project server-side. No session protects an API route in
practice. No data isolation can be tested. Account deletion exists only as an unwired route
handler. The current product is single-browser, single-user by construction.

**Evidence.** `server/api/tsconfig.json` exists but is not referenced by `tsconfig.json`;
`npx tsc -p server/api/tsconfig.json` fails with 7 errors; `package.json` has no API script.

**Remediation.** Milestone 6, but the API foundation must compile and run earlier so the AI
gateway (Milestone 1) has a home. Recommended order: finish composition and tests in
Milestone 1; add PostgreSQL deployment and the full user surface in Milestone 6.

### C2 — Local execution is not a sandbox (Critical for any public use)

**Current state.** `server/index.mjs` binds to `127.0.0.1:5310` by default, rejects wildcard
CORS, has a 2 MB body cap, a concurrency cap (default 2, max 4), compile/run timeouts, output
caps, per-job temp directories and tree-kill cancellation. A remote bind requires both
`EXEC_ALLOW_REMOTE=1` and `EXEC_TOKEN`. It is still a normal OS process running submitted
code as the operator.

**Root cause.** The runner was designed as a local developer convenience, not an isolation
boundary. There is no container, VM, seccomp/AppContainer, user separation, filesystem jail
or network egress control.

**Consequences.** Submitted code can read the user's files, environment and network. It is
unacceptable as a public cloud execution service. The UI and docs already disclose this;
that disclosure must be preserved.

**Remediation.** Milestone 4. Keep the local runner as a companion capability. Add a separate
isolated cloud execution service (per-user container/VM, no host mounts, egress policy, CPU/
memory/PID limits, TTL cleanup) or explicitly do not offer cloud execution. Never expose the
current runner to the internet.

### C3 — BYO API keys are browser-held and can be stored in plaintext (Critical)

**Current state.** `settingsStore.ts` keeps provider settings in memory and, when
“remember in this browser” is checked, writes the API key as plaintext JSON into IndexedDB
under `copilot.provider.v1`. `sanitizeSettings` drops the key only when `rememberKey` is
false. The key is sent directly from the browser to the user's base URL in the
`Authorization: Bearer` header (`providers/http.ts`). Keys are not written to `localStorage`
and are not logged by application code.

**Root cause.** Phase 5 chose a browser-only architecture with no secret store. IndexedDB
has no encryption at rest tied to the user; any script running on the origin (XSS, a
malicious dependency, a browser extension with the right permissions, or a shared device
profile) can read the value. The “remember” option is an explicit user choice, but the UI
must not imply that it is encrypted.

**Consequences.** A stolen browser profile or an XSS bug exposes the user's provider key.
The key also travels browser → provider, so the provider and any network intermediary see
it (expected for BYO, but it must be disclosed).

**Exposure assessment.** No platform-managed key is present in source or `dist/`; the secret
scan found no `sk-…`, `ghp_…`, `AIza…`, private key or `MANAGED_AI_*` material. No evidence of
a leaked committed key was found. **If any key was ever pasted into a build-time
`VITE_*` variable or committed, revoke it**; none was found in this tree. The current risk is
user-owned BYO keys in IndexedDB, not a leaked platform key.

**Remediation.** Milestone 1: managed AI through the server gateway; BYO keys encrypted on
the server (existing `CredentialCipher`) when the user opts in; direct browser transport kept
only as an explicitly labelled advanced/local mode, with a clear warning and no false claim
of secure storage. Remove the IndexedDB plaintext key path or gate it behind Developer Mode.

### C4 — GitHub integration is entirely absent (Critical for the stated product)

**Current state.** No `octokit`, OAuth callback, GitHub App, token storage, repository
listing, clone, branch, commit, push, pull, history or pull-request code exists in `src/` or
`server/`. `docs/` only mentions GitHub as a hosting option.

**Root cause.** The integration was never in the Phase 1–7 scope. Nothing currently
pretends it exists, which is correct, but the new mission requires it.

**Remediation.** Milestone 5. Recommended: a GitHub App with short-lived installation tokens,
server-side private key, minimum permissions (`contents`, `metadata`, and pull requests only
if PR workflows are in scope), verified connection state from a real API call, and no token
in the browser. A plain OAuth App is an alternative but yields long-lived user tokens and
coarser permissions; the App is the better default.

### H1 — AI has no gateway, managed mode, quotas or cost control (High)

**Current state.** `CopilotContext`, `QuickAiPanel`, `ConverterPage` and `convert.ts` call
provider adapters directly. Adapters are `ollama` (NDJSON `/api/chat`) and
`openai-compatible` (SSE `/chat/completions`). There is a per-tab `busyRef` guard, abort
support, request timeouts in some paths, and classified errors. There is no server-side
managed provider, authentication, per-user usage, rate limit, budget, queue, retry policy or
provider concurrency control.

**Root cause.** The AI feature predates the backend requirement and was designed for a
single local user with their own endpoint.

**Consequences.** Ordinary users must configure a URL, model and key. There is no way to
offer “CodePilot AI” without shipping a key (which must never happen). There is no cost
ceiling. Provider failure handling exists but is not centrally observable.

**Remediation.** Milestone 1. The scaffold already has a sound shape: `AiService` resolves
managed/BYO, encrypts BYO credentials, enforces daily/monthly quotas, records estimated
usage, and `ProviderClient` has an SSRF guard, timeouts and SSE/NDJSON parsing. Finish it,
wire it, test it, then move the frontend behind an `AiGatewayClient`.

### H2 — Conversion is real but not reliably validated (High)

**Current state.** `ConverterPage` has source modes (project/editor/paste), language
selection, swap, streaming, abort, an LCS diff, accept/reject, copy, download, notes,
warnings, history, save-as-new, and a replace flow that requires a second confirmation.
`convert.ts` builds a strict prompt and parses a fenced block plus `### Notes` /
`### Approximations`.

**Root causes of the remaining unreliability.**

1. **Parser ambiguity.** `/```[^\r\n`]*\r?\n([\s\S]*?)```/` takes the first fence anywhere in
   the reply. Prose or an example fence before the answer wins; code containing a triple
   backtick closes early; multiple fences are not disambiguated. `tail` is taken after the
   first fence only.
2. **No content validation.** A fenced block containing only whitespace, a comment, or a
   truncated fragment is accepted as `code`. There is no minimum-length, brace/indent or
   language sanity check, and no “did the model actually translate?” check.
3. **Failure vs. partial success.** On provider failure the UI sets `convertError` and stores
   a failed history record, but the streamed partial text is not promoted into a reviewable
   `outcome`; the user sees an error and loses the partial answer.
4. **Browser transport.** It uses the same direct provider path as the Copilot, so it inherits
   C3/H1 and is unavailable to ordinary managed-AI users.
5. **No end-to-end tests.** Only `diff.test.ts` exists. `parseConversionResponse` has no
   tests.
6. **History semantics.** A conversion is written to history before the user accepts it, so
   rejected conversions remain in history. That may be intentional, but the UI must label it
   as “generated”, not “saved”, and the distinction needs to be explicit.

**Remediation.** Milestone 1. Rewrite parsing defensively (prefer the first fence after the
answer marker, handle multiple fences, detect unclosed/empty output), add validation and
tests, route through the gateway, preserve partial output for review, and keep the
never-overwrite-without-confirmation rule.

### H3 — Cloud terminal is still absent; the local terminal now exists (High)

**Status (Milestone 3).** The local half is implemented and verified: the workspace Terminal
tab opens a real PTY (`node-pty`/ConPTY) hosted by the loopback sidecar over a WebSocket,
guarded by an Origin allow-list and a per-start pairing token printed only on the service
console. The UI says it is a shell on the host machine, not a sandbox. See §13 for the
protocol, evidence and limits.

The cloud half is still absent. It is rendered as a disabled “Cloud · unavailable” control with
the reason “No cloud terminal runtime is configured in this build”; there is no fake prompt.
A hosted terminal still needs authenticated API → per-user container/VM → PTY, CPU/memory/PID/
time limits, no host mounts, egress policy and TTL cleanup.

**History.** Before Milestone 3, `DevelopmentPanel.tsx` rendered an honest empty state (“No
terminal session”) and disabled “Start terminal · unavailable”. That was correct then and has
now been replaced by a real connection flow, not by simulated output.

**Rule retained.** Do not present `/run` as a shell. Do not expose an unauthenticated terminal.
The local bridge is genuine shell access on the operator's machine, not cloud isolation.

### H4 — Device file access is read-only and incomplete (High)

**Current state.** `projectImport.ts` scans a user-selected directory (`showDirectoryPicker`)
or a `webkitdirectory` input, excludes vendored directories, caps files/depth and reports the
cap. `projectStorage.ts` reads saved content first and falls back to the linked folder handle
for files whose content was never stored. The project record keeps the handle, so a
re-permission prompt is possible on read. There is **no** `createWritable`,
`showSaveFilePicker`, `showOpenFilePicker`, drag-and-drop, project archive export/import,
upload/download fallback, or reconnect UI beyond the implicit handle read.

**Root cause.** IndexedDB was declared authoritative for editing, and disk write-through was
deferred. The File System Access API is not available in all browsers, so a fallback was
also deferred.

**Consequences.** The UI must not say “saved to your folder”. A user who edits an imported
file changes the IndexedDB copy, not the device file. Revoked permissions surface as a read
failure, but there is no guided reconnect.

**Remediation.** Milestone 3. Add Open Folder/Open File, Save/Save As/Export, drag-and-drop,
permission revocation handling, a download/upload fallback and an explicit storage-origin
badge on every project (Browser-persisted / Device folder / Import / Cloud).

### H5 — API scaffold is not buildable or lint-clean (High)

**Current state.** As of this audit:

```
npx tsc -p server/api/tsconfig.json
  aiService.ts: 'MANAGED_AI_PROVIDER' does not exist on AppConfig (x2)
  passwords.ts: Expected 3 arguments, but got 4 (x2)
  router.ts: 'hashSessionToken' declared but never read
  aiRoutes.ts: 'RequestContext' declared but never read
  projectRoutes.ts: 'requireUser' declared but never read
```

`npm run lint` now fails because the scaffold is included by `eslint .`:

```
6 errors: no-useless-assignment, no-unused-vars (x3), no-control-regex
2 warnings: react-refresh in CopilotContext.tsx and EditorCommandsContext.tsx (pre-existing)
```

**Root cause.** The scaffold was added without adapting the root configs and without a
composition root. The `AppConfig` type intentionally omits `MANAGED_AI_PROVIDER`, but
`AiService` still reads it; `scrypt`/`timingSafeEqual` calls have a wrong arity; unused
imports remain.

**Consequence.** The repository's advertised quality gate (`npm run lint`) no longer passes.
This must be fixed before adding features, and the API must get its own scripts and tests.

**Remediation.** Milestone 1, first task: fix types, add `app.ts`/`index.ts`, wire routes,
add `typecheck:api`, `dev:api`, `test:api`, ESLint Node globals/config, and a `.env.example`.

### M1 — New Project language dropdown closes while scrolling (Medium)

**Current state.** `ProjectDialog` uses the custom `Select` for the primary language.
`Select` portals a fixed-position menu with `maxHeight` and (in CSS) an overflow container.
`Select.tsx` registers `window.addEventListener('scroll', onScroll, true)` and closes the
menu on **any** captured scroll.

**Root cause.** Capture-phase scroll handling is too broad. Scrolling the menu's own option
list, or scrolling the modal to reach the control, dispatches a scroll event that the window
capture listener sees, so the menu closes before the user can reach lower options. This is a
code-level cause, not a z-index or contrast cause; the menu contrast is explicitly set.

**Secondary risks to verify.** The dialog panel is `max-height: calc(100dvh - 56px)` with
`overflow-y: auto`, which is sound in principle, but the overlay padding and very short
viewports need measurement. The language selector must remain keyboard reachable
(Arrow/Home/End/Enter/Escape already implemented).

**Remediation.** Milestone 2. Ignore scroll events originating inside the menu, close only on
an ancestor scroll that actually moves the trigger, and add viewport tests at short heights.

**Resolved** in Milestone 2 — see §12.

### M2 — Editor action bar is incomplete (Medium)

**Current state.** `EditorArea` shows tabs, file identity, language, Saved/Unsaved and
actions for Attach/Explain/Copy path/Save/Save all/Find/Wrap/Minimap/Theme. Execution lives
only in the bottom `Run` tab (`WorkspaceRunPanel`). There is no top-level Run, Debug/Trace,
Format or More menu.

**Root cause.** The toolbar predates the execution feature; Run was added to the development
panel rather than integrated into the editor surface. Format is not implemented as an editor
command (Monaco's formatting providers are not the same as a product “Format” action).

**Remediation.** Milestone 2. Add Run / Debug-Trace / Save / Save All / Format / Find / More
to the action bar, keep terminal/output/problems/diagnostics in the bottom panel, wire Run to
the current draft through `EditorCommandsContext`, and disable actions honestly when a
runtime or formatter is unavailable.

**Resolved** in Milestone 2 — see §12.

### M3 — CSP allows any connect target (Medium)

**Current state.** `vercel.json` sends `connect-src *` because BYO providers and the loopback
runner can be arbitrary origins. Scripts are `'self'`, frames are denied, and there is no
`unsafe-eval` (Monaco workers are bundled).

**Root cause.** A static CSP cannot know the user's provider URL at build time. The broad
`connect-src` is a deliberate trade-off, but it weakens exfiltration protection.

**Remediation.** Milestone 1/6. Once the managed gateway is the default, tighten `connect-src`
to the API origin plus loopback, and move arbitrary BYO endpoints behind an explicit
Developer Mode with a documented, narrower policy where possible.

### M4 — No public-deployment story for AI or execution (Medium)

**Current state.** The default deployment is a static frontend. AI runs in the browser;
execution requires a local sidecar. There is no hosted API, PostgreSQL, object storage,
secret manager, monitoring, backup, job queue or autoscaling configuration.

**Root cause.** Phase 7 deliberately shipped a frontend-only beta. The new requirements
supersede that posture but no infrastructure exists yet.

**Remediation.** Milestones 1, 4, 6 and 7. Keep local and cloud modes explicit in the UI and
document exactly which dependencies are required.

### M5 — No account export (Medium)

**Current state.** The scaffold has account deletion (`DELETE /api/account`, password
confirmed) but no export endpoint. The frontend has no account UI.

**Root cause.** The API surface was drafted around the minimum auth flows; export was not
implemented.

**Remediation.** Milestone 6. Add a server-side export (projects, files, settings minus
secrets, usage) and prove deletion cascades through every table.

### L1 — Lint warnings and inconsistent config (Low)

Two `react-refresh/only-export-components` warnings are pre-existing. The API scaffold is
picked up by the browser-globals ESLint config, which is wrong for Node code. Fix with an
ESLint override for `server/**` and split the context exports if desired.

### L2 — Docs and version describe the old product (Low)

`README.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/security.md` and
`docs/production-readiness.md` describe a frontend-only Phase 7 product. They do not mention
the API scaffold, the new managed/BYO split, or the missing cloud/terminal/GitHub work. The
version is `0.7.0`. Update after each milestone; do not rewrite history as if features
already exist.

### L3 — Dev-toolchain advisories (Low)

`npm audit --omit=dev` reports 0. The full audit reports 10 moderate advisories in the dev
toolchain. They do not affect the production bundle, but should be tracked and resolved when
upstream fixes are available. Do not run `npm audit fix --force` blindly.

---

## 4. Area-by-area status

### 4.1 AI provider request flow

1. Settings are loaded from Dexie (`copilot.provider.v1`) into an external store.
2. `CopilotContext.send` assembles `buildSystemPrompt` + history + `buildUserPrompt` from a
   context bundle (active file, selection, tree names, Monaco markers, explicit attachments,
   character budget).
3. `adapterFor(provider).stream` calls the provider directly with `fetch`.
4. Deltas are batched into React state every 40 ms; proposals are parsed from fenced
   ` ```codepilot path="..." mode="..." ` blocks.
5. Errors are classified (`aborted`, `auth`, `rate-limit`, `network`, `timeout`,
   `not-found`, `provider`, `invalid-settings`) and surfaced in the dock.
6. Conversion uses the same adapters with its own prompt and parser.

**Missing:** managed mode, authentication, quotas, usage, server-side credentials, provider
concurrency, retries, queueing, central logging, cost ceilings.

### 4.2 API-key storage and transmission

| Location | Current behaviour | Risk |
| --- | --- | --- |
| Frontend source / `dist/` | No platform key found | None found |
| Tab memory | BYO key held in the settings store | Acceptable for session use |
| IndexedDB `settings.copilot.provider.v1` | Plaintext JSON when “remember” is on | **High** |
| `localStorage` | Not used for keys | None |
| Browser → provider request | `Authorization: Bearer` to the user's base URL | Expected for BYO; must be disclosed |
| Logs/errors | No application logging of keys found; provider error bodies are truncated and shown | Residual risk if a provider echoes a key |
| API scaffold | AES-GCM encrypted `encrypted_api_key`, last-4 only returned | Design is sound but not running |

**Revocation guidance.** Because no platform key was found, no revocation is currently
required on the evidence available. If a key was ever placed in a `VITE_*` variable, a
committed `.env`, a screenshot or a build artifact, revoke and rotate it now. The new
architecture must make that class of exposure impossible.

### 4.3 Execution service

| Control | Reality |
| --- | --- |
| Bind | Loopback by default; remote requires `EXEC_ALLOW_REMOTE=1` + `EXEC_TOKEN` |
| Auth | Bearer token only on remote binds |
| CORS | Explicit allow-list; wildcard rejected |
| Body cap | 2 MB |
| Concurrency | Default 2, capped at 4, returns 429 when busy |
| Timeouts | Compile/run limits in `executor.mjs` |
| Cancellation | Job id → tree-kill |
| Output caps | Yes |
| Isolation | Temp directory per job, but **no OS/container sandbox** |
| File restriction | No approved-workspace jail; code can access the operator's filesystem |
| Runtimes | Python, JavaScript, TypeScript, C, C++, Java (probed at startup) |
| Tracer | Python only (`sys.settrace`); other languages explicitly unsupported |
| Public suitability | **No** |

### 4.4 Persistence

- Dexie database `codepilot-lab`, schema v4: `projects`, `files`, `contents`, `settings`,
  `conversions`, `practiceProgress`, `practiceSubmissions`, `feedback`.
- Stored content is authoritative after first save. Linked folder handles are a read
  fallback only.
- Layout/preferences are in `localStorage`; drafts for non-workspace editors are in
  `localStorage`.
- Feedback is written locally first; an optional endpoint POST is attempted and its real
  outcome recorded.
- No server database is running. The PostgreSQL schema exists only as an unapplied SQL file.
- No backup, export or quota-management UI.

### 4.5 Authentication

- Frontend: none. No login, session, account or user identity.
- API scaffold: email/password registration and login, scrypt password hashing, hashed
  session tokens in a `users`/`sessions` design, HttpOnly/SameSite cookies, CSRF origin
  checks, session TTL, password change, account deletion.
- Not runnable, not tested, not integrated. No OAuth/SSO, email verification, password reset,
  MFA or abuse protection beyond in-memory rate limits.

### 4.6 Deployment readiness

| Capability | Ready? | Evidence |
| --- | --- | --- |
| Static frontend build | Yes | `npm run build` passes |
| SPA rewrites and security headers | Configured | `vercel.json` |
| Public SEO site | Yes | `public/*.html`, sitemap, robots |
| API hosting | No | No entry point or deployment config |
| PostgreSQL | No | Not installed; migration unapplied |
| Object/file storage | No | No implementation |
| Secret manager | No | `.env` only, no example |
| AI gateway | No | Scaffold only |
| Cloud execution | No | Local sidecar only |
| GitHub | No | Absent |
| Monitoring/backups | No | Absent |
| E2E in CI | No | No CI config; manual checks only |

**Verdict: NOT PRODUCTION READY.** The correct label for the current tree is “frontend beta
with a local companion”.

---

## 5. Architecture decisions requiring confirmation

These are the irreversible or costly choices. Recommendations are ordered.

### 5.1 Terminal

| Option | Strengths | Costs/risks | Recommendation |
| --- | --- | --- | --- |
| Local companion PTY | Genuine local shell; no cloud cost; works with the user's toolchain | Installer/signing, pairing, origin lock, Windows/macOS/Linux packaging, user trust | **Implement first** as the Local mode |
| Cloud per-user terminal | Works for hosted users with no install; centrally controlled | Container/VM orchestration, PTY streaming, isolation, idle cleanup, abuse/cost control | **Design now, implement after the gateway and auth** as the Cloud mode |

Both can share one UI with an explicit mode badge. Do not route arbitrary commands through
the existing `/run` endpoint.

### 5.2 GitHub

| Option | Strengths | Costs/risks | Recommendation |
| --- | --- | --- | --- |
| GitHub App + installation tokens | Fine-grained permissions, short-lived tokens, org-friendly | App registration, private key management, webhook/callback infrastructure | **Recommended** |
| OAuth App | Simpler callback | Long-lived user tokens, broader scopes, harder to scope per repository | Fallback only |

Either way: secrets stay server-side, the frontend never sees a token, connection status is
derived from a real API call, and token revocation is handled.

### 5.3 AI gateway

- Managed mode: server-side provider key, per-user quotas, usage metering, rate limiting,
  timeouts, provider error mapping, SSE streaming, safe retries, concurrency caps.
- BYO mode: encrypted server-side storage by default; direct browser transport only as an
  explicitly labelled advanced mode with a warning and no claim of encrypted storage.
- The existing scaffold is a good base; finish it rather than starting over.

---

## 6. Milestone plan (entry → exit)

**Milestone 0 — Audit (this document).** Exit: findings, root causes, risks and decisions
recorded. Done when this file is reviewed.

**Milestone 1 — Secure AI gateway + conversion.**
Entry: decisions on managed provider and hosting. Work: make `server/api` compile and run;
add `app.ts`/`index.ts`, scripts, tests, `.env.example`, Node ESLint config; wire auth/session
for the gateway; finish managed/BYO, encryption, quotas, usage, rate limits, SSE; add a
frontend gateway client and a mode selector; keep a clearly labelled local/BYO fallback;
fix the converter parser, validation, partial-output handling and tests. Exit: real managed
and BYO requests verified against a configured provider; quota and failure cases tested;
conversion accept/reject/save-as-new/replace verified; typecheck, lint and tests pass.

**Milestone 2 — Editor UX and New Project.**
Entry: none beyond the current tree. Work: fix `Select` scroll-close root cause; test modal
at short/tablet/mobile heights; add the action bar (Run, Debug/Trace, Save, Save All, Format,
Find, More); wire Run to the live draft; keep the bottom panel; verify resize/collapse.
Exit: every language reachable by mouse and keyboard; no clipped dialog; action bar usable
at 912×766 and 1440×1000.

**Milestone 3 — Device files.**
Entry: browser support matrix agreed. Work: Open Folder/Open File, Save/Save As/Export,
drag-and-drop, permission-revoked flow, download/upload fallback, storage-origin badges,
unsaved-change warnings. Exit: a real file edit is written to disk only with explicit
permission; IndexedDB remains distinguishable; revocation is tested.

**Milestone 4 — Terminal and execution.**
Entry: terminal decision confirmed. Work: chosen architecture, process lifecycle, output,
cancellation, isolation/limits, expiry, UI states. Exit: a real command runs and is killed;
the runner is never presented as a shell; public exposure is either isolated or absent.

**Milestone 5 — GitHub.**
Entry: App/OAuth decision and credentials. Work: connect/disconnect, repo selection, import,
clone, branches, commits, push/pull, changed files, history, supported PR flow, token
revocation. Exit: a verified connection performs a real round trip; no token reaches the
browser or logs.

**Milestone 6 — Multi-user backend and deployment.**
Entry: hosting, PostgreSQL and storage available. Work: auth UI, owned projects, isolation,
sessions, file storage, gateway, usage, limits, abuse protection, concurrency, monitoring,
backups, account export/deletion. Exit: two users are proven unable to read each other's
projects, AI requests or credentials; deletion/export are tested.

**Milestone 7 — E2E and release verification.**
Entry: all prior milestones merged. Work: the 17 journeys, typecheck/lint/unit/integration/
build/security/browser E2E, deployment smoke tests, honest release notes. Exit: evidence
supports each claim; anything unverified stays labelled unverified.

---

## 7. Test coverage gaps to close

| Area | Current | Required |
| --- | --- | --- |
| Stored paths | Covered | Keep |
| Feedback | Covered | Keep |
| Diff | Covered | Keep |
| Executor request validation | Covered | Keep |
| Conversion parser | **None** | Fenced/unclosed/multiple/empty/prose/pre-fence cases |
| Conversion E2E | **None** | Python→JS, C→Python, save-as-new, replace confirmation, provider failure |
| AI gateway | **None** | Managed/BYO, quota, rate limit, timeout, abort, usage, SSE |
| Auth/isolation | **None** | Two-user cross-access denial, session expiry, CSRF |
| Editor UX | Manual only | Viewport/keyboard checks, dropdown scrolling |
| Device files | Manual only | Permission revoke, save-as, export, fallback |
| Terminal | **None** | Real command, cancellation, cleanup |
| GitHub | **None** | Connect, clone, commit, push, revoke |

---

## 8. Unresolved / blocked

- **Live AI validation** needs a provider credential and the running gateway.
- **PostgreSQL** is not installed, so migration and pg-store integration cannot be executed
  here. Memory store tests are possible; deployed database tests are not.
- **Hosting/CSP/redirect** checks need a real domain and host.
- **GitHub** needs an App/OAuth registration and secrets.
- **Terminal** needs the architecture decision and, for cloud, container infrastructure.
- **Feedback endpoint** is unset, so remote delivery remains unverified.
- **Full audit** has 10 moderate dev-toolchain advisories; production dependencies are clean.

---

## 9. Non-claims

This audit does **not** claim: a working backend, user accounts, data isolation, cloud AI,
managed quotas in production, a terminal, GitHub integration, cloud file storage, disk
write-through, a sandbox, production deployment, or verified end-to-end journeys. The UI’s
honest “unavailable” states should remain until each capability is real and tested.

---

## 10. Decisions confirmed after the audit

| Decision | Choice | Consequence |
| --- | --- | --- |
| Terminal | **Local companion + cloud terminal, both** | Milestone 4 must ship both modes behind one UI with an explicit mode badge. The local PTY companion and the isolated cloud PTY are separate services; neither is the existing `/run` endpoint. |
| GitHub | **GitHub App** | Short-lived installation tokens, server-side private key, minimum permissions (`contents`, `metadata`, and pull requests only if PR workflows are in scope). No token in the browser or logs. |
| AI default | **Managed CodePilot AI first, BYO second** | The gateway is the default preset. The direct browser provider remains an explicitly labelled advanced/local fallback, not the primary path. |
| Terminal cloud infrastructure | Deferred to Milestone 4 execution | Requires container/VM infrastructure and is not available in this environment. |

---

## 11. Milestone 1 status (AI gateway + conversion)

Implemented and executed on 2026-11-11:

- `server/api` now has a composition root (`app.ts`), a runnable entry point (`index.ts`), a
  root `typecheck`, `api:dev`, `api:start`, `api:migrate`, `test:api` scripts, an ESLint
  Node override, `.env.example`, and 12 API tests.
- `/api/health` reports the real store (`memory` vs `postgresql`), durability, managed-AI
  availability and whether the credential key is ephemeral. It no longer claims
  PostgreSQL when the process uses memory.
- The frontend has a gateway client (`src/features/copilot/gateway/client.ts`) and store
  (`store.ts`): same-origin or `VITE_API_BASE_URL`, `credentials: include`, real health +
  session probes, SSE chat parsing, and structured error mapping.
- A `gateway` provider kind and a `codepilot` preset are now the defaults. Managed mode
  hides URL/model/key fields; the direct-provider form remains for advanced use.
- A `route: 'gateway' | 'direct'` setting separates *where* a request runs from *which*
  provider it uses, so a BYO provider can be called by the API with a server-held
  encrypted key or by the browser in advanced mode. The route control is disabled until
  the session probe answers, and a signed-out save persists `direct` rather than
  attempting a call that must fail.
- `/settings` has a minimal account surface: sign in, create account, sign out, and real
  usage/quota readouts. It is not a full account centre (see non-claims).
- Conversion parsing is rewritten: multi-fence selection scored by language tag and
  length, unclosed-fence detection, empty/comment-only detection, delimiter-balance
  warning, notes/approximations extraction, and a hard warning cap.
- Conversion failures now retain partial output as a reviewable `ConversionFailure`
  instead of discarding the streamed text.
- New tests: 11 parser cases plus 3 gateway conversion cases (streamed success, partial
  failure, incomplete stream).

Browser-verified on the running API + Vite pair (in-app browser, real requests):

- Account created through `POST /api/auth/register`; session visible; sign-out and
  sign-in both worked; `/api/ai/status` returned real usage `0`.
- Managed mode with no server provider reported "No AI provider is available" plus the
  server's reason. Test connection returned that same reason — no false success.
- A BYO Ollama draft with "Send through the CodePilot API" saved via
  `PUT /api/ai/connection`; `/api/ai/status` then reported the saved connection
  (`provider: ollama`, `model: llama3`, `hasKey: false`) and mode `byo`.
- The saved IndexedDB settings contained `"route":"gateway","apiKey":"","rememberKey":false`
  — no provider key in the browser.
- Test connection called `POST /api/ai/connection/test` (server-side probe) and returned
  "The provider endpoint could not be reached (TypeError)." with copy stating the API
  tried it from the server. The browser never contacted the provider host.
- A conversion through the gateway failed with the same server-side message and wrote a
  `FAILED` history row with the real provider, model and duration.
- Signed out, the route control is disabled and explains why; saving persisted
  `"route":"direct"` and made no `/api/ai/connection` call.
- `/copilot` and `/settings` report "Configured · unverified" / "Connection saved ·
  unverified" for a saved-but-untested connection instead of claiming "verified".
- No unexpected console errors; the only errors were the known execution-sidecar CORS
  preflight failure.

Executed results at the end of Milestone 1:

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck (frontend + API) | `npm run typecheck` | Pass |
| Lint | `npm run lint` | Pass with 2 pre-existing `react-refresh` warnings |
| Tests | `npm test` | Pass — 6 files, 61 tests |
| API tests | `npm run test:api` | Pass — 12 tests |
| Build | `npm run build` | Pass with the pre-existing large-chunk warning |
| Production dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |

Still unverified at the end of Milestone 1 (must not be presented as done):

- A live managed or BYO *completion* against a real provider: no provider credential is
  configured in this environment. The gateway routing, credential storage and error
  handling were exercised, but no real model ever answered.
- A partial-output conversion produced by a mid-stream provider failure in the UI: the
  class and the parser are unit-tested, but producing a real truncated stream needs a
  provider.
- PostgreSQL persistence: PostgreSQL is not installed here; only the memory store was
  exercised.
- Cloud-hosted deployment, CSP tightening and cookie/redirect behaviour on a real domain.
- Account lifecycle beyond sign-in/create/sign-out: no email verification, password reset,
  MFA, export, or full account UI yet (Milestone 6).

---

## 12. Milestone 2 status (editor UX, dropdown root cause, action bar)

Implemented and executed on 2026-11-12.

### M1 root cause — fixed

`Select.tsx` no longer closes on every captured `scroll` event:

- Scrolls that originate inside the menu's own list are ignored, so a long option list can be
  scrolled normally.
- Scrolls on ancestors reposition the portal instead of dismissing it; the menu closes only
  when the trigger itself leaves the viewport.
- `aria-activedescendant`, stable option ids, and `scrollIntoView({ block: 'nearest' })` keep
  the keyboard-active option visible without moving the page.
- The trigger is a `button` (not a styled span), so Enter/Space open it as expected.

### M2 root cause — fixed

`EditorArea` now owns a real action bar: **Run · Trace · Save · Save all · Format · Find ·
More**, in that order, before the language/dirty chips. Terminal, Output, Problems and
Diagnostics remain bottom-panel surfaces.

- `Run` / `Trace` dispatch `ui/set-pending-job` and open the Run panel; the panel consumes the
  request exactly once and performs the real call. Nothing is rendered from a click alone.
- `Trace` is enabled only when the runtime is `python`; the other five runtimes state
  "no tracer in this build — only Python is traced".
- `Format` runs `editor.action.formatDocument` on the live Monaco model and reports whether
  the buffer actually changed. `supportsDocumentFormatting()` limits it to the languages
  Monaco bundles formatters for (TS, JS, JSON, CSS, SCSS, Less, HTML); other languages answer
  "has no document formatter in this build. The buffer is unchanged." Shift+Alt+F is bound
  inside Monaco and routes through the same command.
- `More` is a portalled, non-modal menu (`EditorMoreMenu`) with word wrap, minimap, theme,
  font size, copy path, Copilot context and Explain. It repositions on ancestor scroll, closes
  on Escape / outside pointer-down / Tab (moving focus to the next tabbable, never trapping
  it), and restores focus to the trigger.
- Toolbar density is now measured against the **editor pane** with a container query
  (`container: editor-surface`). Previously the label-collapse breakpoint keyed off the
  viewport, so a 1440 px window with the explorer and Copilot dock open left the editor
  ~554 px wide while the toolbar needed 649 px — the file identity collapsed to 0 px and the
  More button overflowed beneath the dock. Measured after the fix: toolbar
  `scrollWidth === clientWidth` (554/554), identity 159 px, and with the dock closed
  (pane 895 px) all labels return with no overflow.

### Browser evidence (in-app browser 912×766, harness measured at 1440×1000)

- New Project dialog: panel 415 px tall at 1000×700, no scroll; language menu 290 px tall with
  a 251 px scroll viewport over 9 options.
- Setting the language list `scrollTop = 200` leaves the menu open (`aria-expanded="true"`).
- ArrowDown moves the active option from TypeScript to C and scrolls it into view
  (`scrollTop` 200 → 168); choosing CSS closes the menu and updates the note to
  "Editor and language services only. There is no rendering runtime in this build."
- Python project `py-lab`, file `main.py`, action bar: Run enabled, Trace enabled.
  Clicking **Run** produced `COMPLETED · 143 ms measured · exit 0 · stdout "Hello from
  CodePilot Lab"`. Clicking **Trace** produced `TRACE COMPLETE · 9 recorded events · 208 ms`
  with real `call / line / return` rows, `main=<function main …>` and the captured stdout on
  the `print` line.
- TypeScript project: Trace disabled with "TypeScript has no tracer in this build — only
  Python is traced"; Run and Format enabled.
- HTML file: Run **and** Trace disabled with "HTML has no runtime in this build"; status bar
  reads "Editor only · no runtime".
- **Find** opened Monaco's widget, found `1 of 1`, and a Replace All changed the buffer to
  `const   greeting :string='Hi'` (tab → Unsaved, Save all enabled). **Format** then produced
  `const greeting: string = 'Hi'` and the toast "Formatted main.ts." **Save** produced
  "Saved main.ts" and disabled Save all.
- The More menu opened with correct checkmarks (Minimap checked, Word wrap unchecked),
  toggled Word wrap to checked, closed on selection with focus restored, closed on Escape
  with focus restored, moved focus with ArrowDown/Home, and closed on outside pointer-down.

Executed results at the end of Milestone 2:

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck (frontend + API) | `npm run typecheck` | Pass |
| Lint | `npm run lint` | Pass with the same 2 pre-existing `react-refresh` warnings |
| Tests | `npm test` | Pass — 6 files, 61 tests |
| API tests | `npm run test:api` | Pass — 12 tests |
| Build | `npm run build` | Pass with the pre-existing large-chunk warning |

Known limits recorded at the end of Milestone 2:

- The action bar's Run path sends the live Monaco draft, which is the same code the Run panel
  uses; the panel's own "Run file" button and the bar therefore share one code path.
- Format is a no-op without a bundled provider. There is no configurable formatter (Prettier
  is not bundled), so C, C++, Java, Python and other languages report the truth instead of
  reformatting.
- Trace coverage is Python-only because `server/trace_python.py` is the only real tracer.
- The 1440×1000 layout was measured through a same-origin iframe harness inside the in-app
  browser (the pane is 912×766); it is not a headless Edge screenshot.

---

## 13. Milestone 3 status (real terminal — local companion)

Implemented and executed on 2026-11-12.

### Architecture

- `server/terminal.mjs` is a PTY hub on the existing loopback execution sidecar:
  `createTerminalHub` owns sessions, `GET /terminal/health` reports the real shell, cwd and
  limits, and `terminal.attach(server)` handles WebSocket upgrades at `/terminal`.
- `node-pty@1.1.0` spawns the platform shell (ConPTY on Windows); `ws@8.22.2` carries the
  stream. The package ships `prebuilds/win32-x64`, so no compiler is required on this machine.
- Guards: the HTTP listener stays loopback-only, the handshake requires an allow-listed
  `Origin`, and a per-start pairing token is printed only on the service console. Tokens rotate
  on every `npm run exec`; an old token is rejected after a restart.
- Limits: 2 concurrent sessions, 64 KiB frames, columns clamped to 20–400 and rows to 5–200.
- Protocol (JSON text frames):
  - server → client: `ready { shell, cwd, pid, cols, rows }`, `output { data }`,
    `exit { exitCode, signal }`, `error { message }`
  - client → server: `input { data }`, `resize { cols, rows }`, `cwd { path }`
- Changing `cwd` validates the directory and restarts the shell there, because the shell owns
  its working directory. Invalid paths come back as an `error` frame.
- Windows process kills use `taskkill /PID <pid> /T /F`; node-pty's own console-list helper
  fails when the service has no console. `closeAll()` also terminates upgraded sockets so
  `server.close()` settles.

### Frontend

- `src/features/terminal/client.ts` resolves the endpoint from
  `codepilot.exec.endpoint.v1`, keeps the pairing token in `sessionStorage`
  (`codepilot.terminal.token.v1`) so it dies with the tab, probes `/terminal/health`, and
  exposes typed frames plus `TerminalServiceError`.
- `TerminalPanel.tsx` renders the runtime badge, a disabled Cloud option with its reason,
  service status, the pairing form, the live cwd, Connect/Disconnect and the real exit code.
  It shows the exact start command and endpoint when the service is offline, and disables
  Connect until a health probe succeeds.
- `TerminalSurface.tsx` is a `React.lazy` boundary around xterm plus `@xterm/addon-fit`; the
  renderer is a separate 333.69 kB chunk (84.19 kB gzip) and is never loaded for other tabs.
  A ResizeObserver fits the grid and sends `resize`; output is buffered if frames arrive before
  the lazy chunk mounts.
- The Terminal panel stays mounted while the bottom panel is open, so switching to Run/Output
  does not kill a live shell. Closing the panel or the page ends the session.
- Cloud is a disabled button with the visible reason “No cloud terminal runtime is configured
  in this build”; it is not a fake prompt.

### Browser evidence (in-app 912×766, harness measured at 1440×1000)

- Connected with the printed token: real `Microsoft Windows [Version 10.0.26300.9818]`
  banner and `C:\Users\19rag\Code\codepilot-lab>` prompt, status `Live · pid 22400`.
- Input through xterm executed `echo code-pilot-terminal-ok` and rendered the real output.
  `exit` produced `Shell exited · code 0` and the honest session-log note.
- Switching to the Run tab and back kept the same pid and the full scrollback.
- A wrong token produced “The terminal connection closed without a handshake. The pairing token
  may not match the one printed by `npm run exec`, or the service was stopped.” and returned to
  `Not connected`.
- After restarting the service, the previous token was rejected and the new one connected
  (`Live · pid 23280`), confirming per-start rotation. Stopping the service while connected
  closed the socket; **Re-check service** then showed `Service offline`, the real endpoint and
  start command, and left Connect disabled.
- At 1440×1000 through a same-origin harness: `documentElement.scrollWidth === 1440` (no
  horizontal overflow), the session was live, and the runtime/status clusters wrapped as whole
  rows inside the 554 px editor column.

Executed results at the end of Milestone 3:

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck (frontend + API) | `npm run typecheck` | Pass |
| Lint | `npm run lint` | Pass with the same 2 pre-existing `react-refresh` warnings |
| Tests | `npm test` | Pass — 7 files, 68 tests (includes 7 terminal integration tests) |
| API tests | `npm run test:api` | Pass — 12 tests |
| Build | `npm run build` | Pass; terminal renderer isolated in a lazy chunk |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities (`ws` upgraded to 8.22.2) |

Known limits recorded at the end of Milestone 3:

- The local terminal is genuine shell access with the operator's privileges. It is **not** a
  sandbox and does not claim to be; the UI repeats this.
- Verified on Windows only. On Linux/macOS `node-pty` has no prebuild and npm's allow-scripts
  blocks its build script, so those platforms are unverified here.
- There is no installer or code signing; the user must start `npm run exec` and paste the
  console token. Sessions do not survive a page reload or a service restart.
- The cloud terminal is not implemented; the disabled Cloud control explains why.
- Output is not persisted; scrollback lives in the mounted xterm instance only.


