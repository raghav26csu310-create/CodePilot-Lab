# Session handoff — 2026-11-17

This is the resume point for the next working session. It records what exists, what was
verified, what was not, and the exact next task. It is not a claim of production
readiness.

## Mission

## Current environment orchestration work

- Status: environment orchestration is implemented and verified for the repo's local dev stack.
- Added `npm run dev:all` to coordinate the Vite frontend, API and execution sidecar with named logs, graceful shutdown and port-conflict handling.
- Added `npm run check`, `npm run verify`, and `npm run doctor` as the local validation/reporting flow.
- Added VS Code tasks/launch/settings for the shared local dev workflow.
- Verified result: `npm run check` and `npm run verify` pass; `npm run dev:all` reports a clear conflict when the shared environment already owns `:5173` instead of starting duplicate processes.
- Remaining caveat: this machine currently has an existing listener on `[::1]:5173`, so a clean end-to-end start requires that port to be free.

## Current backend integration work

- Status: the existing API composition and route modules were preserved; no duplicate backend was introduced.
- The HTTP router now returns request-correlated error responses, logs structured request events without query strings or error messages, applies a shared API rate limit, and rejects malformed encoded path parameters as client errors.
- Health endpoints now distinguish `/api/health/live` from dependency-backed `/api/health/ready`; `/api/health` remains backward-compatible.
- API JSON bodies require `Content-Type: application/json`. Environment parsing rejects invalid boolean values, incomplete managed-AI configuration, malformed database URLs or encryption keys, non-canonical CORS origins, and non-loopback development binds.
- The shared CodePilot API browser client now applies request deadlines and caller cancellation to JSON requests, account export, and AI streaming. Execution and terminal retain their separate typed clients because they are distinct local sidecars.
- The development orchestrator and doctor now detect IPv6-only listeners as port conflicts; the existing port-5173 listener was not stopped or queried.
- Verification: `npm run verify` passes (126 frontend tests, 32 API tests, typecheck, lint and build). Lint retains the two existing React Fast Refresh warnings; the build retains the existing large-chunk warnings.


Turn CodePilot Lab into a usable, secure, scalable AI-native coding environment without
rebuilding it. Work proceeds in milestones; each one starts with inspection, affected
files and a plan, and ends with typecheck, lint, tests, build and a report of real results.

Superseded posture: the older “frontend only, no accounts” stance no longer applies.
Managed cloud AI, accounts, ownership and a server-side AI gateway are now the target.
Loopback execution stays a resource-limited local tool, not a hardened sandbox.

## Current session state

- Status: Phase 4 multi-provider AI infrastructure is implemented and locally verified.
- The API now has separate protocol adapters for OpenAI, Anthropic, Gemini, Ollama, DeepSeek
  and custom OpenAI-compatible providers, encrypted per-user configurations, provider tests,
  defaults/fallback, and streaming usage metadata.
- Settings manages saved providers through the authenticated API. Browser AI settings strip
  provider keys; the Copilot, Quick AI and converter surfaces reflect real gateway availability.
- `npm run verify` passes: 145 frontend/sidecar tests, 42 API tests, typecheck, lint and build.
  Lint retains two React Fast Refresh warnings; build retains the existing large-chunk warning.
- Browser smoke check confirmed the Settings page's honest signed-out/unconfigured state. API
  health returned `engine: memory`, `durable: false`, `managedAi.available: false`, and an
  ephemeral development credential key.
- No provider credentials are configured, so live provider requests and Ollama inference are
  unverified. PostgreSQL migration execution and production durability remain unverified.
- `npm run dev:all` correctly refused startup because an existing frontend listener owns
  `localhost:5173`; that listener was left untouched. The API was briefly started for the
  browser smoke check and stopped afterward.
- Next: configure a durable API deployment and encryption key, sign in, save a provider and
  perform a live model-list and completion test.

## Milestone map

