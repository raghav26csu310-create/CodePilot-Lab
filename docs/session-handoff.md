# Session handoff — 2026-11-12

This is the resume point for the next working session. It records what exists, what was
verified, what was not, and the exact next task. It is not a claim of production
readiness.

## Mission

Turn CodePilot Lab into a usable, secure, scalable AI-native coding environment without
rebuilding it. Work proceeds in milestones; each one starts with inspection, affected
files and a plan, and ends with typecheck, lint, tests, build and a report of real results.

Superseded posture: the older “frontend only, no accounts” stance no longer applies.
Managed cloud AI, accounts, ownership and a server-side AI gateway are now the target.
Loopback execution stays a resource-limited local tool, not a hardened sandbox.

## Milestone map

| # | Scope | State |
| --- | --- | --- |
| 0 | Audit (`docs/technical-audit.md`) | Done |
| 1 | AI gateway + conversion hardening | **Done and verified (§11)** |
| 2 | `Select` scroll-close root cause, New Project dialog viewport, editor action bar | **Done and verified (§12)** |
| 3 | Real terminal (local companion shipped; cloud mode rendered unavailable) | **Done and verified (§13)** |
| 4 | Device file access (open/import/save/save-as/export/reconnect) | Not started — next |
| 5 | GitHub integration (GitHub App, server-side key) | Not started |
| 6 | Multi-user production architecture (PostgreSQL, storage, quotas, abuse, backups, deletion/export) | Not started |
| 7 | End-to-end verification of the 17 journeys | Not started |

## Environment state at wrap-up

- Node.js `v24.19.0`, npm project `codepilot-lab@0.7.0`.
- Dev servers are **stopped**. Restart with three terminals:
  - `npm run api:dev` → API on `127.0.0.1:8787` (in-memory store, ephemeral credential key)
  - `npm run dev` → Vite on `http://localhost:5173`, proxies `/api` to the API
  - `npm run exec` → execution sidecar on `127.0.0.1:5310` (Run/Trace **and** the terminal).
    Its startup log prints the per-start terminal pairing token; paste that token into the
    Terminal tab. Tokens rotate on every restart.
- The in-memory store means **all accounts and saved connections from today are gone** on
  restart. Recreate one account on `/settings` when testing.
- Projects created during verification live in this browser's IndexedDB (`fn`, `py-lab`);
  they are local test records, not seeded demo data.
- No `.env` file is present. `.env.example` lists every variable and contains no secrets.
- Nothing has been deployed. No provider credential exists in this environment, so no real
  model completion has ever run here.

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
- `route: 'gateway' | 'direct'` separates *where* a call runs from *which provider* it uses.
  A BYO provider can be server-held (encrypted on the API) or browser-direct (advanced).
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
- No installer or signing; the user starts `npm run exec` and pastes the console token.
- This is real shell access with the operator's privileges, not a sandbox. The UI says so.
- Cloud terminal, installer packaging, multi-tab session sharing and scrollback persistence
  are not implemented.

## Not verified — do not present as done

- Any real model completion (managed or BYO). Routing, storage, quotas, error propagation
  were exercised; no provider answered.
- A UI partial-output conversion caused by a real mid-stream failure (unit-tested only).
- PostgreSQL persistence — PostgreSQL is not installed here.
- Multi-instance rate limiting, deployment, TLS, secure cookies, CSP.
- GitHub App, device write-through, cloud storage, multi-user frontend.
- Cloud terminal: no per-user container/VM runtime exists in this environment.
- The local PTY on Linux/macOS: no prebuild is installed and allow-scripts blocks compiling.
- Email verification, password reset, MFA, account export UI.

## Known issues to fix next (Milestone 4 — device file access)

1. Disk writes are absent. Saves, renames and file creation update IndexedDB only; there is no
   `createWritable`, save-as/open picker, archive export/import, drag-and-drop upload or
   reconnect UI beyond the implicit read fallback. Milestone 4 must add those with honest
   permission/failure states.
2. Terminal follow-ups (not blockers for Milestone 4): no installer/signing, no cloud
   runtime, no scrollback persistence across reload, and only Windows was verified.
3. `Format` covers only Monaco's bundled formatters. If the product wants Prettier, it must be
   bundled locally (no CDN) and added to `supportsDocumentFormatting()` honestly.
4. Trace is Python-only (`server/trace_python.py`). Adding a JS/TS tracer would need a real
   recorder, not a simulated event list.

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
For the action bar, create a Python project and use Run / Trace from the editor toolbar; both
need `npm run exec` running or they will report the service as offline.

Local runtimes present on this machine: Python 3.14.5, Node v24.19.0, gcc (MSYS2), Java.

## Documentation map

| File | Purpose | Freshness |
| --- | --- | --- |
| `docs/technical-audit.md` | Audit, decisions, Milestone 1 status and evidence | Current |
| `docs/ai-gateway.md` | Gateway setup, endpoints, route semantics, non-claims | Current |
| `docs/architecture.md` | Browser/editor architecture | Stale for backend; banner added |
| `docs/security.md` | Security posture | Stale for backend; banner added |
| `docs/deployment.md` | Static deployment guide | Stale for backend; banner added |
| `docs/production-readiness.md` | Phase 7 evaluation | Predates the API; banner added |
| `docs/session-handoff.md` | This file | Update at each wrap-up |
