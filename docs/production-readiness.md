# Production readiness — Phase 7

> **Status note (2026-11-12):** this evaluation predates the API and multi-user work. Its
> verdict still holds for the frontend, and the new API is explicitly **not** production
> ready (memory store by default, ephemeral credential key in dev, no PostgreSQL run, no
> deployment). See [`technical-audit.md`](./technical-audit.md) §11 for what was and was not
> verified.

Status: **PARTIALLY READY** for a public frontend beta with the documented limits.

Evaluated on 2026-11-10 against a production build served locally with the exact
`vercel.json` security headers and SPA rewrites (`http://127.0.0.1:4180`). **No hosting
deployment was performed**, because no host credentials or production domain were available.
Nothing below claims that a deployed URL was tested.

## Verified in this phase

### Build and quality gates

- `npm run typecheck` — pass.
- `npm run lint` — pass with two pre-existing `react-refresh` warnings.
- `npm test` — 35 tests across path validation, feedback storage/delivery, proposal
  parsing, diffing and executor request validation.
- `npm run build` — pass. Monaco, Three.js and heavy routes stay in lazy chunks; the
  large-chunk warning remains for `editor.api`, `monacoSetup` and `CoreScene`.
- `SITE_URL=https://… npm run build && node scripts/set-site-url.mjs` — pass; canonicals,
  Open Graph images, `sitemap.xml` and `robots.txt` become absolute and no
  `__SITE_URL__` tokens remain.
- Production dependency audit (`npm audit --omit=dev`) — **0 vulnerabilities** after
  pinning `dompurify` to `3.4.17` with a `package.json` override. The full dev tree still
  reports 10 moderate ESLint/TypeScript-ESLint toolchain advisories; those packages do not
  ship in `dist/`.
- Secret scan of `dist/` — no API keys, bearer tokens, private-key blocks or obvious
  secret-like strings.

### Routing, headers and UI

- Built preview with the real CSP, `X-Robots-Tag` and rewrite rules: `/`, `/workspace`,
  `/workspace/:id`, `/lab`, `/practice/first-light`, `/settings` and `/feedback` all
  returned the app shell on a hard refresh.
- Static `.html` pages were served directly and were not captured by the SPA rewrites.
- Private routes returned `X-Robots-Tag: noindex, nofollow`; the SPA shell also carries
  `meta robots noindex`. Public static pages are crawlable.
- CSP (`script-src 'self'`, `worker-src 'self' blob:`) produced **zero CSP violations**
  across the app, Monaco, the Three.js scene and all 12 static pages.
- New Project language dropdown, opened in the built preview: 9 options, readable
  `rgb(163,176,196)` on the dark surface, selected TypeScript at `rgb(233,239,248)`;
  keyboard ArrowDown/Enter and Escape verified. Feedback “Feature used” dropdown verified
  with 10 options.
- 12 static pages audited: titles, descriptions, canonicals, OG/Twitter metadata, 202
  internal `.html` links and every screenshot reference resolve. All images decoded at
  1440×1000.
- Mobile 390×844: Command Center, workspace picker, feedback and all 12 static pages had
  no horizontal document overflow. Desktop 1440×1000 verified.

### Real runtime, trace and feedback

- Built preview at `127.0.0.1:4180` with `EXEC_ORIGINS` including that origin:
  Python run returned real stdout (`Hello from CodePilot Lab`), a measured duration and
  `Completed`; “Trace execution” produced 9 real `sys.settrace` events, a 1-frame call
  stack and the event timeline.
- CORS preflight returned the expected `Access-Control-Allow-Origin` and
  `Access-Control-Allow-Private-Network: true`; direct `/run` returned real Python output.
- Feedback submitted through the built preview: stored in IndexedDB, success panel said
  “Stored in this browser.”, the endpoint-absent explanation was shown, and the recent
  list rendered the new entry. No stale validation message.
- First-run welcome card present; no sample projects or fabricated activity are seeded.
- Path validation rejects `../`, absolute paths, drive letters, control characters, empty
  segments and reserved names in storage writers.
- Server hardening: loopback bind, remote-bind guard, bearer token for remote binds,
  origin allow-list, Private Network Access answer, concurrency cap/429, sanitized 500s,
  stdin/stdout limits, trace limits and process cleanup.
- Playwright-style browser checks were run through headless Edge CDP. Real screenshots
  were captured from the live app and are used by the public pages.

## Checklist before announcing

- [x] Production build and URL rewrite.
- [x] Hard-refresh direct app routes on the built preview.
- [x] Open dropdowns in the built preview and confirm contrast.
- [x] Run code and a Python trace with the local sidecar.
- [x] Submit feedback and confirm local persistence.
- [x] Check mobile and desktop widths.
- [x] Reproduce the host headers locally and confirm CSP does not break Monaco.
- [x] Confirm no secrets in `dist/`.
- [x] Re-run the production dependency audit.
- [ ] Deploy to the chosen host and test the real URL.
- [ ] Confirm the host applies the same headers and rewrites.
- [ ] Run execution/trace from the real deployed HTTPS origin (browser Private Network
      Access policy may block loopback calls; document the fallback).
- [ ] Configure `VITE_FEEDBACK_ENDPOINT` and confirm 2xx delivery end to end.
- [ ] Re-run a real AI provider success and a failure/CORS case on the release commit.
- [ ] Add the custom domain and redeploy with the final `SITE_URL`.
- [ ] Re-check the deployed pages in a second browser.

## Not ready / explicitly out of scope

- **Hardened code execution sandbox.** The runner is a local developer tool. Public hosted
  execution is not offered.
- **Project Atlas, Project Vault, Activity & Diagnostics.** Labelled placeholders.
- **Cloud sync, accounts, team spaces.** Not implemented.
- **Project export/import and disk write-through.** Scheduled.
- **Analytics.** No provider configured; no metrics are claimed.
- **Cross-browser equality.** File System Access is Chromium-only. Monaco and execution
  were verified primarily in Chromium/Edge.
- **Full dev-toolchain audit.** The 10 moderate advisories are in ESLint/TypeScript-ESLint
  and do not ship; fixing them requires major version changes and is deferred.

## Launch gate

A public “beta” announcement is acceptable if:

1. The frontend is deployed with the static site and private-route headers.
2. The execution limitation is stated on the lab page and in the docs.
3. Feedback delivery is either configured or honestly labelled local-only.
4. The remaining deployment checks are complete and recorded.
5. `SITE_URL` is set to the real origin and `robots.txt`/`sitemap.xml` are checked live.

A “production-ready for untrusted public code execution” claim is **not** acceptable.