| # | Scope | State |
| --- | --- | --- |
| 0 | Audit (`docs/technical-audit.md`) | Done |
| 1 | AI gateway + conversion hardening | **Done and verified (§11)** |
| 2 | `Select` scroll-close root cause, New Project dialog viewport, editor action bar | **Done and verified (§12)** |
| 3 | Real terminal (local companion shipped; cloud mode rendered unavailable) | **Done and verified (§13)** |
| 4 | Device file access (open/import/save/save-as/export/reconnect) | **Done and verified (§14)** |
| 5 | GitHub integration (local Git + GitHub CLI device flow) | **Implemented, live account verification pending (§15)** |
| 6 | Multi-user production architecture (PostgreSQL, storage, quotas, abuse, backups, deletion/export) | **Account export + isolation evidence (§16)** — PostgreSQL/deployment blocked |
| 7 | End-to-end verification of the 17 journeys | In progress — GitHub/deployment journeys blocked |
| 8 | Multi-provider AI (OpenAI, Anthropic, Gemini, Ollama, compatible) | Implemented and locally verified (§17); live credentials unavailable |

## Environment state at wrap-up

- Node.js `v24.19.0`, npm project `codepilot-lab@0.7.0`.
- The pre-existing shared Vite frontend responds at `http://localhost:5173` and was left
  running. `npm run dev:all` correctly detects the occupied port and refuses duplicate startup.
  The API started for the Phase 4 smoke check was stopped; port 8787 is available. To start
  the development stack when its ports are free:
  - `npm run api:dev` → API on `127.0.0.1:8787` (in-memory store, ephemeral credential key)
  - `npm run dev` → Vite on `http://localhost:5173`, proxies `/api` to the API
  - `npm run exec` → execution sidecar on `127.0.0.1:5310` (Run/Trace **and** the terminal).
    Its startup log prints the per-start terminal pairing token; paste that token into the
    Terminal tab. Tokens rotate on every restart.
- The in-memory store means **all accounts and saved connections from today are gone** on
  restart. Recreate one account on `/settings` when testing.
- Projects created during Milestone 4 verification were deleted. The picker registry is
  empty again and the OPFS test folder was removed; no seeded demo data exists.
- No `.env` file is present. `.env.example` lists every variable and contains no secrets.
- Nothing has been deployed. No provider credential exists in this environment, so no real
  model completion has ever run here.
- Milestone 4 browser checks used stubbed native pickers plus a real OPFS
  `FileSystemDirectoryHandle`. Native OS picker prompts were never driven by automation.
- GitHub CLI (`gh`) is not installed, and no live GitHub authentication or repository operation
  has been performed.
- No provider credentials were entered or saved during Phase 4's Settings smoke check.
- The Milestone 6 export fixture account and its server project were deleted through the real
  API; the in-memory store is empty again.

## What Milestone 1 delivered

### API (`server/api`)

- `src/app.ts` composition root, `src/index.ts` runnable entry with honest startup logging.
- Endpoints: `/api/health`, `/api/auth/{register,login,logout,session}`, `/api/account`
  (deletion/export scope), `/api/ai/{status,usage,mode,chat,connection,connection/test}`.
- `/api/health` reports the real store (`memory` vs `postgresql`), `durable`, managed-AI
  availability and whether the credential key is ephemeral. It never claims PostgreSQL
  when running in memory.
- `AiService` resolves managed vs BYO, encrypts BYO keys (AES-256-GCM), enforces daily
  request and monthly token quotas, records estimated usage.
- `ProviderClient` has an SSRF guard, timeouts, NDJSON (Ollama) and SSE (OpenAI-compatible)
  parsing, and classified errors.
- 12 API tests: health honesty, sessions, account deletion, two-user isolation, missing/bad
  Origin, AI status without key leakage, empty chat validation, managed SSE, quota.

### Frontend

- `src/features/copilot/gateway/client.ts` — same-origin or `VITE_API_BASE_URL`,
  `credentials: include`, SSE parsing, structured `GatewayError` mapping.
- `src/features/copilot/gateway/store.ts` — external store probing health + session; nothing
  seeded.
- `src/features/copilot/providers/gateway.ts` — managed adapter.
- `adapterForSettings()` is now the only way AI calls are made (`CopilotContext`,
  `quickAsk`, `convert`).
- The original Milestone 1 `route: 'gateway' | 'direct'` setting separated transport from
  provider. Phase 4 moved active settings to the authenticated gateway-only route and strips
  legacy direct-provider keys from browser storage.
- `/settings` gained a minimal account panel (sign in / create / sign out, real usage and
  quota) and a managed status panel. Provider technical detail is hidden in managed mode.
