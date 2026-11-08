# CodePilot Lab — agent guide

Local-first, AI-native coding laboratory. React 19 + TypeScript + Vite SPA; no backend,
no paid APIs, no secrets. Milestones are sequenced deliberately — implement only the
requested phase (see README) and do not jump ahead to execution or the remaining
placeholder modules unless asked.

## Non-negotiable product rules

- Never invent project data, timestamps, terminal output, AI responses, metrics, or
  health. Every readout must come from a real browser/IndexedDB/WebGL/file API.
- Every visible control must work or be visibly marked unavailable ("Scheduled" /
  disabled). Placeholder screens must say so plainly.
- Local-only: dependencies and fonts are bundled. Do not add CDN fonts, remote API
  calls, telemetry, or a server.

## Commands

```bash
npm run dev        # Vite, port 5173
npm run typecheck  # tsc -b
npm run lint       # eslint .
npm run build      # tsc -b && vite build
```

There is no test runner. Verification = typecheck + lint + build + manual browser
checks. ESLint ignores `dist/` and `node_modules/`.

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
- Project records live in IndexedDB through Dexie (`src/lib/db.ts`) under schema v2:
  `projects`, `files` (tree entries), `contents` (saved text) and `settings`. Storage
  services belong in `src/lib/projectStorage.ts`, never in components. Stored content
  is authoritative after the first save; `directoryHandle` is only an honestly
  disclosed read fallback and is structured-clone data. Opening a legacy record
  migrates its manifest into entries without resetting user data.
- The Monaco surface is `MonacoWorkbench` behind `React.lazy` in `EditorArea`. Keep
  bundling local (no CDN); editor text models are owned by the workbench and must be
  disposed with tabs. Dirty state comes from `getAlternativeVersionId`, and live drafts
  live only inside Monaco models — the reducer keeps snapshots. Cross-component
  editor actions (save, save-all, find, reveal) go through `EditorCommandsContext`,
  not ad-hoc window globals.
- Shortcuts: `Ctrl/⌘ S / Shift S / P / Shift F / F / PageUp / PageDown` are implemented
  both inside Monaco (`monaco.addCommand`) and in `WorkspaceShell`'s global handler,
  which skips events originating inside `.monaco-editor` to avoid double handling.
- Import is a real folder scan via the File System Access API or a `webkitdirectory`
  input. Excluded directories and the scan cap are product-visible policy; do not
  silently drop files. Recent projects and dossiers must read from Dexie or show an
  explicit unavailable/empty state — never seed sample projects.
- App version is injected as `__APP_VERSION__` from `package.json` in
  `vite.config.ts`. Never hardcode a version string.

## AI Copilot (Phase 5)

- Provider code lives in `src/features/copilot/providers/*` behind the `AiProvider`
  interface. Two adapters exist: native `ollama` (NDJSON `/api/chat`, `/api/tags`) and
  `openai-compatible` (SSE `/chat/completions`, `/models`). Add a provider by adding an
  adapter and a preset, not by branching inside the dock.
- Settings are an external store (`settingsStore.ts`) consumed through
  `useSyncExternalStore` so the dock and `/settings` stay in sync. Persisted under the
  Dexie `settings` key `copilot.provider.v1`; the API key is persisted only when the user
  opts into "remember". Never ship, log or hardcode a key. `verified` means a real
  request succeeded in this session — saving settings clears it.
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
