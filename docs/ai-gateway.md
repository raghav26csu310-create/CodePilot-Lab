# CodePilot AI gateway

The browser no longer needs a provider key. It talks to the CodePilot API, which owns the
provider credential and enforces per-user quotas. A direct browser provider remains
available as an explicitly labelled advanced/local fallback.

Everything below was executed locally unless marked otherwise.

## Local setup

```bash
# 1. API (127.0.0.1:8787, in-memory store by default)
npm run api:dev

# 2. Frontend (127.0.0.1:5173, proxies /api to the API)
npm run dev
```

Open `/settings`, create an account, then use the workspace Copilot or the converter.
No `VITE_API_BASE_URL` is required in development because Vite proxies `/api`.

Without a managed provider configured, the gateway honestly reports:

```
managed.available = false
reason = "Managed CodePilot AI is not configured on this server. Connect a personal
          provider to use AI features."
```

Signing in does not create AI access by itself. Either configure a managed provider on the
server or connect a personal provider (BYO) from the same page.

## Managed mode

Set these in the API environment (see `.env.example`). They are read only by the API
process and never returned to the browser:

```
MANAGED_AI_PROVIDER=openai-compatible   # or ollama
MANAGED_AI_LABEL=CodePilot AI
MANAGED_AI_BASE_URL=https://provider.example/v1
MANAGED_AI_API_KEY=...                  # server-side only
MANAGED_AI_MODEL=...
MANAGED_AI_DAILY_REQUESTS=100
MANAGED_AI_MONTHLY_TOKENS=500000
MANAGED_AI_FALLBACK_MODELS=
```

The API enforces the daily request limit and the monthly estimated-token budget before
calling the provider. Token counts are estimates from character counts unless the provider
returns real usage; the UI states this.

## BYO mode

There are two BYO routes, chosen by the `route` setting on the same page:

1. **Saved on the API (recommended).** Tick “Send through the CodePilot API”.
   `PUT /api/ai/connection` stores the key encrypted with AES-256-GCM and the browser
   keeps no key. Responses include `hasKey` and `keyLast4` only. Set
   `CREDENTIAL_ENCRYPTION_KEY` (base64, 32 bytes) in production; without it the API uses an
   ephemeral key and says so, and saved keys stop decrypting after a restart.
2. **Direct from the browser (advanced).** The original adapter path, used when the toggle
   is off. The key stays in tab memory unless the user opts into “remember”, which writes
   plaintext JSON to IndexedDB. The UI now says so explicitly.

The toggle requires a signed-in session. While the session probe is still running it is
disabled, and a signed-out save persists `route: "direct"` instead of attempting an API
call that could only fail. Managed mode never persists a key.

Verified locally with a saved-but-unreachable BYO endpoint (`http://127.0.0.1:9`):

- `PUT /api/ai/connection` succeeded and `/api/ai/status` reported the connection with
  `hasKey: false`.
- IndexedDB held `{"route":"gateway","apiKey":"","rememberKey":false}`.
- `POST /api/ai/connection/test` returned the server's real
  “The provider endpoint could not be reached (TypeError).”; no browser request went to the
  provider host.
- A conversion through the gateway failed with the same message and stored a `FAILED`
  history row with the real provider, model and duration.

## Endpoints used by the frontend

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Reachability, version, store kind, managed-AI availability |
| GET | `/api/auth/session` | Signed-in user or `null` |
| POST | `/api/auth/register` / `login` / `logout` | Account surface |
| GET | `/api/ai/status` | Managed availability, saved connection, usage, quota |
| POST | `/api/ai/chat` | SSE stream: `meta`, `delta`, `done`, `error` |
| POST | `/api/ai/connection/test` | Real provider model listing |
| PUT/DELETE | `/api/ai/connection` | Encrypted BYO credential |
| POST | `/api/ai/mode` | Preferred `managed` / `byo` mode |

`/api/ai/chat` requires a session. Requests without one return 401 before any provider
call.

## Failure behaviour

- A provider failure arrives as an SSE `error` event with the server's code and message.
  The browser throws a `GatewayError`, and the conversion path keeps the partial text.
- Quota exhaustion returns `rate_limited` with the remaining-limit reason.
- A missing provider returns `service_unavailable`; the UI never pretends a request ran.
- On an incomplete stream the client throws rather than accepting a truncated answer as
  complete.

## What is not proven here

- A live completion against a real provider: no credential is configured in this
  environment. Routing, credential storage, quota checks and error propagation were
  exercised; no model ever answered.
- PostgreSQL persistence: PostgreSQL is not installed here. `npm run api:dev` uses the
  in-memory store and `/api/health` reports `engine: "memory"`, `durable: false`.
- Multi-instance rate limiting: the limiter is in-memory and the health payload says so.
- Production hosting, TLS, secure cookies and CSP: untested without a deployed domain.
