# CodePilot Lab

A local-first, AI-native coding laboratory. Built as an instrument, not a dashboard.

**Current milestone: Phase 2 — Cinematic Command Center.** The application now has a
persistent navigation shell, a real local project registry, project creation and folder
import, recent project activity, and verifiable system status. It is still not an editor.

## What actually works

- **Command Center** with a personalized time-of-day greeting, product headline,
  descriptions, `Enter workspace` and `Create new project` actions, and the live
  Lattice-01 visual.
- **Collapsible sidebar** with seven product areas, active states, keyboard-accessible
  controls, and a persisted collapse preference (`localStorage`,
  `codepilot.sidebar.collapsed`). Below 1024 px it is replaced by a focused mobile
  navigation dialog.
- **Command palette** (`Ctrl/⌘ K` or **Jump to**): substring search across module names,
  taglines, and live/scheduled status; arrow-key navigation, `Enter` to open, `Esc` to
  close, focus trap and focus restore.
- **Real local project registry** in IndexedDB through Dexie. Records contain only data
  that was actually written or scanned: name, language, source, timestamps, file counts,
  sizes, manifest, exclusions, and an optional directory handle.
- **Create project** writes a real record to this browser. Duplicate names are rejected,
  input is validated, and failures caused by unavailable storage are reported.
- **Import project** performs a genuine local folder scan through the File System Access
  API, with a `webkitdirectory` fallback. Vendored directories are excluded and disclosed;
  manifests are capped at 3,000 files and 12 directory levels; truncation is shown.
- **Recent projects** are read live from IndexedDB, sorted by last opened, and show real
  language, file count, modified time, and folder-link status. Opening a project
  increments its real open count and last-opened timestamp.
- **Project dossier** at `/workspace/:projectId`: loads the stored record, shows real
  metadata and a manifest preview, handles missing records and unavailable IndexedDB, and
  states plainly that the editor is scheduled. The record ID can be copied.
- **Quick actions** for Open Workspace, Create Project, Import Project, Project Atlas, and
  Execution Lab. Implemented destinations work; scheduled destinations open their
  placeholder pages and are labelled `Soon`.
- **System status** reports only checks performed in this browser: application build,
  IndexedDB/localStorage availability and storage estimate, WebGL support, whether a
  browser language model is present, motion preference, and the injected app version.
- **Lattice-01**, the centerpiece: React Three Fiber scene with an instanced faceted core,
  wireframe shell, orbital rings, dust, pointer parallax, and a click pulse. The FPS
  readout is measured at runtime, not simulated.
- Static SVG fallback for reduced-motion and no-WebGL environments, chosen from real
  capability detection. Canvas pauses while offscreen or hidden.
- Honest placeholder pages for modules that are scheduled but not built.

## What is deliberately not built yet

Code Workspace (file tree, tabs, Monaco, local save), AI Copilot, Project Atlas,
Execution Lab, Project Vault, Activity & Diagnostics, and Settings are placeholders. They
state that they are scheduled and do not render invented files, output, metrics, or AI
responses. `Open editor` is visibly disabled on project dossiers.

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

React 19 + TypeScript + Vite, React Router, Dexie / IndexedDB, Three.js / React Three
Fiber / drei, Framer Motion, Lucide, CSS Modules with custom-property tokens, and locally
bundled Inter / Space Grotesk / JetBrains Mono via Fontsource.

## Structure

```
src/
  app/              shell, sidebar, top bar, command palette, mobile menu, status bar, routes
  brand/            logo mark and wordmark
  design-system/    tokens, base styles, button / badge / kbd / skeleton primitives
  features/         command center, project dossier, placeholder pages
  lib/              Dexie records, folder scanning, formatting, focus trap, WebGL support,
                    stage activity, sidebar preference, platform helpers
  three/            lazy-loaded R3F canvas and Lattice scene
```

## Local data and policy

- Projects live in the `codepilot-lab` IndexedDB database in this browser profile.
- `directoryHandle` is stored when the File System Access API returns one. It is
  structured-clone data; the folder may still need permission again when the editor ships.
- Excluded directories: `node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`,
  `.output`, `.svelte-kit`, `.turbo`, `.cache`, `coverage`, `__pycache__`, `.venv`, `venv`,
  and `target`.
- Import caps: 3,000 files and 12 directory levels. Truncation is disclosed in the import
  flow and on the project dossier.
- There is no delete/archive UI yet. Clearing site data for the origin removes the registry.

## Verification

- `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- Navigation across all seven areas, active states, mobile menu, palette search/open/close,
  sidebar collapse persistence, project creation, project opening, folder-import
  fallback, missing-record handling, and the empty state were exercised in a real browser.
- Layouts were checked at 390 px, 768 px, 912 px, and 1440 px. No horizontal overflow was
  measured at 390 px or 768 px.
- Reduced-motion fallback was checked with headless Chromium/Edge
  (`--force-prefers-reduced-motion`): the static SVG visual, `Motion reduced` status, and
  the `NO GPU RESOURCES USED` note render correctly.
- The live WebGL lattice was confirmed in the in-app browser; headless screenshots may
  render it blank depending on GPU/SwiftShader availability.

## Known constraints

- The registry is specific to this browser profile. It does not sync and is not exported
  yet.
- The folder picker is Chromium-only. Other browsers use the `webkitdirectory` fallback,
  which stores the manifest but not a directory handle.
- The 3D scene needs WebGL; the static fallback is used when WebGL is unavailable or
  reduced motion is requested.
- The main bundle is split: the shell is ~578 kB (183 kB gzip) and the lazy 3D scene is
  ~918 kB (244 kB gzip). No further optimization has been attempted in this phase.
- Editor, execution, and AI bridge work remain scheduled.

## Next

Code Workspace: local file tree, tabs, Monaco, and unsaved-change tracking. Not started.
