# CodePilot Lab

A local-first, AI-native coding laboratory. Built as an instrument, not a dashboard.

**Current milestone: Milestone 6 — account export, with production infrastructure blocked.**
The settings account panel can download the account's real server-side data as JSON, and the
API tests prove two accounts cannot read each other's projects, files or AI credentials and
that deletion revokes the session. PostgreSQL, hosting, TLS, monitoring and backups are still
absent, so durability and deployment are not claimed. Milestones 1 (AI gateway and accounts),
2 (editor action bar, dropdown fix), 3 (local terminal), 4 (device files) and 5 (GitHub
configuration gate) are complete. `docs/technical-audit.md` §11–16 records the evidence, and
`docs/session-handoff.md` is the current resume point. No deployment, PostgreSQL run, GitHub
round trip or live model completion has happened yet.

**Previous milestone: Phase 7 — Public beta hardening.** The lab includes a
static public site with honest SEO, a real feedback pipeline, automated tests, centralized
stored-path validation, route-level error boundaries and lazy modules, a hardened loopback
execution service, and deployment/security documentation. The deployment default is
frontend-only: execution remains a local companion process and is not offered as a public
sandbox.

## Public beta at a glance

- **Public site:** `public/home.html`, `features.html`, `workspace.html`, `copilot.html`,
  `tracer.html`, `practice.html`, `converter.html`, `docs.html`, `about.html`,
  `feedback.html`, `privacy.html` and `terms.html`, with `robots.txt`, `sitemap.xml`,
  canonicals, Open Graph metadata and structured data.
- **Private app:** the React SPA is explicitly `noindex`; `vercel.json` also sends
  `X-Robots-Tag` on app routes and rewrites direct navigation back to the shell.
- **Tests:** `npm run test` runs Vitest suites for stored paths, feedback storage/delivery,
  proposal parsing, diffs and executor request validation.
- **Feedback:** written to IndexedDB first (`feedback` table, schema v4). If
  `VITE_FEEDBACK_ENDPOINT` is set, the same JSON is POSTed and the UI reports local-only,
  delivered, or failed with the HTTP status.
- **Security:** loopback-only execution by default, bearer token required for an explicit
  remote bind, CORS allow-list, concurrency cap/HTTP 429, sanitized 500s, stdin limits and
  process cleanup. Still a resource-limited runner, not a sandbox.
- **Docs:** `docs/architecture.md`, `docs/deployment.md`, `docs/security.md` and
  `docs/production-readiness.md`.

## What actually works

- **Execution Lab** (`/lab` and the workspace **Run** tab). Real compile/run through a
  loopback Node service (`npm run exec`, `127.0.0.1:5310`) with temp directories,
  timeouts, measured duration, real stdout/stderr/compile errors, stdin, Run/Stop and
  clear. Six verified runtimes: Python 3.14, Node 24 (JavaScript and TypeScript via type
  stripping), GCC/G++ 16 and JDK 26 (javac/java). Go is not offered by the runner. The
  service is resource-limited and is explicitly **not** a security sandbox.
- **Variable & execution tracer** for Python, instrumented with real `sys.settrace`
  events: step forward/back, play/pause/restart, timeline scrubber and speed, current
  line, locals with type/value/previous/changed/scope/declaration, call stack, and
  branch/loop/call observation derived from actual events. Other languages are labelled
  unsupported rather than simulated.
- **Code Converter** (`/convert`). Nine languages (C, C++, Python, Java, JavaScript,
  TypeScript, HTML, CSS, JSON), project/editor/paste sources, swap, instructions,
  streamed provider conversion, a real LCS line diff, accept/reject, copy/download,
  save-as-new, replace-with-confirmation, persisted history, honest warnings, and a real
  validation run of the converted program.
- **Practice Arena** (`/practice`, `/practice/:problemId`). Thirteen original
  Easy/Medium/Hard problems across arrays, strings, hashing, sorting, binary search, two
  pointers, sliding window, linked lists, stacks, queues, recursion, backtracking, trees,
  graphs, DP, greedy, bit manipulation and math. Split statement/workspace, six
  languages, persisted drafts and notes, progressive hints, gated explanation/solution,
  visible-case Run, private-suite Submit, verdicts, hidden-case protection and stored
  submission history.
- **Shared editor and AI.** The same Monaco primitives, provider adapters and settings
  are reused by the lab, converter and practice workspace. Inline streaming AI help
  explains code, errors, the current trace step and practice approaches without a second
  AI stack.
