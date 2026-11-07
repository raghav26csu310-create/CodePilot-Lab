# CodePilot Lab

A local-first, AI-native coding laboratory. Built as an instrument, not a dashboard.

**Current milestone: Phase 4 — The Core Editing Engine.** The workspace now mounts a
real Monaco editor wired to a persisted project tree: real stored file contents,
unsaved-change tracking, local saves to IndexedDB, quick open and project-wide content
search, and project rename/delete in the registry picker. It still does not execute code
and does not call any model.

## What actually works

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
- **Versioned storage schema (v2).** Tree entries (`files`) and file contents
  (`contents`) are stored separately from project records. Opening a Phase-2/3 era
  record transparently migrates its manifest into entries — no user data is reset.
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
  graph yet, and the Problems panel says so. Syntax highlighting does not mean the
  language can execute — runtime support is not built.
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
  reopening the project restores saved files. Linked folder handles are used only as an
  honest read fallback when nothing was ever saved.
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

AI Copilot bridge, Project Atlas, Execution Lab (code cannot be run in any language),
Project Vault, Activity & Diagnostics, and Settings remain placeholders. The development
panel's Terminal and Output views state plainly that no process has ever run and no
output is simulated.

No backend, account, API key, database service, or paid dependency is required to run
this milestone.

## Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite (default `http://127.0.0.1:5173`).

```bash
npm run typecheck
npm run lint
npm run build
npm run preview
```

## Stack

React 19 + TypeScript + Vite, React Router, Dexie / IndexedDB, Monaco Editor, Three.js /
React Three Fiber / drei, Framer Motion, Lucide, CSS Modules with custom-property
tokens, and locally bundled Inter / Space Grotesk / JetBrains Mono via Fontsource.

## Structure

```
src/
  app/              shell, sidebar, top bar, command palette, mobile menu, status bar, routes
  brand/            logo mark and wordmark
  design-system/    tokens, base styles, button / badge / kbd / skeleton primitives
  features/
    editor/         Monaco integration layer: setup (workers, themes, TS service),
                    language registry, editor preferences, command context
    workspace/      state (reducer/context), storage-backed pages, explorer, tabs,
                    Monaco workbench, dialogs, quick open, development panel
    command-center/ landing, quick actions, system status
  lib/              Dexie schema (v2) + storage services, folder scanning, formatting,
                    focus trap, WebGL support, stage activity, sidebar preference
  three/            lazy-loaded R3F canvas and Lattice scene
```

## Local data and policy

- The database (`codepilot-lab`) is versioned. Schema v2 keeps `projects`, adds `files`
  (tree entries, keyed `[projectId+path]`), `contents` (saved text, keyed
  `[projectId+path]`), and `settings`. Migration backfills entries from old manifests
  and fabricates no content.
- Stored content is authoritative after the first save. A linked `directoryHandle` is
  read only when no saved copy exists; permission prompts are disclosed.
- `directoryHandle` is structured-clone data; re-permission may be requested on read.
- Excluded directories and the 3,000-file / 12-level import caps are product-visible
  policy and disclosed on import and in Diagnostics.
- Deleting a project is explicit, confirmed, and cascades through the registry, tree and
  contents. Clearing site data for the origin removes everything stored.

## Verification

- `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- Phase 4 verification covered: Monaco mount and highlighting, multi-file tab switching
  with draft preservation, save/reload persistence through IndexedDB, create/rename/
  delete of files and folders, project rename/delete, quick open and content search,
  shortcut behaviour, storage failure disclosure, and regression checks over the Command
  Center, dossier and responsive layouts. See the final phase report for details.
- The 3D lattice still requires WebGL; the static fallback is used otherwise.

## Known constraints

- The registry is specific to this browser profile. It does not sync and is not exported
  yet.
- The folder picker is Chromium-only; other browsers store a manifest without a handle.
- Monaco's TypeScript service understands the open file in isolation: project-wide
  resolution, tests and builds are not claimed as verified anywhere in the product.
- The main bundle still ships the lazy 3D scene; Monaco loads as separate lazy chunks
  (workers + editor core) only when the editor is opened.
- Execution, AI bridge, and editor→disk write-through remain scheduled for later phases.
