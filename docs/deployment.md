# Deployment guide

CodePilot Lab has a one-process production entrypoint: `npm start` serves `dist/` and
`/api/*` through the same Node server, applies PostgreSQL migrations at startup and
handles graceful SIGINT/SIGTERM shutdown.

## Production requirements

| Requirement | Value |
| --- | --- |
| Node.js | 24 recommended |
| Database | PostgreSQL |
| Credential encryption key | Base64 encoding of exactly 32 bytes |
| Public origin | HTTPS |
| AI provider | Optional; managed mode needs complete server configuration |
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

## Managed AI variables

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

Never put provider secrets in `VITE_*` variables. Never commit `.env`.

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

## Platform deployment

Set the platform build command to `npm ci && npm run build`, start command to `npm start`,
and health check to `/api/health/ready`. Supply PostgreSQL over a private network and
set the public HTTPS origin exactly in `CORS_ORIGINS`.

The platform must support a persistent Node process for this API. Serverless-only hosting
is not equivalent: migrations, sessions and provider quotas require adaptation.

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