- **Project language selector.** New projects choose from the nine real languages,
  write a starter file to IndexedDB, and the workspace status bar shows the active file
  language and whether it is runnable.
- **AI Copilot** in the workspace dock (`/copilot` explains the model; `/settings`
  configures it). Three routes, one interface: managed **CodePilot AI** through the API
  (no provider key in the browser, server-side quotas), a native **Ollama** adapter
  (`/api/chat`, NDJSON streaming, direct or via the API) and an **OpenAI-compatible**
  adapter (SSE `/chat/completions`) covering DeepSeek, OpenAI, OpenRouter, Groq, LM Studio,
  llama.cpp and user-run proxies. The app is fully usable with no provider configured;
  the dock states that plainly instead of inventing an answer.
- **Seven AI modes** — free-form chat, explain (beginner/intermediate/advanced),
  debug, code generation, code review, test generation, and a learning assistant that
  starts with hints and only gives the full solution when asked. Every mode shares the
  same conversation, context controls, streaming and stop button.
- **Project-aware context you can inspect.** Toggles decide whether the active file,
  selection, file tree and real Monaco diagnostics are eligible; other files must be
  attached explicitly from a tab or the explorer. A character budget caps the bundle,
  truncation and unreadable files are disclosed, and the context panel shows the exact
  bundle before it is sent. No project is ever uploaded wholesale.
- **Reviewable changes, never silent writes.** Models answer with complete-file
  `codepilot` proposal blocks. CodePilot parses them defensively, refuses absolute or
  escaping paths, and shows a side-by-side diff against the live draft, saved copy or
  linked folder copy. Accepting applies one undoable Monaco edit; saving stays manual.
  Revisions keep the previous whole-file content for restore, and an applied file is
  visibly dirty until you save it.
- **Credentials stay yours.** No key ships in the bundle. Keys are typed at runtime,
  live in memory by default, and are only persisted to IndexedDB when you opt in. A
  local proxy can hold secrets server-side by pointing the base URL at it. Status is
  honest: `unconfigured` → `configured` (saved, unverified) → `verified` only after a
  real model list or chat request succeeded in this session.
- **Streamed, stoppable responses** with copy, clear conversation, per-request context
  disclosure, and explicit error kinds for auth, network, provider, CORS and rate-limit
  failures. Nothing is retried silently.
- **Command Center** with a personalized time-of-day greeting, product headline,
  descriptions, `Enter workspace` and `Create new project` actions, and the live
  Lattice-01 visual.
- **Real local project registry** in IndexedDB through Dexie. Records contain only data
  that was actually written or scanned: name, language, source, timestamps, file counts,
  sizes, manifest, exclusions, and an optional directory handle. Projects can now be
  **renamed and deleted** from the picker, both with confirmation dialogs and duplicate
  name checks. Deletion cascades to the stored tree and contents; linked folders on disk
  are never touched.
- **Project picker** (`/workspace`) lists stored records with live search, real
  timestamps, open counts, and honest empty/unavailable states. The registry is never
  seeded.
- **Versioned storage schema (v4).** Tree entries (`files`) and file contents (`contents`)
  are stored separately from project records. Opening a Phase-2/3 era record transparently
  migrates its manifest into entries — no user data is reset. Schema v4 adds the `feedback`
  table.
- **Stored-path validation.** Every write through `createStoredEntry`,
  `renameStoredEntry`, `writeStoredContent` and `deleteStoredEntry` rejects `..`, absolute
  paths, drive letters, control characters, empty segments and reserved Windows names.
- **Workspace** at `/workspace/:projectId`: persisted explorer tree, elegant tabs,
  breadcrumbs, Copilot dock, and the bottom development panel.
- **Monaco editor** (bundled locally, lazy-loaded; no CDN) with line numbers, bracket
  matching, folding, indentation, find & replace, multi-cursor editing, a configurable
  minimap, word wrap, font size controls, and auto resize. Monaco is loaded only when a
  file is opened and always shows the selected file's real contents — placeholder text is
  never shown in its place; loading, unavailable, and error states are rendered around
  the canvas instead.
- **Language modes** for TypeScript, JavaScript, Python, Java, C, C++, HTML, CSS/SCSS/
  Less, JSON, Markdown, YAML, XML, Shell, PowerShell, SQL, Rust, Go, Ruby, PHP, Swift,
  Kotlin, C#, Dockerfile and more, plus two custom themes that match the lab (Midnight
  and Graphite). TypeScript/JavaScript get the in-file language service; import
  resolution (codes 2307/2792/6133) is deliberately ignored because there is no module
  graph yet, and the Problems panel says so. Syntax highlighting is broader than runtime
  support: Python, JavaScript, TypeScript, C, C++ and Java can run through the local
  service; HTML, CSS and JSON are editor-only.
