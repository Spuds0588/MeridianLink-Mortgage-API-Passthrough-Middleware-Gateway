# MeridianLink Mortgage API Passthrough & Middleware Gateway

An open-source middleware gateway for MeridianLink Mortgage. It turns verbose MISMO 3.4 XML into
clean JSON REST endpoints, enforces persona-based schema masking so borrower NPI never reaches a
partner who should not see it, and absorbs write contention through an SQS FIFO queue with retries.
The whole stack deploys into the lender's AWS account from a single file.

Sister project: [Encompass API Passthrough Middleware Gateway](https://github.com/Spuds0588/Encompass-API-Passhrough-Middleware-Gateway-).
This repository follows the same runtime and deployment patterns where they fit MeridianLink.

## Community-supported — contribute aggressively

This is an independent, community-supported template, not a vendor product, and it is not affiliated with
MeridianLink. The maintainer has **no MeridianLink access and no AWS account for this project**, so every
deployment is also a test. Issues and pull requests are therefore the roadmap, not a support channel:

- **Found a bug?** [Open the bug report form](https://github.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/issues/new?template=bug_report.yml)
  with a minimal reproduction, the commit you tested, and sanitized logs. Feature ideas use the
  [improvement form](https://github.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/issues/new?template=feature_improvement.yml).
- **Opening a pull request?** The [PR template](.github/pull_request_template.md) requires what you actually
  verified, what you could not validate, and a regression test for bug fixes.
- **Fixed something?** [Open a pull request](https://github.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/pulls)
  with a regression test and the docs updated.
- **Validated a MISMO shape or a real deployment?** Report the sanitized result on the relevant issue. That
  evidence is more valuable than a speculative patch.
- **Want to help long term?** The maintainer is happy to add contributors: say so on your issue or PR.

Start with [CONTRIBUTING.md](CONTRIBUTING.md), the agent operating manual in [AGENTS.md](AGENTS.md), and
[llms.txt](llms.txt) for machine-readable context. The public overview lives at
[index.html](index.html) (GitHub Pages). Privately-patched forks are discouraged: upstream the smallest
fix so the next deployment benefits. Never include API keys, invite codes, passwords, loan data, or
borrower PII in an issue, PR, screenshot, or log.

## Deploy (AWS CloudShell, ~3 minutes)

```shell
bash <(curl -sSL https://raw.githubusercontent.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/main/deploy.sh)
```

The script verifies your AWS session, asks for the MeridianLink base URL, username, and password,
generates three role invite codes, fetches the committed template, and deploys
`MeridianLink-Mortgage-Gateway` with `CAPABILITY_IAM`. It prints:

- `GatewayUrl` — base URL for vendor calls
- `AdminPortalUrl` — the invite portal
- `HealthUrl`, `FieldsUrl`
- `StaticEgressIp` — whitelist this with MeridianLink support
- three ready-to-share role links, e.g. `...?role=title&code=...`

Environment overrides: `STACK_NAME`, `AWS_REGION`, `MERIDIAN_BASE_URL`, `MERIDIAN_USERNAME`,
`MERIDIAN_PASSWORD`, `TITLE_INVITE_CODE`, `BROKER_INVITE_CODE`, `APPRAISAL_INVITE_CODE`, `TEMPLATE_URL`.

Prefer the console? Upload `template.yaml` directly in CloudFormation and fill in the same parameters.
It stays under the 51,200-byte direct-upload limit.

### Smoke test after deploy

```shell
curl -s "$HEALTH_URL"
curl -s "$PORTAL_URL?role=title&code=$TITLE_INVITE_CODE"
curl -s -X POST "$PORTAL_URL" -H "content-type: application/json" \
  -d "{\"role\":\"title\",\"code\":\"$TITLE_INVITE_CODE\",\"tenantName\":\"Acme Title\",\"email\":\"dev@acme.test\"}"
# use the returned apiKey:
curl -s "$GATEWAY_URL/v1/loans/ML-998822" -H "x-api-key: $KEY"
curl -s "$GATEWAY_URL/v1/fields?ids=11,646,CX.TITLE.STATUS" -H "x-api-key: $KEY"
curl -s -X PATCH "$GATEWAY_URL/v1/loans/ML-998822/fees" -H "x-api-key: $KEY" \
  -H "content-type: application/json" -d '{"fees":[{"feeType":"TitleLenderCoveragePremium","amount":1350}]}'
curl -s "$GATEWAY_URL/v1/jobs/$JOB_ID" -H "x-api-key: $KEY"
```

## Features

- **MISMO 3.4 XML → JSON** — reads return `loanId`, `milestone`, `property`, `terms`, `fees`, and
  persona-permitted extras. No vendor-side XML parsing.
- **Persona schema masking** — deny-by-default allowlists per role; NPI is pruned before the response
  leaves the gateway. Unknown personas fail closed.
- **Async writes** — `PATCH /v1/loans/{id}/fees` validates and enqueues to SQS FIFO (grouped by loan),
  returns `202` + job ID, retries MeridianLink record locks with backoff, and dead-letters after 5 attempts.
- **Role-scoped self-serve onboarding** — the lender shares a title, broker, or appraisal invite link;
  the vendor enters a company name and developer email; the gateway locks the key to that role's persona
  server-side. No admin token and no per-vendor admin work.
- **Field discovery** — `GET /v1/fields?ids=…` proxies definitions from MeridianLink and caches them per
  persona for 5 minutes. The portal publishes a common-path cheat sheet.
- **One-file deployment** — one CloudFormation template under the direct-upload limit with the Lambda
  bundle inlined; no S3 bucket, no zip, no build step in AWS.
- **Static egress IP** — the template provisions a VPC, NAT gateway, and Elastic IP so MeridianLink can
  allowlist a single address.

## API

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `GET` | `/health` | none | `{ "status": "ok", "system": "MeridianLinkGateway" }` |
| `GET` | `/portal` | none | invite landing page + field cheat sheet |
| `GET` | `/portal?role=title&code=…` | invite code | persona-locked form |
| `POST` | `/portal` body `{ role, code, tenantName, email }` | invite code | `{ apiKey, tenantName, email, role, persona }` |
| `GET` | `/v1/fields?ids=11,646,CX.TITLE.STATUS` | `x-api-key` | `{ "11": { description, type }, … }` |
| `GET` | `/v1/loans/{id}` | `x-api-key` | masked loan JSON |
| `PATCH` | `/v1/loans/{id}/fees` body `{ "fees": [{ "feeType": "…", "amount": 1350 }] }` | `x-api-key` | `202 { status, jobId, loanId, statusUrl }` |
| `PATCH` | `/v1/loans/{id}` | `x-api-key` | `501` — only fee writes are implemented |
| `GET` | `/v1/jobs/{id}` | `x-api-key` | `{ jobId, loanId, status, attempts, createdAt, updatedAt, error }` |

Job statuses: `PENDING` → `RETRYING` → `COMPLETED` / `FAILED`. Fee arrays are capped at 100 items.

### Roles and personas

| Role | Persona (allowlist) | Invite parameter |
| --- | --- | --- |
| `title` | `TITLE_VENDOR` | `TitleInviteCode` |
| `broker` | `TPO_BROKER` | `BrokerInviteCode` |
| `appraisal` | `AMC_VENDOR` | `AppraisalInviteCode` |

| Persona | Sees | Never sees |
| --- | --- | --- |
| `TITLE_VENDOR` | property address, loan terms, fees | borrower identity, SSN, credit score, conditions |
| `TPO_BROKER` | property, terms, borrower name/email, conditions, lock status | SSN, credit score, fees (write-only today) |
| `AMC_VENDOR` | property (incl. legal description), appraisal contact, loan type/amount | borrower identity, fees, conditions |

### Broker workflow coverage (verified against the local handler)

Broker keys (`TPO_BROKER`) carry the widest read allowlist, but the API does not yet cover a full 1003,
borrower documents, or condition responses. This is the current contract, asserted by `test/gateway.test.js`:

| Broker need | Current API | Status |
| --- | --- | --- |
| Identity, property, terms, lock status | `GET /v1/loans/{id}` | Supported |
| Conditions, read-only | `conditions[]` on the loan read | Supported |
| Fee updates | `PATCH /v1/loans/{id}/fees` | Supported |
| Full 1003 read | loan read | **Partial** — no employment, income, assets, liabilities, or declarations |
| Full 1003 write | `PATCH /v1/loans/{id}` | **Not implemented** — returns `501` |
| Borrower document upload | none | **Not implemented** |
| Respond to or update conditions | none | **Not implemented** |

SSN and credit score remain excluded for every persona by design. The missing write paths are blocked on
sanitized MeridianLink MISMO samples: the gateway does not invent vendor tag names, document transport, or
condition-merge semantics. A broker key still cannot pass a full 1003 through this API, so integrations that
need that must wait for a contributed shape rather than assume it works.

## Architecture

```
Vendor ──invite link──► GET  /portal?role=title&code=… → persona-locked form
Vendor ──x-api-key────► API Gateway (usage plan)
                         ├── POST /portal            → invite → API key + tenant mapping
                         ├── GET  /health            → open liveness
                         ├── GET  /v1/fields         → schema proxy (5-min per-persona cache)
                         ├── GET  /v1/loans/{id}     → Masked MISMO→JSON read
                         ├── PATCH /v1/loans/{id}/fees → SQS FIFO enqueue → 202 + job
                         └── GET  /v1/jobs/{id}      → job status (owner only)
                                                        │
                              SQS FIFO (group = loan) ──┘─► Lambda worker ──► MeridianLink
                                                              (5 attempts, then DLQ)
                              NAT gateway + Elastic IP = static egress for the vendor firewall
```

Storage: DynamoDB tenants + jobs (TTL) · Secrets Manager (API password) · API Gateway key store.
No loan documents are persisted; only the in-flight fee payload travels in the SQS message.

## Local development

Requires Node.js 20+. There are no dependencies to install.

```shell
npm run dev
# Gateway:   http://127.0.0.1:3000
# Portal:    http://127.0.0.1:3000/portal?role=title&code=local-title-invite-0123456789
# Broker:    …?role=broker&code=local-broker-invite-0123456789
# Appraisal: …?role=appraisal&code=local-appraisal-invite-0123456789
npm test          # node:test suite (in-memory, no state)
npm run build     # regenerate dist/gateway.js + template.yaml
npm run verify    # build --check + tests
```

The local stack runs the real handler against `mock/meridian.js` and an in-memory AWS stand-in. Mock
loans: `ML-998822` (normal), `ML-LOCKED-1` (always `423`), `ML-404` (missing).

## Repository layout

```
src/lambda.js         deployed Lambda (HTTP + SQS)
src/app.js            routes, invites, reads, writes, job status, schema cache
src/mismo.js          MISMO 3.4 XML ↔ vendor JSON
src/mask.js           persona allowlists
src/roles.js          role → persona + invite env var
src/portal.js         invite portal + cheat sheet
src/writes.js         write delivery and retry classification
src/aws-store.js      DynamoDB / SQS / Secrets Manager / API Gateway adapters
src/server.js         local HTTP adapter
dev/                  fake upstream, memory store, drain runner
infra/template.yaml   CloudFormation source (//__GATEWAY_CODE__ placeholder)
template.yaml         generated deployable template (committed)
scripts/build.js      bundle + inline + size guard + --check
deploy.sh             one-line CloudShell installer
test/                 node:test unit, e2e, bundle and template guards
```

## Status and limitations

Implemented and tested locally: MISMO translation, persona masking, invite onboarding, schema proxy
and cache, synchronous reads, async FIFO writes with lock retries, job ownership, HTTP runtime, the
single-file template, and the exact inline bundle the template deploys (executed in tests).

**Not deployed to AWS from this environment** (no AWS account or MeridianLink access). The template is
structurally tested and the embedded handler is executed locally, but real resource behavior,
MeridianLink payload shapes, and the egress IP allowlist remain unverified. See `history.md`.

Other known limits: invite codes are global per role (rotate via stack parameters; no single-use or
revocation UI), one shared usage plan/quota for all tenants, no CORS (server-to-server expected), and
no admin dashboard. Read responses are not cached server-side by design.

Broker coverage is intentionally narrow today: reads include identity, property, terms, conditions, and
lock status, and only fees are writable. A full 1003 submission, borrower document upload, and condition
responses need real MISMO shapes and vendor endpoint confirmation; until then `PATCH /v1/loans/{id}`
returns `501` rather than pretending to accept a loan update.

**No per-loan organization scoping.** A tenant mapping fixes the persona, not which loans a key may touch:
`GET /v1/loans/{id}` and the fee write accept any loan ID the gateway's shared MeridianLink credentials can
reach. This design does not use MeridianLink-side user scoping, so a broker key is not restricted to its own
organization's loans. Deploy only where the shared credential's visibility is acceptable, or add a
loan-to-organization check before exposing the gateway to competing partners.

## Docs

- `AGENTS.md` — operating manual (YAGNI, one-line preference, security invariants, dev-env hygiene,
  community-maintenance duties).
- `CONTRIBUTING.md` — issue and pull-request workflow, sanitization rules, contributor invitations.
- `llms.txt` — compact machine-readable guide for LLMs and coding agents.
- `index.html` — static project page served from GitHub Pages (`main` / root).
- `robots.txt` and `sitemap.xml` — crawler permissions and the canonical page URL for search engines.
- `todo.md` — task tracker. `history.md` — append-only decision log.
