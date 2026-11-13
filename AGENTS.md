# CodePilot Lab — agent guide

Local-first, AI-native coding laboratory. React 19 + TypeScript + Vite SPA with an optional
local API (`server/api`) that owns accounts and AI credentials. Milestones are sequenced
deliberately — implement only the requested phase (see README) and do not jump ahead to
execution or the remaining placeholder modules unless asked.

Read `docs/session-handoff.md` first: it is the current resume point, and
`docs/technical-audit.md` §10–11 record the confirmed architecture decisions.

## Non-negotiable product rules

- Never invent project data, timestamps, terminal output, AI responses, metrics, or
  health. Every readout must come from a real browser/IndexedDB/WebGL/file/API response.
- Every visible control must work or be visibly marked unavailable ("Scheduled" /
  disabled). Placeholder screens must say so plainly.
- Local-first by default: dependencies and fonts are bundled. Do not add CDN fonts,
  telemetry or third-party scripts. The API is loopback-only in development; nothing may
  be deployed or called publicly without the deployment work in the audit.
- Never ship, log or commit a provider key. Platform keys live only in the API environment.

## Commands

```bash
npm run dev        # Vite, port 5173 (proxies /api to 127.0.0.1:8787)
npm run api:dev    # API with tsx watch, port 8787, in-memory store
npm run api:start  # API without watch
npm run api:migrate# apply PostgreSQL migrations
npm run typecheck  # tsc -b + API tsconfig
npm run lint       # eslint .
npm test           # vitest (frontend)
npm run test:api   # vitest (server/api/test)
npm run build      # tsc -b && vite build
```

Verification = typecheck + lint + both test suites + build + manual browser checks.
ESLint ignores `dist/` and `node_modules/`.

## Architecture facts

- `src/app/routes.ts` is the single source for nav/palette metadata. A new route needs
  an entry there, a route in `src/app/App.tsx`, and a page. `/workspace/:projectId` is
  the real editing workspace; `/workspace` is the project picker; the dossier lives at
  `/workspace/:projectId/overview`.
- The sidebar collapse preference is stored under `codepilot.sidebar.collapsed` and
  applied at mount. The desktop sidebar appears at 1024 px and above; below that the
  mobile navigation dialog is the only navigation surface.
- Styling is CSS Modules + tokens in `src/design-system/tokens.css` / `base.css`.
  There is no Tailwind. Reuse existing primitives and tokens; do not redesign the
  system per page.
- The Three.js scene (`src/three/*`, ~918 kB) must stay lazy. Load it only through the
  `React.lazy` boundary in `HeroStage`, and keep the `CoreFallback` SVG path for
  reduced-motion / no-WebGL / WebGL failure.
- `useStageActive` pauses the canvas offscreen/hidden; `useWebGLSupport` and
  `usePrefersReducedMotion` return synchronously. Do not add a second render loop.
- Project records live in IndexedDB through Dexie (`src/lib/db.ts`) under schema v4:
  `projects`, `files` (tree entries), `contents` (saved text), `settings`, `conversions`,
  `practiceProgress`, `practiceSubmissions` and `feedback`. Storage services belong in
  `src/lib/projectStorage.ts`, never in components. Stored content
  is authoritative after the first save; `directoryHandle` is only an honestly
  disclosed read fallback and is structured-clone data. Opening a legacy record
  migrates its manifest into entries without resetting user data.
- The Monaco surface is `MonacoWorkbench` behind `React.lazy` in `EditorArea`. Keep
  bundling local (no CDN); editor text models are owned by the workbench and must be
  disposed with tabs. Dirty state comes from `getAlternativeVersionId`, and live drafts
  live only inside Monaco models — the reducer keeps snapshots. Cross-component
  editor actions (save, save-all, find, reveal) go through `EditorCommandsContext`,
  not ad-hoc window globals. `monaco-editor@0.57.0` uses the exports-map worker paths and
  `package.json` overrides its declared `dompurify@3.4.15` to `3.4.17`; re-check both on
  every Monaco upgrade.
- Shortcuts: `Ctrl/⌘ S / Shift S / P / Shift F / F / PageUp / PageDown` are implemented
  both inside Monaco (`monaco.addCommand`) and in `WorkspaceShell`'s global handler,
  which skips events originating inside `.monaco-editor` to avoid double handling.