- Honest badges: managed and BYO connections read `unverified` until a real request
  succeeded (`managed.available` or `connection.verifiedAt`). No “verified” decoration.

### Conversion

- `src/features/converter/convert.ts`: multi-fence discovery, scoring by language tag and
  length, unclosed-fence detection, empty/comment-only detection, delimiter-balance
  warning, notes/approximations extraction, 12-warning cap, `incomplete` flag.
- `ConversionFailure` keeps `partialRaw`/`partial` on provider failure; `ConverterPage`
  shows the partial result as “Incomplete reply” instead of discarding it.
- 14 converter tests (11 parser cases + 3 gateway streaming cases).
- History records the real provider, model and duration; `FAILED` rows are labelled.

### Browser evidence collected today

- Registration, session, sign-out, sign-in all worked against the real API.
- Managed mode with no server provider: “No AI provider is available” plus the server’s
  reason; the connection test returned the same reason, never a false success.
- BYO Ollama draft routed through the API: `PUT /api/ai/connection` succeeded,
  `/api/ai/status` reported `provider: ollama`, `model: llama3`, `hasKey: false`.
- IndexedDB contained `{"route":"gateway","apiKey":"","rememberKey":false}` — no key in the
  browser.
- The connection test and a conversion both returned the server-side
  “The provider endpoint could not be reached (TypeError).”; the browser never contacted the
  provider host.
- Signed out: the route control is disabled with an explanation and saving persists
  `route: "direct"` with no `/api/ai/connection` call.
- `/copilot` and `/settings` show “Configured · unverified” / “Connection saved ·
  unverified” for an untested saved connection.
- No unexpected console errors; the only ones were the known execution-sidecar CORS
  preflight failures.

### Gates (Milestone 1)

| Gate | Result |
| --- | --- |
| `npm run typecheck` (frontend + API) | pass |
| `npm run lint` | pass, 2 pre-existing `react-refresh` warnings |
| `npm test` | 61/61, 6 files |
| `npm run test:api` | 12/12 |
| `npm run build` | pass (pre-existing large-chunk warning) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Secret scan of `dist/` and of tracked files | 0 hits |

## What Milestone 2 delivered

### `Select` — root cause fixed (`src/design-system/primitives/Select.tsx`)

- Scroll events originating inside the menu's own list are ignored.
- Ancestor scrolls reposition the portal; the menu closes only when the trigger leaves the
  viewport.
- `aria-activedescendant`, stable option ids and `scrollIntoView({ block: 'nearest' })` keep the
  keyboard-active option visible without moving the page.
- The trigger is a real `button`, so Enter/Space open it.

### Editor action bar (`EditorArea.tsx`, `EditorMoreMenu.tsx`, `MonacoWorkbench.tsx`)

- Order: **Run · Trace · Save · Save all · Format · Find · More**, then the language and
  dirty chips. Terminal / Output / Problems / Diagnostics stay in the bottom panel.
- Run and Trace dispatch `ui/set-pending-job` and open the Run panel, which consumes the
  request once and makes the real `/run` or `/trace` call. Nothing is fabricated from a click.
- Trace is enabled for Python only; the other runtimes say so in the title.
- Format runs `editor.action.formatDocument` on the live model and reports whether the buffer
  changed. `supportsDocumentFormatting()` covers TS, JS, JSON, CSS, SCSS, Less and HTML;
  every other language reports "has no document formatter in this build". Shift+Alt+F is bound
  inside Monaco and shares the command.
- More is a portalled non-modal menu: word wrap, minimap, theme, font size, copy path, Copilot
  context, Explain. Escape/outside/Tab close it (Tab moves on to the next tabbable instead of
  trapping focus) and focus returns to the trigger.
- Toolbar density now follows the **editor pane** via a container query. Before the fix, a
  1440 px window with the explorer and Copilot dock open left a 554 px pane and a 649 px
  toolbar: the file identity collapsed to 0 px and More slipped under the dock. After:
  `scrollWidth === clientWidth`, identity 159 px, labels restored at pane ≥ 800 px.

### Browser evidence (in-app 912×766, harness measured at 1440×1000)