- **File operations.** Create, rename and delete files/folders (persisted, with
  rename carrying over the unsaved draft), tab switching that preserves edits in Monaco
  models, dirty indicators, close-tab protection for unsaved buffers
  (Save & close / Discard / Cancel), save all, and content restore when reopening a
  project.
- **Editor workflow.** `Ctrl/⌘ S` save, `Ctrl/⌘ Shift S` save all, `Ctrl/⌘ P` quick
  open over stored files, `Ctrl/⌘ F` find & replace in the editor, `Ctrl/⌘ Shift F`
  project search over stored contents (results are capped and disclosed),
  `Ctrl/⌘ PageUp/PageDown` tab cycling, plus `Ctrl/⌘ B` panel toggling from Phase 3.
- **Real persistence.** Every save writes through to IndexedDB; reloading the page and
  reopening the project restores saved files. When a project is linked to a device folder
  that grants write access, the same save is also written to that folder; if the folder is
  unavailable, the browser save still succeeds and the disk outcome is reported separately.
- **Device files.** Open a real text file, import a folder or a `.zip` project archive, drag
  files onto the explorer, save a copy, export a project archive, and reconnect a device
  folder from the dossier. Permission state, storage origin and skipped archive entries are
  shown explicitly; nothing is written to a folder without granted write access.
- **Problems** panel fed by real Monaco markers collected from open buffers, with
  per-language validation coverage disclosed in Diagnostics.
- **Recent projects** are read live from IndexedDB, sorted by last opened. Opening a
  project increments its real open count and last-opened timestamp.
- **Project dossier** at `/workspace/:projectId/overview`: real metadata, manifest
  preview, and storage facts.
- **System status** reports only checks performed in this browser.
- **Lattice-01** centerpiece with measured FPS, capability-based SVG fallback, and
  offscreen pausing.

## What is deliberately not built yet

Project Atlas, Project Vault, and Activity & Diagnostics remain placeholders. The Terminal tab
opens a real local shell through the loopback sidecar and states that it is a shell on the host
machine, not a sandbox; a cloud terminal is not configured and is rendered as unavailable. The
Output view still states plainly that no channel has produced output, and program execution
remains available through the Run tab. There is no hardened sandbox: the execution service is a
resource-limited local runner, not a security boundary. HTML, CSS and JSON are editor languages
with no runtime, and only Python has a real tracer in this phase.

No paid dependency is required for the editor, execution, tracing, converter UI or practice
grading, and the editor keeps working with no account and no AI provider. Managed CodePilot
AI needs the API (`server/api`) running with a server-side provider configured; a local
model (for example Ollama) or any OpenAI-compatible endpoint can instead be connected
directly from Settings as the advanced mode. GitHub integration is not available: Settings
shows the real configuration gate and no repository or commit action exists.

## Run

```bash
npm install
npm run api:dev  # CodePilot API on http://127.0.0.1:8787 (separate terminal)
npm run dev      # Vite on http://localhost:5173, proxies /api
npm run exec     # local execution service on http://127.0.0.1:5310 (separate terminal)
```

Open the URL printed by Vite (default `http://127.0.0.1:5173`). The editor, converter
review and practice browsing work without the execution service; running, tracing and
submitting show the explicit start command instead of fabricating a result. Without the API
or a configured provider, `/settings` reports “No AI provider is available” and no AI
request is attempted.

```bash
npm run typecheck    # frontend + API
npm run lint
npm test             # frontend (84 tests)
npm run test:api     # API (19 tests)
npm run build
npm run preview
```

Public pages are served directly by Vite from `public/` (for example
`http://localhost:5173/home.html`). `npm run build` copies them into `dist/`. Set
`SITE_URL` and run `npm run site:url` (or use the Vercel build command) to make
canonical/Open Graph/sitemap URLs absolute.

## Stack

React 19 + TypeScript + Vite, React Router, Dexie / IndexedDB, Monaco Editor, Three.js /
React Three Fiber / drei, Framer Motion, Lucide, CSS Modules with custom-property
tokens, and locally bundled Inter / Space Grotesk / JetBrains Mono via Fontsource.

## Structure

