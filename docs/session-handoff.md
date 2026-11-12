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
| 1 | AI gateway + conversion hardening | **Done and verified (see below)** |
| 2 | `Select` scroll-close root cause, New Project dialog viewport, editor action bar | Not started — next |
| 3 | Real terminal (local companion **and** cloud, user chose both) | Not started |
| 4 | Device file access (open/import/save/save-as/export/reconnect) | Not started |
| 5 | GitHub integration (GitHub App, server-side key) | Not started |
| 6 | Multi-user production architecture (PostgreSQL, storage, quotas, abuse, backups, deletion/export) | Not started |
| 7 | End-to-end verification of the 17 journeys | Not started |

## Environment state at wrap-up

- Node.js `v24.19.0`, npm project `codepilot-lab@0.7.0`.
- Dev servers are **stopped**. Restart with two terminals:
  - `npm run api:dev` → API on `127.0.0.1:8787` (in-memory store, ephemeral credential key)
  - `npm run dev` → Vite on `http://localhost:5173`, proxies `/api` to the API
- The in-memory store means **all accounts and saved connections from today are gone** on
  restart. Recreate one account on `/settings` when testing.
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

### Gates (last run, all after the final code change)

| Gate | Result |
| --- | --- |
| `npm run typecheck` (frontend + API) | pass |
| `npm run lint` | pass, 2 pre-existing `react-refresh` warnings |
| `npm test` | 61/61, 6 files |
| `npm run test:api` | 12/12 |
| `npm run build` | pass (pre-existing large-chunk warning) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Secret scan of `dist/` and of tracked files | 0 hits |

## Not verified — do not present as done

- Any real model completion (managed or BYO). Routing, storage, quotas, error propagation
  were exercised; no provider answered.
- A UI partial-output conversion caused by a real mid-stream failure (unit-tested only).
- PostgreSQL persistence — PostgreSQL is not installed here.
- Multi-instance rate limiting, deployment, TLS, secure cookies, CSP.
- GitHub App, terminal, device write-through, cloud storage, multi-user frontend.
- Email verification, password reset, MFA, account export UI.

## Known issues to fix next (Milestone 2)

1. `src/design-system/primitives/Select.tsx` closes on **any** captured `scroll` event,
   including its own menu. This is the recorded root cause of the New Project language
   dropdown closing when the list scrolls. Fix: ignore scroll events originating inside the
   menu, or listen only on scrollable ancestors.
2. New Project dialog at `src/features/command-center/ProjectDialog.tsx`: verify scrolling,
   contrast, keyboard navigation and viewport fit at 912×766 and 1440×1000.
3. Editor action bar (`src/features/workspace/components/WorkspaceShell.tsx` and
   `EditorArea.tsx`) lacks Run, Debug/Trace, Save, Save All, Format, Find and More. Wire it
   through `EditorCommandsContext`; keep terminal/output/problems in the bottom panel.

## Resume checklist

```bash
git status                  # should be clean after the checkpoint commit
npm install                 # only if node_modules is missing
npm run api:dev             # terminal 1
npm run dev                 # terminal 2
```

Then open `http://localhost:5173/settings`, create an account, and confirm the managed
panel reports “No AI provider available” with the real reason (expected without a provider).

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