- New Project dialog: 415 px tall at 1000×700; menu 290 px tall with a 251 px list viewport for
  9 options; list `scrollTop = 200` keeps `aria-expanded="true"`; ArrowDown moves the active
  option TypeScript → C and scrolls it into view; choosing CSS closes the menu and updates the
  note.
- Python project `py-lab` / `main.py`: **Run** → `COMPLETED · 143 ms · exit 0 · "Hello from
  CodePilot Lab"`; **Trace** → `TRACE COMPLETE · 9 recorded events · 208 ms` with real
  call/line/return rows and captured stdout.
- TypeScript: Trace disabled ("no tracer in this build — only Python is traced"). HTML: Run and
  Trace disabled ("no runtime in this build"), status bar "Editor only · no runtime".
- Find opened Monaco's widget (`1 of 1`); Replace All produced `const   greeting :string='Hi'`
  (Unsaved, Save all enabled); **Format** produced `const greeting: string = 'Hi'` + toast
  "Formatted main.ts."; **Save** produced "Saved main.ts" and disabled Save all.
- More menu checkmarks/toggles/keyboard/outside-close all behaved as described above.

### Gates (Milestone 2)

| Gate | Result |
| --- | --- |
| `npm run typecheck` (frontend + API) | pass |
| `npm run lint` | pass, same 2 pre-existing `react-refresh` warnings |
| `npm test` | 61/61, 6 files |
| `npm run test:api` | 12/12 |
| `npm run build` | pass (pre-existing large-chunk warning) |

## What Milestone 3 delivered

### Local terminal (`server/terminal.mjs`, `src/features/terminal/*`)

- **Real PTY, not a simulation.** `node-pty@1.1.0` spawns `cmd.exe` through ConPTY on this
  machine; `ws@8.22.2` streams it to the browser. `node-pty` ships `prebuilds/win32-x64`, so
  no compiler is needed here.
- **Attachment point.** The hub lives on the existing loopback sidecar:
  `GET /terminal/health` and a WebSocket upgrade at `/terminal`. It is not a new public
  service and it does not route through `/run`.
- **Guards.** Loopback bind, Origin allow-list, and a per-start pairing token that is printed
  only on the service console. Tokens rotate on restart; the browser keeps the current one in
  `sessionStorage` (`codepilot.terminal.token.v1`), never in localStorage or Dexie.
- **Limits.** 2 sessions, 64 KiB frames, columns 20–400, rows 5–200. Windows kills use
  `taskkill /PID /T /F`; shutdown terminates sockets so the server closes.
- **Protocol.** `ready` / `output` / `exit` / `error` from the server; `input` / `resize` /
  `cwd` from the client. A `cwd` change validates the directory and restarts the shell there.
- **UI.** `TerminalPanel` shows the real shell, cwd, pid, exit code, service health and the
  exact `npm run exec` command when offline. Connect is disabled until a health probe succeeds.
  `TerminalSurface` is a lazy xterm + FitAddon boundary in its own 333.69 kB chunk.
- **Cloud.** Rendered as a disabled “Cloud · unavailable” control with the reason “No cloud
  terminal runtime is configured in this build”. Nothing pretends a cloud shell exists.
- **Session continuity.** The Terminal panel stays mounted while the bottom panel is open, so
  switching to Run/Output and back keeps the same pid and scrollback. Closing the panel or the
  page ends the session; scrollback is not persisted.

### Browser evidence (Milestone 3)

- In-app 912×766: connected with the printed token, saw the real
  `Microsoft Windows [Version 10.0.26300.9818]` banner, `C:\Users\19rag\Code\codepilot-lab>`
  prompt and `Live · pid 22400`. Typed `echo code-pilot-terminal-ok` and got the real output.
- `exit` produced `Shell exited · code 0` with the honest session-log note.
- Tab switch to Run and back preserved pid 22400 and the full scrollback.
- A wrong token showed “The terminal connection closed without a handshake. The pairing token
  may not match the one printed by `npm run exec`, or the service was stopped.”
- Restarting the service rejected the old token and accepted the new one
  (`Live · pid 23280`), proving rotation. Stopping the service mid-session returned the UI to
  `Not connected`; **Re-check service** showed `Service offline`, the real endpoint and start
  command, with Connect disabled.
- 1440×1000 through a same-origin harness: `scrollWidth === 1440` (no horizontal overflow),
  live session, runtime/status clusters wrapping as whole rows in the 554 px editor column.