```
server/             loopback execution service: HTTP API, compile/run, grading,
                    Python sys.settrace instrumentation, private problem suites
server/api/         CodePilot API: accounts, sessions, PostgreSQL/memory stores,
                    AI gateway (managed + encrypted BYO), quotas, SSE chat
scripts/            set-site-url.mjs build-time canonical/OG/sitemap rewrite
docs/               audit, AI gateway, architecture, deployment, security,
                    production readiness, session handoff
public/             static marketing site, screenshots, robots.txt, sitemap.xml
src/
  app/              shell, sidebar, top bar, command palette, mobile menu, status bar,
                    routes, route error boundary and lazy fallback
  brand/            logo mark and wordmark
  design-system/    tokens, base styles, button / badge / kbd / skeleton / select primitives
  features/
    editor/         Monaco integration layer: setup (workers, themes, TS service),
                    language registry, project languages, preferences, command context
    copilot/        provider adapters, gateway client/store, settings store, context
                    builder, proposal parser, diff engine, markdown, dock dialogs,
                    overview, quick AI help
    execution/      Execution Lab page, execution-service client, standalone Monaco editor
    converter/      conversion prompt/parser, line diff, staging, storage, converter page
    practice/       original problem catalog, persisted progress, library and workspace
    feedback/       public beta feedback form
    settings/       live provider, credential and account settings page
    workspace/      state (reducer/context), storage-backed pages, explorer, tabs,
                    Monaco workbench, dialogs, quick open, development panel, Run tab
    command-center/ landing, welcome card, quick actions, system status
  lib/              Dexie schema (v4) + storage services, stored-path validation,
                    feedback delivery, folder scanning, formatting, focus trap, WebGL support
  three/            lazy-loaded R3F canvas and Lattice scene
```

## Local data and policy

- The database (`codepilot-lab`) is versioned. Schema v4 keeps `projects`, `files`
  (tree entries, keyed `[projectId+path]`), `contents` (saved text, keyed
  `[projectId+path]`), and `settings`, adds `conversions`, `practiceProgress`,
  `practiceSubmissions` and `feedback`. Migration backfills entries from old manifests and
  fabricates no content.
- Hidden practice tests exist only in `server/problems.mjs`. `/grade` returns case
  indices, hidden flags, statuses and bounded visible stderr — never hidden inputs,
  expected outputs or full hidden output. The same suites are not bundled into the
  frontend.
- Conversions, practice drafts, notes, bookmarks and submissions are stored in browser
  IndexedDB only.
- AI settings are stored under the `settings` key `copilot.provider.v1`. With the default
  managed route, no provider key exists in the browser at all: the API holds it. A
  BYO connection routed through the API stores the key encrypted on the server and the
  browser keeps `apiKey: ""`. Only in the advanced `direct` route can a key be written to
  IndexedDB, and only when "remember" is checked; the UI labels that as plaintext.
- Context is assembled in the browser and sent only to the configured route (the CodePilot
  API or the endpoint you entered), only when you press Send.
- Stored content is authoritative after the first save. A linked `directoryHandle` is
  read only when no saved copy exists; permission prompts are disclosed.
- `directoryHandle` is structured-clone data; re-permission may be requested on read.
- Excluded directories and the 3,000-file / 12-level import caps are product-visible
  policy and disclosed on import and in Diagnostics.
- Deleting a project is explicit, confirmed, and cascades through the registry, tree and
  contents. Clearing site data for the origin removes everything stored.

## Verification

- `npm run typecheck`, `npm run lint`, `npm test` (84 frontend tests, 8 files), `npm run
test:api` (19 tests) and `npm run build` pass.
- Milestone 6 verification covered: a real account export download (1,499 bytes) containing
  the server project, file content, settings and `keyLast4` but no secret, hash or token text;
  two-account isolation for projects, files and AI credentials; and deletion revoking the
  session while the other account remains intact. PostgreSQL and deployment were not run.
- Milestone 5 configuration-gate verification covered: signed-out status is not probed;
  missing GitHub variables are listed by name; configured credentials report “present”
  without returning a secret; Re-check issues a new real request; the panel never offers a
  connect or repository action.
- Milestone 4 verification covered: real single-file open into a project; browser-first save
  with a dirty buffer; ZIP export and CRC-checked re-import with identical content; dossier
  export; OPFS-handle relink with read-write permission and a matching device copy; honest
  disk failure after the folder disappeared; drag-and-drop add and collision reporting;
  corrupt-archive and denied-picker errors; persistence across reload; 1440 and 390 px
  layouts.
