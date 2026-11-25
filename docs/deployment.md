# Deployment guide

CodePilot Lab supports Vercel serverless deployment as well as a one-process Node
deployment. Vercel serves the Vite build from `dist/` and maps `/api/*` to the shared
API router in `api/[...path].ts`; local development uses `npm run dev`, which starts
Vite, the API and the optional execution companion together.

## Production requirements

| Requirement | Value |
| --- | --- |
| Node.js | 24 recommended |
| Database | PostgreSQL (required for production and Vercel) |
| Credential encryption key | Base64 encoding of exactly 32 bytes |
| Public origin | HTTPS |
| AI provider | Optional; managed Groq uses `GROQ_API_KEY` |
| Execution / terminal | Separate loopback companion; not a public sandbox |

Production startup refuses in-memory storage, incomplete credential encryption, missing
database configuration, missing origins or insecure cookies.

## Required environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV=production` | Yes | Enables production validation |
| `DATABASE_URL` | Yes | PostgreSQL connection URL |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | Base64 AES-256-GCM key |
| `CORS_ORIGINS` | Yes | Exact HTTPS origins, comma separated |
| `SESSION_COOKIE_SECURE=true` | Yes | Require secure session cookies |
| `PORT` or `API_PORT` | Yes | Platform listen port; `PORT` is supported |
| `API_HOST=0.0.0.0` | Usually | Bind address |

Generate a credential key:

```bash
openssl rand -base64 32
```

## Groq AI

Set `GROQ_API_KEY` on the server/API deployment to enable managed Groq. It is never a
`VITE_*` variable, is not stored in IndexedDB, and is not returned by health or AI routes.
The key takes precedence over the legacy generic managed-provider configuration. The
default `GROQ_MODEL` is `openai/gpt-oss-120b`, listed as a Groq production model in the
[official supported-model catalog](https://console.groq.com/docs/models) checked
2026-11-25. Set `GROQ_MODEL` to another currently available model ID to change it.

The browser sends chat to the authenticated same-origin `/api/ai/chat` SSE endpoint; the
API applies its request-size, message-count, rate and provider time limits and talks to
Groq server-to-server. AI is unavailable until a Groq key or an account-owned provider
connection exists. No AI response is synthesized when configuration or the provider is
unavailable.

## Legacy managed-provider variables

All three of `MANAGED_AI_BASE_URL`, `MANAGED_AI_API_KEY` and `MANAGED_AI_MODEL` must be
set together. `MANAGED_AI_PROVIDER` selects `openai`, `anthropic`, `gemini`, `ollama`,
`deepseek` or `openai-compatible`.

| Variable | Purpose |
| --- | --- |
| `MANAGED_AI_PROVIDER` | Provider adapter |
| `MANAGED_AI_LABEL` | Display label |
| `MANAGED_AI_BASE_URL` | Provider or compatible endpoint |
| `MANAGED_AI_API_KEY` | Server-held key |
| `MANAGED_AI_MODEL` | Default model |
| `MANAGED_AI_DAILY_REQUESTS` | Daily managed request cap |
| `MANAGED_AI_MONTHLY_TOKENS` | Estimated monthly token cap |
| `MANAGED_AI_FALLBACK_MODELS` | Optional comma-separated fallback models |

These settings remain as a compatibility option when `GROQ_API_KEY` is absent. Never
put provider secrets in `VITE_*` variables. Never commit `.env`.

## Build and start

```bash
npm ci
npm run build
npm start
```

The normal startup process:

1. Loads environment variables.
2. Validates production configuration.
3. Opens PostgreSQL.
4. Runs advisory-lock migrations.
5. Serves the built SPA and API on one port.
6. Exposes liveness and readiness health checks.

Health endpoints:

- `GET /api/health/live` — process liveness.
- `GET /api/health/ready` — database-backed readiness.
- `GET /api/health` — backward-compatible detailed capability report.

## Docker

```bash
docker build -t codepilot-lab .
docker run --rm -p 8787:8787 \
  -e NODE_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=8787 \
  -e DATABASE_URL='postgresql://user:password@host:5432/codepilot' \
  -e CREDENTIAL_ENCRYPTION_KEY='<base64-32-byte-key>' \
  -e CORS_ORIGINS='https://codepilot.example.com' \
  -e SESSION_COOKIE_SECURE=true \
  codepilot-lab
```

Docker Compose includes a local PostgreSQL service and a development-mode application:

```bash
CREDENTIAL_ENCRYPTION_KEY='<base64-32-byte-key>' docker compose up --build -d
curl http://127.0.0.1:8787/api/health/ready
```

Compose uses development defaults, an ephemeral key when the key is absent, and
`codepilot-postgres` data. It is suitable for local containers, not as a substitute for
production infrastructure.

## Vercel deployment

Use the repository root as the Vercel project root. `vercel.json` configures the Vite
framework, `npm run build && node scripts/set-site-url.mjs`, the `dist` output, the
serverless API catch-all and SPA rewrites. Vercel discovers `api/[...path].ts` as the
Node.js function; the frontend uses relative `/api/*` paths unless the optional
`VITE_API_BASE_URL` override is explicitly set for a separate-origin API.

Create a PostgreSQL database and set these Vercel Project → Settings → Environment
Variables for every deployed environment that should run the API:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL from the database provider |
| `CREDENTIAL_ENCRYPTION_KEY` | Persistent base64 32-byte key; generate with `openssl rand -base64 32` |
| `GROQ_API_KEY` | Groq API key (optional; keep it server-only) |
| `GROQ_MODEL` | Optional model ID; defaults to `openai/gpt-oss-120b` |

The function derives its HTTPS origin from Vercel deployment metadata. Set `PUBLIC_ORIGIN`
to the canonical production URL when using a custom domain. The function uses a 50-second
provider deadline within its 60-second configured maximum duration. `/api/health/live`
reports process liveness even when other deployment configuration is incomplete;
`/api/health/ready` and `/api/health` report actual database/API readiness.

Redeploy after changing environment variables. Vercel-managed functions do not run the
local execution/terminal companion; those controls remain unavailable on the hosted site.
The database, provider account/limits, HTTPS domain and Vercel project are external
infrastructure and must be provisioned by the operator.

## Persistent Node deployment

For a persistent Node host, use `npm ci && npm run build`, start command `npm start`,
and health check `/api/health/ready`. Supply PostgreSQL over a private network and set
the public HTTPS origin exactly in `CORS_ORIGINS`.

PostgreSQL-backed sessions and quotas survive process restarts. Rate limiting is still
in-memory per function/process; use a shared rate-limit store before relying on it for
multi-instance abuse control.

## Execution and terminal sidecars

The local execution and terminal companion is not started by the production Node process.
It is intentionally host-local and resource-limited, not a hardened public sandbox.
The UI reports it unavailable on hosted deployments. A future public terminal must use
an authenticated, isolated container/VM service with path, CPU, memory, network and TTL
limits.

## Rollback

1. Re-deploy the previous immutable build.
2. Restore PostgreSQL only by a database backup; application migrations are forward-only.
3. Revoke changed provider credentials and rotate the encryption key if it was exposed.
4. Check `/api/health/ready` and the application logs before restoring traffic.
