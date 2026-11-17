# CodePilot multi-provider AI gateway

The authenticated CodePilot API routes AI requests to server-held credentials. BYO keys
are encrypted with AES-256-GCM and never returned to the browser. The UI supports OpenAI,
Anthropic, Google Gemini, Ollama, DeepSeek and custom OpenAI-compatible endpoints through
separate API adapters.

## Local setup

```bash
# API on 127.0.0.1:8787 (development uses an in-memory store)
npm run api:dev

# Frontend on localhost:5173, with /api proxied to the API
npm run dev
```

Open `/settings`, create an API account or sign in, and use **Provider vault** to add a
provider. The workspace Copilot, Quick AI help and code converter all use the same gateway.
No `VITE_API_BASE_URL` is needed in development because Vite proxies `/api`.

The API health response reports the active storage engine and whether the credential
encryption key is ephemeral. In-memory accounts and provider connections disappear when
the development API process exits. Production requires durable storage and a configured
`CREDENTIAL_ENCRYPTION_KEY`.

## Provider adapters

| Provider | Default base URL | Protocol and credential |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `/models`, SSE `/chat/completions`, Bearer key |
| Anthropic | `https://api.anthropic.com` | `/v1/models`, SSE `/v1/messages`, `x-api-key` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `/models`, SSE `streamGenerateContent`, `x-goog-api-key` header |
| Ollama | `http://127.0.0.1:11434` | `/api/tags`, NDJSON `/api/chat`, no key |
| DeepSeek | `https://api.deepseek.com/v1` | OpenAI-compatible `/models` and `/chat/completions` |
| Custom compatible | User supplied | OpenAI-compatible models and chat endpoints; optional Bearer key |

Ollama must be running at the configured URL; an installed model does not imply a running
server. Calls to private/loopback endpoints require `ALLOW_PRIVATE_AI_ENDPOINTS=true` on the
API. User-supplied endpoints are URL-validated and protected by a private-address/SSRF
guard when private access is disabled.

Each user can save multiple configurations, test a connection and model list, select a
default and optionally a fallback. Keys are entered transiently in Settings; editing a
connection without entering a new key keeps the existing encrypted key. The API only
returns public connection metadata (`hasKey`, `keyLast4`, test result and timestamps).

## Managed provider

Managed AI is optional and configured only in the API environment (see `.env.example`):

```dotenv
MANAGED_AI_PROVIDER=openai-compatible
MANAGED_AI_LABEL=CodePilot AI
MANAGED_AI_BASE_URL=https://provider.example/v1
MANAGED_AI_API_KEY=
MANAGED_AI_MODEL=
MANAGED_AI_DAILY_REQUESTS=100
MANAGED_AI_MONTHLY_TOKENS=500000
MANAGED_AI_FALLBACK_MODELS=
```

Supported `MANAGED_AI_PROVIDER` values are `openai`, `anthropic`, `gemini`, `ollama`,
`deepseek` and `openai-compatible`. Managed platform keys are never sent to or exposed by
the browser. Quota enforcement and usage recording are performed by the API.

## Streaming, fallback and usage

`POST /api/ai/chat` is session-scoped and streams SSE `meta`, `delta`, `done` and `error`
events. Metadata identifies the provider and model actually used. Completion usage includes
provider-reported prompt/completion tokens when available; otherwise the UI labels the
character-based token count as an estimate.

The configured fallback is attempted only when the primary fails before emitting any text.
It is not retried after partial output or cancellation. Failures are returned with their
real provider/API error classification; a failed provider does not fabricate an answer or
take down the rest of the app.

## API routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Real API, storage and credential-key health |
| GET | `/api/auth/session` | Signed-in user or `null` |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Account session |
| GET | `/api/ai/status`, `/api/ai/connections`, `/api/ai/usage` | Availability and public metadata |
| POST / PUT / DELETE | `/api/ai/connections` | Create, update and remove per-user connections |
| POST | `/api/ai/connections/:id/test` | Test saved provider and list models |
| PUT | `/api/ai/preferences` | Set default and fallback provider IDs |
| POST | `/api/ai/chat` | Authenticated SSE completion |

All provider configuration, test and chat routes require an authenticated session. There
is no separate provider API or frontend-held credential route.

## Verification and limits

Automated tests mock each protocol and cover model discovery, streaming and usage parsing,
missing credentials, invalid credentials, unknown models/404, downtime, network errors,
timeouts and fallback behavior. API tests cover per-user isolation, encrypted credential
handling, public metadata, account export and SSE behavior.

This environment has no provider credentials configured, so live OpenAI, Anthropic,
Gemini, DeepSeek, custom endpoint or Ollama completions have not been verified. PostgreSQL,
production persistence, deployment, TLS, secure cookies and multi-instance quotas also
remain unverified; development health accurately reports the in-memory store.