- Milestone 3 verification covered: the real ConPTY banner and prompt, typed command output,
  exit code, tab-switch session continuity, wrong-token rejection, token rotation on restart,
  and offline recovery. Windows only.
- Milestone 2 verification covered: the dropdown staying open while its list scrolls,
  keyboard selection, Run/Trace against the local sidecar, disabled Trace for non-Python,
  Save all, Format, the More menu, and toolbar density at 554 px.
- Milestone 1 verification covered: gateway health honesty, session isolation, CSRF,
  managed SSE, quota; BYO credentials stored encrypted on the API with no key in the
  browser; honest failure when no provider is available; gateway-routed conversion failure
  recorded in history; conversion parser cases (multi-fence, truncated, empty, comments-only,
  unbalanced delimiters); partial-output retention.
- Phase 7 verification covered: stored-path rejection for traversal/absolute/control
  characters; feedback local persistence and endpoint success/failure; proposal parsing and
  diffing; executor validation and hidden-data response shape; static public pages and SEO
  assets; private-route noindex; lazy route fallback and error boundary; the New Project
  language dropdown in its opened state; direct-route refresh; desktop and narrow layouts.
- The Phase 7 production build was also served locally with the exact `vercel.json` CSP,
  noindex headers and rewrites: direct routes survived refresh, Monaco rendered with zero
  CSP violations, a real Python run and 9-event trace succeeded, feedback persisted to
  IndexedDB, all 12 static pages passed metadata/link/image checks, and 390 px layouts had
  no document overflow. `dist/` had no secret-like strings and `npm audit --omit=dev`
  reported zero vulnerabilities after a `dompurify@3.4.17` override.
- Phase 6 verification covered: health probes for all runtimes; real programs in Python,
  JavaScript, TypeScript, C, C++ and Java; stdin, measured duration and
  compile/runtime errors; Stop/cancel; Python trace events, variables, stack and
  timeline controls; converter source modes, streamed conversion, diff, accept/reject,
  save/replace and validation; practice Run and Submit, hidden-case protection, verdict
  storage, hints and solution gating; persistence across reload.
- Phase 5 verification covered: unconfigured-provider honesty and settings save/forget,
  a real streamed Ollama request (start, stop, copy, clear), proposal parsing → diff →
  accept → dirty buffer → undo/restore, the Problems "Ask Copilot" entry point, failing
  endpoints and rate-limit copy, context toggles and exact-bundle preview, `/settings`
  and `/copilot` pages, and regression checks over the editor and Command Center.
- Phase 4 verification covered: Monaco mount and highlighting, multi-file tab switching
  with draft preservation, save/reload persistence through IndexedDB, create/rename/
  delete of files and folders, project rename/delete, quick open and content search,
  shortcut behaviour, storage failure disclosure, and regression checks over the Command
  Center, dossier and responsive layouts.
- The 3D lattice still requires WebGL; the static fallback is used otherwise.

## Known constraints

- The registry is specific to this browser profile. It does not sync; a project archive can
  be exported and re-imported as a `.zip`, but that is not a registry backup or cross-device
  sync.
- The folder picker is Chromium-only; other browsers store a manifest without a handle.
- Monaco's TypeScript service understands the open file in isolation: project-wide
  resolution, tests and builds are not claimed as verified anywhere in the product.
- Monaco and the 3D scene load as lazy chunks. Route-level lazy loading keeps the initial
  bundle smaller, but Monaco workers still initialize on first editor use.
- The Copilot calls model providers directly from the browser. CORS can block a remote
  provider; free tiers rate-limit and the UI reports the provider's status rather than
  retrying. Proposals are complete files, so very large files hit the diff line cap.
  Conversation history is per workspace session and is not archived to disk.
- Execution is a resource-limited loopback Node runner, not a hardened sandbox. It is
  bound to `127.0.0.1`, uses temporary directories, timers and tree-kill, but it must not
  be exposed to untrusted networks. Only Python has a real tracer; other languages are
  marked unsupported. HTML, CSS and JSON have no runtime. AI conversion quality depends
  entirely on the configured provider and is never claimed to be behaviour-preserving.
- Device write-through requires a linked folder whose handle grants read-write access. A
  browser save always succeeds on its own; disk writes are an additional, separately
  reported outcome. Native OS picker prompts, permission denial and revocation were not
  automated in this environment, and the download fallback is a file download rather than a
  linked folder.
- No analytics provider is configured. No user counts, ratings or testimonials are
  published.