### Gates (Milestone 3)

| Gate | Result |
| --- | --- |
| `npm run typecheck` (frontend + API) | pass |
| `npm run lint` | pass, same 2 pre-existing `react-refresh` warnings |
| `npm test` | 68/68, 7 files (7 terminal integration tests) |
| `npm run test:api` | 12/12 |
| `npm run build` | pass; terminal renderer in a lazy chunk |
| `npm audit --omit=dev` | 0 vulnerabilities (`ws` 8.22.2) |

### Terminal limits that remain

- Windows-only verification. Linux/macOS have no `node-pty` prebuild here and npm's
  allow-scripts blocks the build script.

## Current terminal integration work (Phase 7)

- Status: Phase 7 multi-session integrated terminal is implemented and verified.
- The terminal backend (`server/terminal.mjs`) already owns the real PTY (node-pty / Windows ConPTY), loopback bind, per-start pairing token, Origin allow-list, per-session kill-tree, cwd change with directory validation, and exit-code streaming. No backend was replaced.
- `src/features/terminal/TerminalSurface.tsx` was converted to `forwardRef` and now exposes `write`/`clear`/`copy`/`resize`/`focus`/`fit` so the panel can act on the active session without knowing about xterm internals.
- `src/features/terminal/TerminalPanel.tsx` was rewritten as a multi-session terminal tab surface:
  - New terminal / Close terminal / switch tabs (capped at the backend's `MAX_SESSIONS = 2` concurrent PTYs, each tab holds its own WebSocket),
  - Clear and Copy (xterm selection) on the active session,
  - Working-directory `cd` control with real directory validation,
  - Maximize / restore panel height (dispatches `ui/set-bottom-height`),
  - Per-session status chip, pid, exit-code readout, per-tab exit code, and a working-directory `cd` input.
- Session state (connected/connecting/exited/error + pid/cwd/exit) now flows from each terminal session to the parent panel through stable refs, so tabs render correctly and reconnect only on token/key change.
- Local end-to-end verification: `npm run typecheck` ✅, `npm run lint` ✅ (0 errors, 2 pre-existing warnings), `npm test` ✅ (17 files / 151 tests) including `server/terminal.test.mjs`, `npm run build` ✅ (only the pre-existing large-chunk warning), and a live `cmd.exe` PTY run showing `echo`, `node --version`, real CWD change and exit codes. `ws` (non-default) is not installed in this environment, so the browser-facing terminal surface itself has not been browser-verified here — run it manually.
- The terminal remains a genuine local shell on the host machine, not a sandbox, not cloud isolation, per `docs/security.md`.

## Resume checklist
- No installer or signing; the user starts `npm run exec` and pastes the console token.
- This is real shell access with the operator's privileges, not a sandbox. The UI says so.
- Cloud terminal, installer packaging, multi-tab session sharing and scrollback persistence
  are not implemented.

## What Milestone 4 delivered

### Storage services (no new dependency)

- `src/lib/diskAccess.ts` — permission query/request, `showOpenFilePicker`,
  `showDirectoryPicker`, `showSaveFilePicker`, read-write access, link probing and a download
  fallback. Every outcome is typed; picker errors map to honest reasons.
- `src/lib/projectArchive.ts` — hand-rolled ZIP writer/reader using
  `CompressionStream`/`DecompressionStream('deflate-raw')`, with CRC-32 verification,
  path-safety rejection, duplicate rejection and per-entry skip reasons. Project metadata is
  `codepilot.project.json` at the archive root and is never imported as a file.
- `src/lib/projectImport.ts` — folder scans now capture real text contents under
  **2 MiB/file and 24 MiB/import**, strip the selected root, and report binary, oversized and
  unreadable files instead of dropping them silently.
- `src/lib/projectStorage.ts` — `saveFileContent`, `writeContentToLinkedFolder`,
  `probeLinkedFolder`, `reconnectLinkedFolder`, `storeScannedContents`,
  `importFilesIntoProject` and `collectProjectFiles`. Components call these services.

### Save behaviour

- The IndexedDB copy is written **first**. The linked folder is written only after that
  succeeds and only when `queryPermission({ mode: 'readwrite' })` is `granted` (requested if
  the browser allows). Disk failure is a separate outcome and never turns a successful
  browser save into a failure.
- Toasts state the real result: “Saved X to this browser”, “Saved X · browser copy and device
  folder”, or the browser-save success plus the real disk reason.

### UI surfaces

- **Picker (`/workspace`)** — `Open file` creates a genuine single-file project from the
  browser-read bytes (cap 4 MiB), records language/size, and labels it a browser copy. Picker
  and permission failures appear in a dismissible alert.
- **Project dialog** — folder import and `.zip` import share a review step that reports the
  CRC check, text-file count, bytes, language and skipped entries.
- **Dossier** — storage origin, folder state, live permission readout
  (`Read granted · write granted`, `asks on use`, `denied`), `Link device folder` /
  `Reconnect folder`, and `Export archive`, each with a real inline outcome.
- **Workspace** — origin chip (`Browser copy` / `Folder linked`), More-menu
  `Save a copy…` and `Export project archive…`, and a `beforeunload` guard while drafts are
  dirty. `useBlocker` is unavailable with `BrowserRouter`, so in-app route blocking is not
  claimed.
- **Explorer** — real drag-and-drop file import at the project root, explicit collision
  reporting, and folder drops rejected with a pointer to “Import folder”.

### Browser evidence (in-app 912×766, harness measured at 1440×1000)

- `Open file` created `verify_open` with the exact picked content; the chip read
  `Browser copy`. A dirty buffer saved with “Saved verify_open.py to this browser”.
- Export produced a 448-byte file beginning `PK\x03\x04` and
  “Exported verify_open.zip · 1 file”. Re-importing it showed
  “ARCHIVE READ AND CRC-CHECKED”, 1 text file, 58 B, Python; the recreated project reopened
  with identical content.
- Dossier export produced a 456-byte ZIP and “Exported dossier-export.zip · 1 file”.
- Relinking with a real OPFS `FileSystemDirectoryHandle` showed
  `Read granted · write granted`, `writes enabled`, and a save produced
  “Saved verify_open.py · browser copy and device folder”. The OPFS file matched the editor.
- Removing the OPFS folder and saving again produced
  “Saved verify_open.py to this browser. The device folder was not updated: The file or folder
  no longer exists at that path.” The browser copy still succeeded.
- A real `drop` event added `dropped.txt` (“Added 1 file to the project root”); a duplicate
  drop reported “A file or folder with this name already exists in that folder.”
- A corrupt archive showed “No ZIP end-of-central-directory record was found in this file.”
  and stayed in the chooser. A denied picker showed
  “Open file failed. The browser denied permission for this device action.”
- Reload preserved the browser copy and the dropped file; editor content matched the last
  save. Test records and the OPFS folder were deleted afterwards.
- 1440×1000: `scrollWidth` 1430–1440, desktop sidebar, dossier two columns, no horizontal
  overflow. 390×844: `scrollWidth` 381, picker actions stack, dossier storage actions fit.

### Gates (Milestone 4)

| Gate | Result |
| --- | --- |
| `npm run typecheck` (frontend + API) | pass |
| `npm run lint` | pass, same 2 pre-existing `react-refresh` warnings |
| `npm test` | 77/77, 8 files (9 archive tests added) |
| `npm run test:api` | 12/12 |
| `npm run build` | pass (existing large-chunk warnings) |

### Device-file limits that remain

- Native OS folder/file picker prompts, explicit permission denial and revocation could not
  be automated. Write-through was verified through OPFS handles using the same code path;
  denial/revocation remain manual checks.
- `File System Access` is browser-specific; where it is unavailable the UI says so and the
  download path produces a file download, not a linked folder.
- Caps are visible policy: 4000 archive entries, 8 MiB per archive file, 64 MiB per archive,
  80 MiB picker cap, 2 MiB per captured file, 24 MiB per folder capture, 4 MiB for one opened
  file.
- Archives contain the saved IndexedDB copy; unsaved Monaco drafts are not included.
- No cloud file storage, cross-device sync or multi-user sharing exists.

## What Milestone 5 delivered (local GitHub CLI integration)

- `server/githubBridge.mjs` exposes GitHub CLI status, repository listing/search/create/clone,
  and Git status, branches, stage/unstage, diffs, commits, fetch/pull/push and history.
- Every sidecar GitHub/Git request requires an allow-listed Origin and the existing per-start
  pairing token. Operations use argument arrays, explicit repository-root paths, validated
  branch/file inputs, bounded command output, and GitHub-only remote URLs for network actions.
- GitHub CLI device authentication uses
  `gh auth login --hostname github.com --git-protocol https --web --expiring`. The browser only sees a
  profile and authentication state; the CLI manages its credentials, using the OS credential
  store when available and potentially falling back to its config file. Local disconnect
  removes the CLI's stored login but does not revoke the OAuth grant at GitHub.
- `/settings` includes a repository browser, create/clone actions and local source-control
  controls. A cloned repository still must be added to the browser's project picker through
  Workspace → Import folder; the OS path is never inferred from a browser directory handle.
- The previous server API configuration endpoint and GitHub App environment variables were
  removed because they represented a duplicate, disconnected architecture.
- Tests cover origin/pairing denial, path traversal, status/stage/diff, branch, commit/history,
  and a mocked unauthenticated GitHub CLI. Git 2.55.0 is installed; `gh` is absent, so live
  OAuth, profile, repository and remote operations remain unverified. No callback URL or GitHub
  Developer Settings setup is required for this CLI flow.

## What Milestone 6 delivered (account export and isolation evidence)

The full milestone needs PostgreSQL, hosting and a deployment target. PostgreSQL is not
installed here and there is no hosting, so durable multi-instance persistence and deployment
remain blocked. The parts that can be proven against the real router were completed:

- `GET /api/account/export` (session required) returns a JSON attachment containing the
  caller's profile, server-side projects with file contents, settings, AI usage/quota and the
  public AI connection metadata. It omits password hashes, session tokens, encrypted provider
  keys and server configuration, and lists those exclusions in `notIncluded`.
- `server/api/src/services/accountExport.ts` assembles the export from user-scoped store
  methods only, so a guessed id cannot pull another account's rows.
- `/settings` now offers `Export my data` in the account panel. It downloads the API response
  as a file and reports the real filename and byte size. There is no client-side
  reconstruction and no local storage write.
- API tests now prove: two accounts cannot read each other's project or files (404), an AI
  credential saved by one account is absent from the other's status, the export contains the
  owner's project/file and `keyLast4` only, it contains no secret/hash/token text or the other
  account's email, and deleting the account revokes its session while leaving the other
  account intact.

Browser evidence (1000×700 in-app viewport at verification time):

- Created an account, then a server project with `main.py` and a BYO connection through the
  real API. `Export my data` produced a real browser download:
  `codepilot-account-573f4937-….json`, 1,499 bytes.
- The downloaded JSON contained the profile, `Export fixture`, `main.py`, settings
  (`aiMode: "byo"`), usage/quota and `keyLast4: "port"` with `hasKey: true`. It contained
  neither the fixture API key, `passwordHash`, `tokenHash` nor `encryptedApiKey`.
- The panel reported `Exported …json · 1,499 B`; `documentElement.scrollWidth` was 990 in a
  1000 px viewport.
- Deleting that account through the real `DELETE /api/account` returned 200; a following
  export and project list returned 401. The browser download was the only copy of the export.

### Gates (Milestone 6 partial)

| Gate | Result |
| --- | --- |
| `npm run typecheck` (frontend + API) | pass |
| `npm run lint` | pass, same 2 pre-existing `react-refresh` warnings |
| `npm test` | 84/84, 8 files |
| `npm run test:api` | 19/19 |
| `npm run build` | pass (existing large-chunk warnings) |

### Milestone 6 limits

- No PostgreSQL process exists here. The PostgreSQL schema and `pgStore` remain unapplied and
  untested against a live server; all route tests use the in-memory store.
- No deployment, TLS, secure-cookie production run, shared rate-limit store, monitoring or
  scheduled backup exists. The account export is a user-facing data download, not a backup.
- The frontend's real projects still live in IndexedDB and are not uploaded to the API. The
  export covers server-side account data only; browser projects are exported separately as a
  project archive from the workspace.

## Not verified — do not present as done

- Any real model completion (managed or BYO). Routing, storage, quotas, error propagation
  were exercised; no provider answered.
- A UI partial-output conversion caused by a real mid-stream failure (unit-tested only).
- PostgreSQL persistence — PostgreSQL is not installed here.
- Multi-instance rate limiting, deployment, TLS, secure cookies, CSP.
- Live GitHub device authorization and remote actions: `gh` is not installed. Local Git
  status/stage/diff/branch/commit/history and remote-destination guards are covered in
  temporary-repository tests, but no real clone, fetch, pull or push was attempted.
- Native OS picker prompts and explicit permission revocation for device files; write-through
  itself was verified through OPFS handles.
- Cloud terminal: no per-user container/VM runtime exists in this environment.
- The local PTY on Linux/macOS: no prebuild is installed and allow-scripts blocks compiling.
- Email verification, password reset, MFA, account export UI.

## Next task — complete live verification for Milestone 5

The local Git/GitHub CLI integration is implemented and its offline/local behaviors are
covered. No CodePilot OAuth callback or GitHub App is used. The remaining work is live
verification after GitHub CLI is installed and the user completes device authorization.

Implemented now:

- The local companion's `/github/*` and `/git/*` routes require a configured Origin and the
  existing per-start pairing token; GitHub credentials are never returned to the browser or
  stored in CodePilot storage.
- The `/settings` GitHub panel checks the actual CLI profile, supports listing/searching,
  creating and cloning repositories, and provides local Git status/branch/stage/unstage/diff/
  commit/fetch/pull/push/history actions for a user-entered absolute path.
- Local Git operations and remote URL/pairing/path guards have focused tests.

Live verification remains blocked until `gh` is installed and the user authorizes it:

1. Install GitHub CLI (Windows: `winget install --id GitHub.cli`), restart the terminal, and
   check `gh --version`.
2. Start the local companion (`npm run exec`, or `npm run dev:all`) and paste its pairing
   token into Settings → GitHub.
3. Run `gh auth login --hostname github.com --git-protocol https --web --expiring` in a local terminal,
   complete the device flow, and press Re-check.
4. Verify repository list/search and clone to a chosen OS path. Import that folder through
   Workspace → Import folder if it should also appear in the CodePilot project picker.
5. Test push/pull only on a user-authorized repository. No callback URL or GitHub Developer
   Settings registration is required.

Disconnect removes the local GitHub CLI login only; revoke the GitHub CLI OAuth grant separately
from GitHub Settings if desired. GitHub CLI uses the OS credential store when available and
may fall back to its config file; this limitation is disclosed in the UI.

Terminal and device-file follow-ups (independent of GitHub): installer/signing, cloud terminal
runtime, scrollback persistence, Linux/macOS PTY verification, and native-picker
denial/revocation checks. `Format` remains limited to Monaco's bundled formatters, and Trace
remains Python-only.

## Resume checklist

```bash
git status                  # should be clean after the checkpoint commit
npm install                 # only if node_modules is missing
npm run api:dev             # terminal 1
npm run dev                 # terminal 2
npm run exec                # terminal 3 — Run/Trace + terminal (127.0.0.1:5310)
```

The `npm run exec` console prints `pairing token: …`. Open the workspace, select the Terminal
tab, paste that token and press Connect. The token changes every time the service restarts.

Then open `http://localhost:5173/settings`, create an account, and confirm the managed
panel reports “No AI provider available” with the real reason (expected without a provider).
For device files, use `Open file` on `/workspace`, or link a folder from a project dossier and
check the permission row before saving. For Run / Trace, create a Python project and use the
editor toolbar; both need `npm run exec` running or they will report the service as offline.

Local runtimes present on this machine: Python 3.14.5, Node v24.19.0, gcc (MSYS2), Java.

## Documentation map

| File | Purpose | Freshness |
| --- | --- | --- |
| `docs/technical-audit.md` | Audit, decisions, Milestone 1–5 status and evidence | Current |
| `docs/ai-gateway.md` | Gateway setup, endpoints, route semantics, non-claims | Current |
| `docs/architecture.md` | Browser/editor architecture | Stale for backend; banner added |
| `docs/security.md` | Security posture | Stale for backend; banner added |
| `docs/deployment.md` | Static deployment guide | Stale for backend; banner added |
| `docs/production-readiness.md` | Phase 7 evaluation | Predates the API; banner added |
| `docs/session-handoff.md` | This file | Update at each wrap-up |
