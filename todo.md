# todo.md — Task Tracker

Single source of truth for work in progress. Append to `history.md` when an item changes state.
Legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[—]` deliberately deferred (YAGNI / blocked)

## Phase 1 — Core Infrastructure (local MVP)

- [x] Zero-dependency Node runtime, API-Gateway-shaped events (`src/app.js`, `src/server.js`)
- [x] Local adapters: tenant/job store (`src/store.js`), FIFO write queue (`src/queue.js`), credentials from env (`src/meridian.js`)
- [x] Structured JSON logging standard (`src/log.js`)
- [—] CloudFormation `template.yaml` + VPC/NAT/Elastic IP (needs AWS; cannot be verified here)
- [—] `deploy.sh` CloudShell installer (depends on the unverified template)

## Phase 2 — Translation & Schema Masking

- [x] MISMO 3.4 XML → normalized loan JSON (`src/mismo.js`)
- [x] Vendor fee JSON → MISMO 3.4 XML (`src/mismo.js`)
- [x] Persona allowlist masking: `TITLE_VENDOR`, `TPO_BROKER`, `AMC_VENDOR` (`src/mask.js`)
- [x] NPI (SSN, credit score, income) never emitted to non-broker personas (tested)

## Phase 3 — Synchronous Read

- [x] `GET /v1/loans/{id}` with API-key → tenant resolution, upstream passthrough, masking
- [x] Upstream error mapping (404 loan, 423 locked, 502 unreachable)
- [x] `Cache-Control: private, max-age=15`

## Phase 4 — FIFO Write Pipeline

- [x] `PATCH /v1/loans/{id}/fees` (and `PATCH /v1/loans/{id}`) → `202 ACCEPTED` + `jobId`
- [x] Per-loan FIFO ordering (`MessageGroupId = loanId`), concurrency cap 10
- [x] Retry with exponential backoff on `423`/`429`/`5xx`/transport errors, then `FAILED`
- [x] `GET /v1/jobs/{jobId}` with tenant ownership check

## Phase 5 — SSR Admin Portal

- [x] `GET /portal` zero-build HTML portal (Tailwind CDN)
- [x] `POST /portal` provisions scoped API key + role mapping, returns copy-paste cURL
- [—] Portal authentication / invite links (open by design for MVP; documented in README)

## Phase 6 — Verification & Distribution

- [x] `node:test` suite: translation, masking, read, write, retries, ownership, portal, HTTP smoke
- [x] Mock MeridianLink Mortgage API (`mock/meridian.js` + `fixtures/loan.xml`) for local E2E
- [x] Run the gateway locally and smoke-test every route over HTTP
- [x] Commit + push to `origin/main`
- [ ] Production verification on AWS (blocked: no AWS account / MeridianLink access)