- Import is a real folder scan via the File System Access API or a `webkitdirectory`
  input. Excluded directories and the scan cap are product-visible policy; do not
  silently drop files. Recent projects and dossiers must read from Dexie or show an
  explicit unavailable/empty state — never seed sample projects.
- App version is injected as `__APP_VERSION__` from `package.json` in
  `vite.config.ts`. Never hardcode a version string.

## AI Copilot (Phase 5) and the AI gateway (Milestone 1)

- Provider code lives in `src/features/copilot/providers/*` behind the `AiProvider`
  interface. Three adapters exist: the managed `gateway`, native `ollama` (NDJSON
  `/api/chat`, `/api/tags`) and `openai-compatible` (SSE `/chat/completions`, `/models`).
  Add a provider by adding an adapter and a preset, not by branching inside the dock.
- **Always call `adapterForSettings(settings)`**, never `adapterFor(kind)`: the `route`
  setting decides whether the CodePilot API or the browser performs the call.
  - `preset: 'codepilot'` is managed: no URL, model or key reaches the browser.
  - `route: 'gateway'` with a BYO preset stores the key encrypted on the API
    (`PUT /api/ai/connection`); the browser keeps `apiKey: ''`.
  - `route: 'direct'` is the advanced/local fallback; the browser calls the endpoint and a
    remembered key is plaintext IndexedDB. The UI says so.
- Settings are an external store (`settingsStore.ts`) consumed through
  `useSyncExternalStore` so the dock and `/settings` stay in sync. Persisted under the
  Dexie `settings` key `copilot.provider.v1`. Gateway state is a separate external store
  (`gateway/store.ts`) that probes `/api/health` + `/api/auth/session` and never seeds
  values. `verified` means `managed.available` or a real `connection.verifiedAt` — a saved
  connection is `unverified`, and saving settings clears the claim.
- `context.ts` is the only place that assembles request content. Toggles gate the
  active file, selection, tree names and Monaco markers; other files are attached
  explicitly and the exact bundle is previewable. Apply the character budget rather than
  uploading a project wholesale.
