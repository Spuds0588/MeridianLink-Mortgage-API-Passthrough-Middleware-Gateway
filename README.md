# MeridianLink Mortgage API Passthrough & Middleware Gateway

An open-source, zero-vendor-footprint middleware gateway for MeridianLink Mortgage. It turns verbose
MISMO 3.4 XML into clean JSON REST endpoints, enforces persona-based schema masking so borrower NPI
never reaches a partner who should not see it, and absorbs write contention through a FIFO queue.

Deploy target: the lender's own AWS account (API Gateway + Lambda + DynamoDB + SQS FIFO + Secrets
Manager, egress through a NAT gateway with a static Elastic IP for MeridianLink's firewall allowlist).
**This repository currently ships the runtime MVP with local adapters** — see [Status](#status).

## Quickstart (local, no AWS, no MeridianLink access)

Requires Node.js 20+. There are no dependencies to install.

```bash
npm run dev      # mock MeridianLink on :8081 + gateway on :8080
npm test         # node:test suite (in-memory, leaves no state)
```

Open <http://localhost:8080/portal>, provision a partner, then:

```bash
# 1. Read a loan (masked for the persona you picked)
curl "http://localhost:8080/v1/loans/ML-998822" -H "x-api-key: mlg_..."

# 2. Write title fees — queued, returns 202 + jobId
curl -X PATCH "http://localhost:8080/v1/loans/ML-998822/fees" \
  -H "x-api-key: mlg_..." -H "Content-Type: application/json" \
  -d '{"fees":[{"feeType":"TitleLenderCoveragePremium","amount":1350,"paidTo":"First American Title"}]}'

# 3. Poll the job
curl "http://localhost:8080/v1/jobs/job-..." -H "x-api-key: mlg_..."

# 4. Field dictionary (proxied from MeridianLink, no local mapping table)
curl "http://localhost:8080/v1/fields?ids=11,646,CX.TITLE.STATUS" -H "x-api-key: mlg_..."
```

Mock loan ids: `ML-998822` (normal), `ML-LOCKED-1` (upstream `423`), `ML-404` (missing).

## API

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/v1/loans/{id}` | Synchronous read → MISMO XML parsed to JSON, persona-masked, `Cache-Control: private, max-age=15` |
| `PATCH` | `/v1/loans/{id}/fees` (also `/v1/loans/{id}`) | Async fee write → `202 ACCEPTED` + `jobId` + `statusUrl` |
| `GET` | `/v1/jobs/{jobId}` | `PENDING` \| `RETRYING` \| `COMPLETED` \| `FAILED`, attempt count, last error |
| `GET` | `/v1/fields?ids=11,646` | Field descriptions/types straight from the source of truth |
| `GET`/`POST` | `/portal` | SSR admin portal; `POST {tenantName, role}` issues a scoped key |
| `GET` | `/health` | Liveness |

All `/v1` routes require the `x-api-key` header (API Gateway injects `apiKeyId` when deployed).

### Personas and masking

Deny by default. Any JSON path not in the persona allowlist is pruned.

| Persona | Sees | Never sees |
| --- | --- | --- |
| `TITLE_VENDOR` | property address, loan terms, fees | borrower identity, SSN, credit score, conditions |
| `TPO_BROKER` | property, terms, borrower name/email, conditions, lock status | SSN, credit score, other-org data |
| `AMC_VENDOR` | property (incl. legal description), appraisal contact, loan type/amount | borrower identity, fees, conditions |

Unknown roles fail closed with `403`.

## Architecture (local MVP)

```
[partner] --x-api-key--> src/server.js (API-Gateway-shaped events)
                             └─ src/app.js routes
                                 ├─ GET  /v1/loans/{id}   → src/meridian.js → src/mismo.js parseLoan → src/mask.js → JSON
                                 ├─ PATCH .../fees        → src/queue.js (FIFO per loanId, concurrency 10, backoff) → src/meridian.js
                                 ├─ GET  /v1/jobs/{id}    → src/store.js (tenant ownership enforced)
                                 └─ GET  /v1/fields       → src/meridian.js passthrough
```

AWS primitives map to adapters with the same contract: DynamoDB → `src/store.js`, SQS FIFO + worker
Lambda → `src/queue.js`, Secrets Manager → env vars in `src/meridian.js`, API Gateway → `src/server.js`.
`mock/meridian.js` stands in for the vendor API.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Gateway listener |
| `MERIDIAN_BASE_URL` | `http://127.0.0.1:8081` | MeridianLink base URL |
| `MERIDIAN_USERNAME` / `MERIDIAN_PASSWORD` | `demo` / `demo` | Basic auth (Secrets Manager in AWS) |
| `STORE_FILE` | `data/store.json` | Tenant/job persistence; unset or empty for in-memory |
| `MOCK_PORT` | `8081` | Mock MeridianLink port (`npm run dev`) |

## Status

Implemented and tested locally: MISMO translation, persona masking, synchronous read, async FIFO write
with lock-contention retries, job status, field dictionary, SSR portal, HTTP runtime.

Not implemented / not verifiable here: CloudFormation `template.yaml`, VPC + NAT + static Elastic IP,
`deploy.sh`, and any live MeridianLink or AWS call. `todo.md` tracks those as deferred, and `history.md`
records why. The portal is intentionally unauthenticated in this MVP — put it behind your IdP or an
invite-link flow before exposing it; the API keys it issues are only as strong as the masking matrix.

## Docs

- `AGENTS.md` — operating manual (YAGNI, one-line preference, dev-env hygiene).
- `todo.md` — task tracker. `history.md` — append-only decision log.
- `chat-branch-of-encompass-api-middle-google-ai-studio-2026-11-06-1602.md` — original master dev doc.
