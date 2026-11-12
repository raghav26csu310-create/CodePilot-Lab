# Architecture

> **Status note (2026-11-12):** the sections below describe the frontend-only beta that
> existed before the AI gateway work. A loopback API now lives in `server/api` and the
> default AI route is the CodePilot gateway. Read
> [`technical-audit.md`](./technical-audit.md) §10–11 and [`ai-gateway.md`](./ai-gateway.md)
> for the current backend shape; the browser-first description here is still accurate for
> the editor, storage and execution parts.

CodePilot Lab is a browser application with one optional local companion process. There is no
application backend, no account service and no database server.

```
Browser (React 19 + Vite)
├── Command Center ......... project registry in IndexedDB
├── Code Workspace ......... Monaco, tree, tabs, dirty buffers
├── AI Copilot ............ direct calls to a user-configured provider
├── Execution Lab ......... HTTP to 127.0.0.1:5310
├── Practice Arena ........ visible runs + private submissions
├── Code Converter ........ provider conversion + local diff
├── Settings .............. provider credentials
└── Feedback .............. IndexedDB first, optional endpoint POST

Local sidecar (Node, loopback only)
├── /health  /run  /trace  /grade  /cancel  /problems
├── executor.mjs .......... probes, temp dirs, compile/run, tree-kill
├── trace_python.py ....... real sys.settrace recorder
└── problems.mjs .......... hidden practice suites (never bundled)
```

## Frontend

- `src/app/` owns the shell, routing, command palette, mobile menu, status bar and the
  route-level error boundary. Heavy modules are `React.lazy` chunks; the 3D stage has its
  own lazy boundary and a static fallback.
- `src/features/` contains the modules. Cross-component editor actions go through
  `EditorCommandsContext`; workspace state is a reducer/provider pair.
- `src/lib/` owns Dexie schema and storage services, path validation, feedback, formatting
  and browser capability hooks.
- `src/design-system/` owns tokens, base styles and primitives. Styling is CSS Modules;
  there is no Tailwind and no remote font/CDN dependency.

## Data model (Dexie schema v4)

| Table | Key | Purpose |
| --- | --- | --- |
| `projects` | `id` | Registry metadata and optional folder handle |
| `files` | `[projectId+path]` | Tree entries, separate from content |
| `contents` | `[projectId+path]` | Saved text, loaded on demand |
| `settings` | `key` | Provider settings under `copilot.provider.v1` |
| `conversions` | `id` | Converter history |
| `practiceProgress` | `problemId` | Attempts, drafts, notes, bookmarks |
| `practiceSubmissions` | `id` | Verdict history |
| `feedback` | `id` | Local feedback and delivery status |

Stored content is authoritative after the first save. A linked `directoryHandle` is a
read-only fallback and is structured-clone data, not a filesystem write path.

## Security boundaries

- The browser is untrusted with respect to the sidecar. The sidecar validates every request,
  caps body/code/stdin/output sizes, limits concurrency, applies timeouts and tree-kills
  processes.
- The sidecar binds to loopback by default. A non-loopback bind is refused unless
  `EXEC_ALLOW_REMOTE=1` and `EXEC_TOKEN` are both set; even then it is not a sandbox.
- The AI provider is chosen by the user. No key is bundled, and requests go from the tab to
  the user's endpoint.
- Stored paths are validated centrally in `src/lib/storedPaths.ts`; traversal and absolute
  paths are rejected before any IndexedDB write.

## Build and deployment

`npm run build` runs `tsc -b` and `vite build`. The output is a static `dist/` tree plus
static marketing pages copied from `public/`. Vercel configuration adds SPA rewrites for
private app routes, security headers and `noindex` for private screens. See
`docs/deployment.md`.