- Model changes are ` ```codepilot path="..." mode="replace|create" summary="..." `
  fences containing complete file content. `proposals.ts` parses them defensively and
  rejects unsafe paths. Apply only through `applyProposal`, which performs one undoable
  Monaco edit (creating the stored entry first for `create` mode) and never saves.
  Revisions keep previous whole-file content for restore.
- The UI is `CopilotDock` (desktop panel and mobile drawer) over `CopilotContext`, which
  is mounted inside `EditorCommandsProvider` + the workspace provider. Keep the chat
  alive when the dock closes. `/copilot` is the live overview; `/settings` is the live
  credential page.

## CodePilot API (Milestone 1)

- The API is `server/api` (Fastify-free, plain `node:http` router). `src/app.ts` is the
  composition root, `src/index.ts` the entry. Stores: `memoryStore` (development default
  when `DATABASE_URL` is empty) and `pgStore` (PostgreSQL). `/api/health` must always report
  the truth about `engine`, `durable`, managed-AI availability and whether the credential
  key is ephemeral.
- Auth is session-cookie based (scrypt hashes, HttpOnly, SameSite, CSRF via Origin check).
  Every AI route requires a session and scopes all reads/writes to `ctx.user.id`.
- Provider keys are AES-256-GCM encrypted at rest and only `hasKey`/`keyLast4` are ever
  returned. `CREDENTIAL_ENCRYPTION_KEY` is required in production; in development an
  ephemeral key is used and the API says so on startup.
- `/api/ai/chat` streams SSE `meta`, `delta`, `done` and `error` events. A failure must be
  an `error` event with the server's real code — never a silent empty answer.
- Tests live in `server/api/test/app.test.ts` and must keep covering honesty, isolation,
  CSRF and quota.

## Session wrap-up

- At the end of a session, update `docs/session-handoff.md` (state, gates, unresolved
  items, next task) and commit. Do not leave verified work uncommitted.

## Execution, conversion and practice (Phase 6)

- Execution is a loopback-only Node sidecar in `server/`. `server/index.mjs` exposes
  `/health`, `/run`, `/trace`, `/grade`, `/cancel`, `/problems`; `server/executor.mjs`
  owns runtime probes, compile/run with temp dirs and tree-kill timeouts;
  `server/trace_python.py` is the real `sys.settrace` recorder. It is a resource-limited
  local runner, not a hardened sandbox. Never move execution into the browser or claim
  a run happened without a response.
- Six runtimes are supported behind `src/features/editor/projectLanguages.ts`: Python,
  JavaScript, TypeScript, C, C++, Java. Keep the editor language metadata in sync with what
  the runner actually advertises; both currently expose those six and Go is not offered.
  HTML, CSS and JSON are editor-only and must be labelled that way. Only Python has a real
  tracer; other languages are explicitly unsupported rather than simulated.
- Hidden practice tests live **only** in `server/problems.mjs`. `/grade` must never
  return hidden inputs, expected outputs or full hidden output, and the frontend must
  never bundle them. Visible tests may be shown and run locally.
- The execution client is `src/features/execution/api.ts`; every failure is an
  `ExecutionServiceError` with an honest start command. The shared Monaco surface for
  non-workspace pages is `StandaloneEditor`; the workspace Run tab reads the live draft
  through `EditorCommandsContext`.
- Converter AI parsing is `src/features/converter/convert.ts`; review uses the real LCS
  diff in `diff.ts`; handoff from the workspace uses `staging.ts`. Saves and replaces
  write the IndexedDB copy, never a linked folder on disk.
- Practice catalog content lives in `src/features/practice/catalog.ts`; progress,
  drafts, notes, bookmarks and submissions are stored by `progressStorage.ts`.
- Dropdowns in the app use the accessible `src/design-system/primitives/Select.tsx`
  (portalled menu, explicit contrast, keyboard support). Native `<select>` options still
  get a dark global fallback, but new UI should prefer `Select`. Verify the opened menu,
  not only the closed control.

## Terminal (Milestone 3)

- `server/terminal.mjs` hosts a real PTY (`node-pty`, ConPTY on Windows) on the loopback
  sidecar; `server/index.mjs` exposes `GET /terminal/health` and the WebSocket upgrade at
  `/terminal`. It is not part of `/run` and must never become an unauthenticated shell.
- Guards: loopback bind, Origin allow-list, and a per-start pairing token printed only on the
  service console. Tokens rotate on restart. The browser keeps the current token in
  `sessionStorage` under `codepilot.terminal.token.v1`; never persist it to Dexie/localStorage.
- Frames are JSON text: server `ready` / `output` / `exit` / `error`; client `input` /
  `resize` / `cwd`. A `cwd` change validates the directory and restarts the shell there.
  Windows kills use `taskkill /PID /T /F`.
- Frontend lives in `src/features/terminal/`: `client.ts` (health + socket + typed frames),
  `TerminalPanel.tsx` (mode, token, cwd, status, offline state) and `TerminalSurface.tsx`
  (lazy xterm + FitAddon in its own chunk). The panel stays mounted while the bottom panel is
  open so tab switches do not kill the shell.
- Cloud mode has no runtime in this build: render the disabled control with its real reason,
  never a simulated prompt.
- Verified on Windows only. Linux/macOS lack `node-pty` prebuilds here and npm allow-scripts
  blocks its install script.

## TypeScript / React landmines

- `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`: no enums/namespaces/parameter properties; use `import type`.
- `eslint-plugin-react-hooks` v7 rejects synchronous `setState` inside effects and
  impure render calls (`Math.random`, `performance.now`). Use event handlers, lazy
  `useState` initializers, and the existing deterministic PRNG patterns.
- Dialogs must use `src/lib/useFocusTrap` (Escape close, focus trap, focus restore).
  `Ctrl/⌘ K` toggles the palette globally.

## Browser verification quirks

- The in-app browser viewport is ~912×766 CSS px; the desktop sidebar appears at the
  wide breakpoint, so verify both the in-app browser and a 1440×1000 headless Edge
  screenshot (`msedge --headless=new --window-size=1440,1000
  --virtual-time-budget=9000 --screenshot=<path> <url>`).
- Headless Chromium/Edge often fails to render WebGL; confirm the live scene in the
  in-app browser, not from a headless screenshot.
- Fixed/sticky elements can stitch badly in tall screenshots; capture the viewport and
  scroll to a deterministic position first.
- Framer Motion exit animations may appear stuck in a backgrounded in-app tab because
  rAF is throttled. Force a screenshot/frame before judging overlay state, and verify
  overlay logic through `aria-expanded`, body overflow, and the actual route.
- Headless Chromium enforces a minimum window width, so `--window-size=390,844` clips a
  wider layout. For true narrow-viewport checks, use a same-origin iframe harness at the
  target width and measure `documentElement.scrollWidth` plus element rects.
