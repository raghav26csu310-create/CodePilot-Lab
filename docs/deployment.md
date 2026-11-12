# Deployment guide

> **Status note (2026-11-12):** the table below describes the static frontend beta. The
> current build also has an optional API (`server/api`, `npm run api:dev` / `api:start`)
> that owns provider credentials and accounts; it is not deployed anywhere yet and no
> production database exists. Treat this guide as still valid **only** for the static
> frontend until the API deployment section in
> [`technical-audit.md`](./technical-audit.md) §11 is completed.

## What is required vs optional

| Component | Required for the public beta? | Notes |
| --- | --- | --- |
| Static frontend host | **Yes** | Vercel, Netlify, Cloudflare Pages, GitHub Pages or any static server |
| Execution sidecar | **No** | Local-only. Users run it on their own machine. Do not host it publicly |
| AI provider | **No** | Ollama/LM Studio locally or any OpenAI-compatible endpoint chosen by the user |
| Feedback endpoint | **No** | Without it, feedback stays in the user's browser and the UI says so |
| Database service | **No** | IndexedDB only; there is no server database |
| Object/file storage | **No** | Export/import is not implemented |
| Analytics provider | **No** | Not configured in this release |

The default public beta is **frontend-only**. The hosted site cannot execute code, and the UI
states that the runner must be started locally. This is a deliberate honesty and safety
decision, not a missing deployment step.

## Build

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

`npm run build` emits `dist/`. Static marketing pages and assets from `public/` are copied
into `dist/` by Vite.

Set `SITE_URL` so canonical, Open Graph and sitemap URLs become absolute:

```bash
SITE_URL=https://your-domain.example npm run build
node scripts/set-site-url.mjs
```

The Vercel build command in `vercel.json` already runs the URL rewrite step. With no
`SITE_URL`, the token is replaced with an empty string, producing valid relative URLs.

## Vercel (recommended)

1. Push the repository to GitHub/GitLab.
2. Import the repository in Vercel. Framework preset: **Vite**. Build command:
   `npm run build && node scripts/set-site-url.mjs`. Output: `dist`.
3. Add environment variables:
   - `SITE_URL` — the production origin, e.g. `https://codepilot-lab.vercel.app`.
   - `VITE_FEEDBACK_ENDPOINT` — optional absolute HTTPS endpoint.
4. Deploy.
5. Verify:
   - `/home.html`, `/features.html`, `/docs.html`, `/privacy.html`, `/terms.html` return 200.
   - `/workspace`, `/lab`, `/practice`, `/convert`, `/settings` return the app shell on a
     hard refresh (SPA rewrites).
   - Private routes carry `X-Robots-Tag: noindex`.
   - `/robots.txt` and `/sitemap.xml` reference the production origin.
6. Add the custom domain in Vercel → Settings → Domains, then update `SITE_URL` and redeploy.

`vercel.json` sets security headers, private-route noindex headers and explicit rewrites for
app routes. Static `.html` pages are served directly and are not rewritten. The root `/`
serves the React app shell and is `noindex`; the crawlable public homepage is `/home.html`.
Both are linked explicitly (`Open the app` points at `/`).

## Any static host

```bash
npm run build
# serve dist/ with a static server
```

Configure:

- SPA fallback: unknown app paths → `/index.html`.
- Do **not** rewrite `/*.html`, `/site.css`, `/screenshots/*`, `/robots.txt` or
  `/sitemap.xml`.
- HTTPS.
- The same security headers as `vercel.json` if the host supports them.
- Cache HTML briefly; cache static assets longer.

A minimal local preview:

```bash
npm run preview
```

## Environment variables

| Variable | Scope | Required | Purpose |
| --- | --- | --- | --- |
| `SITE_URL` | build | Recommended | Absolute origin for canonical/OG/sitemap |
| `VITE_FEEDBACK_ENDPOINT` | build | No | Feedback POST destination |
| `VITE_ANALYTICS_ENDPOINT` | build | No | Reserved; not implemented |
| `EXEC_PORT` | sidecar | No | Default `5310` |
| `EXEC_HOST` | sidecar | No | Default `127.0.0.1` |
| `EXEC_ORIGINS` | sidecar | No | Comma-separated allowed browser origins |
| `EXEC_MAX_CONCURRENCY` | sidecar | No | 1–4, default 2 |
| `EXEC_ALLOW_REMOTE` | sidecar | No | Must be `1` for a non-loopback bind |
| `EXEC_TOKEN` | sidecar | With remote | Bearer token for remote binds |

Never commit `.env.local` or real keys. `VITE_*` variables are public in the client bundle.

## Local execution service

```bash
npm run exec
# http://127.0.0.1:5310
```

The runner is not part of the hosted deployment. Users start it locally when they want Run,
Trace, Submit or converter validation. The app shows the exact command when it is offline.

If the frontend is hosted on a different origin, add that origin to `EXEC_ORIGINS`:

```bash
EXEC_ORIGINS=https://your-domain.example,http://localhost:5173 npm run exec
```

This still binds to loopback, so a browser on the same machine can reach it, but a remote
visitor cannot. The runner answers Chrome's Private Network Access preflight with
`Access-Control-Allow-Private-Network: true` when the origin is allow-listed, but browser
policy varies. If a hosted HTTPS page cannot reach the loopback runner, run the frontend
locally (`npm run dev`) instead of fighting the browser; do not expose the runner publicly.

## AI provider

No provider is required to deploy. Users configure one in `/settings`. For a local Ollama:

```bash
OLLAMA_ORIGINS=http://localhost:5173,https://your-domain.example ollama serve
```

Remote providers must allow browser CORS. A server-side proxy can hold keys and avoid CORS;
document it as the user's own infrastructure.

## Feedback endpoint

The endpoint receives:

```json
{
  "id": "uuid",
  "category": "general|bug|feature",
  "rating": 1,
  "feature": "lab",
  "message": "…",
  "contact": "optional",
  "page": "/lab",
  "appVersion": "0.7.0",
  "createdAt": 1760000000000,
  "delivery": "endpoint",
  "endpointStatus": 202,
  "endpointError": null
}
```

Requirements: HTTPS, accept `POST application/json`, return 2xx on success. The browser sends
no cookies or credentials. Without an endpoint the app reports “stored in this browser”.

## Rollback

Vercel keeps immutable deployments:

1. Open the project → Deployments.
2. Select the last known-good deployment.
3. Promote/Redeploy it.
4. If an environment variable caused the issue, correct it and redeploy the same commit.

For other hosts, keep the previous `dist/` artifact and restore it. The app has no server
database migrations to reverse; IndexedDB schema upgrades are additive and versioned.

## Domain checklist

- [ ] HTTPS certificate active.
- [ ] `SITE_URL` matches the canonical origin.
- [ ] `robots.txt` and `sitemap.xml` use the production origin.
- [ ] Public pages are reachable without JavaScript.
- [ ] Private routes return noindex headers.
- [ ] Hard refresh on `/workspace` and `/practice/<id>` returns the app shell.
- [ ] Feedback endpoint, if configured, is reachable and returns 2xx.
- [ ] No key or secret appears in the built JavaScript.
