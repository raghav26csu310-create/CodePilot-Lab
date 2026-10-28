# CodePilot Lab

A local-first, AI-native coding laboratory. Built as an instrument, not a dashboard.

**Current milestone: Phase 1 — Identity.** This repository contains the shell, design
system, navigation, and interactive core visual. It is not yet an editor.

## What actually works

- Responsive application shell with sticky header, skip link, and a live status bar.
- Command palette (`Ctrl/⌘ K` or the **Jump to** button): substring search across
  module names, taglines, and phases; arrow-key navigation, `Enter` to open, `Esc` to
  close, focus trap and focus restore.
- Mobile navigation dialog with its own focus trap.
- Client-side routes for all planned modules. Every route is reachable from the header,
  the mobile menu, and the command palette.
- **Lattice-01**, the command-center centerpiece: React Three Fiber scene with an
  instanced faceted core, wireframe shell, orbital rings, dust, pointer parallax, and a
  click pulse. The FPS readout is measured at runtime, not simulated.
- Static SVG fallback for reduced-motion and no-WebGL environments, chosen from real
  capability detection.
- Canvas pauses while offscreen or when the document is hidden, and reduces DPR when
  frame time degrades.
- Honest placeholder pages for modules that are scheduled but not built.

## What is deliberately not built yet

Workspace (files, tabs, Monaco), Vault, Atlas, Execution Lab, Activity, and Settings
are placeholders. They state their phase and do not render invented data, terminal
output, metrics, or AI responses.

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

React 19 + TypeScript + Vite, React Router, Three.js / React Three Fiber / drei,
Framer Motion, Lucide, CSS Modules with custom-property tokens, and locally bundled
Inter / Space Grotesk / JetBrains Mono via Fontsource.

## Structure

```
src/
  app/              shell, header, command palette, mobile menu, status bar, routes
  brand/            logo mark and wordmark
  design-system/    tokens, base styles, button / badge / kbd / skeleton primitives
  features/         command center, placeholder pages
  lib/              focus trap, WebGL support, stage activity, platform helpers
  three/            lazy-loaded R3F canvas and Lattice scene
```

## Verification

- `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- Lighthouse (in-app Chromium, 912 × 766): Accessibility 100, Best Practices 100, SEO 100.
- Keyboard palette open/close, focus restore, and anchor navigation were exercised in a
  real browser. Reduced-motion and no-WebGL fallbacks were checked with headless
  Chromium flags.

## Known constraints

- The 3D scene needs WebGL; headless screenshot tooling may fall back to the static
  visual depending on GPU/SwiftShader availability.
- The main bundle is split: the shell is ~433 kB (139 kB gzip) and the lazy 3D scene is
  ~918 kB (244 kB gzip). No further optimization has been attempted in this phase.
- Phase 1 intentionally ships no data layer. Persistence, execution, and AI arrive in
  later phases.

## Next

Phase 2 — Workspace: local file tree, tabs, Monaco, and unsaved-change tracking.
