# todo.md — Task Tracker

Single source of truth for work in progress. Append to `history.md` when an item changes state.
Legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[—]` deliberately deferred (YAGNI / blocked)

## Phase 1 — Core Infrastructure

- [x] Zero-dependency Node runtime, API-Gateway-shaped events (`src/app.js`, `src/server.js`, `src/lambda.js`)
- [x] Async storage interface with AWS adapter (`src/aws-store.js`) and in-memory dev adapter (`dev/memory-store.js`)
- [x] FIFO write pipeline: SQS event source in AWS, drain runner locally (`src/writes.js`, `dev/local-runner.js`)
- [x] Structured JSON logging standard (`src/log.js`)

## Phase 2 — Translation & Schema Masking

- [x] MISMO 3.4 XML → normalized loan JSON (`src/mismo.js`)
- [x] Vendor fee JSON → MISMO 3.4 XML (`src/mismo.js`)
- [x] Persona allowlist masking: `TITLE_VENDOR`, `TPO_BROKER`, `AMC_VENDOR` (`src/mask.js`)
- [x] NPI (SSN, credit score, income) never emitted to non-broker personas (tested)

## Phase 3 — Synchronous Read

- [x] `GET /v1/loans/{id}` with `apiKeyId` → tenant resolution, upstream passthrough, masking
- [x] Upstream error mapping (404 loan, 423 locked, 429 rate limit, 502/504 failures)
- [x] `Cache-Control: private, max-age=15`
- [—] Server-side read cache (rejected: the Meridian design forbids a local loan copy)

## Phase 4 — FIFO Write Pipeline

- [x] `PATCH /v1/loans/{id}/fees` (and `PATCH /v1/loans/{id}`) → `202 ACCEPTED` + `jobId`
- [x] Per-loan FIFO ordering (`MessageGroupId = loanId`), Lambda concurrency cap 5, DLQ after 5 receives
- [x] Retry classification: `423`/`429`/`5xx`/transport retried; permanent rejections `FAILED`
- [x] `GET /v1/jobs/{jobId}` with tenant ownership (foreign jobs → `404`)
- [x] Job TTL, no fee payload persisted in the job record
- [x] Broker capability audit (2026-11-06): partial 1003 read, fee-only writes, no document or condition writes
- [x] `PATCH /v1/loans/{id}` returns `501` instead of acting as an undocumented fees alias
- [—] Full 1003 read/write, borrower document upload, and condition responses (blocked: needs sanitized MeridianLink MISMO samples plus confirmed vendor endpoints; inventing shapes would violate the no-guess rule)

## Phase 5 — Self-Serve Onboarding (sister-project parity)

- [x] Role-scoped invite codes (`title`/`broker`/`appraisal`), timing-safe compare, fails closed
- [x] `GET /portal?role=…&code=…` persona-locked form; invalid/mismatched invites rejected
- [x] `POST /portal` provisions a scoped key and stores only `apiKeyId`
- [x] Hardened portal: strict CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, inline CSS (no CDN)
- [x] Common-field cheat sheet in the portal (JSON paths, links to `/v1/fields` for the rest)
- [—] Single-use invite codes / revocation UI / admin dashboard (deferred; codes are rotatable per role)

## Phase 6 — Packaging, Distribution & Verification

- [x] `scripts/build.js`: bundle `src/` → `dist/gateway.js`, inline into `template.yaml`, 51,200-byte guard, `--check`
- [x] `infra/template.yaml`: VPC + NAT + static EIP, DynamoDB, SQS FIFO + DLQ, Secrets Manager, API Gateway usage plan, inline Lambda
- [x] `deploy.sh` one-line CloudShell installer (prompts for Meridian creds, generates invite codes, prints invite links + egress IP)
- [x] CI (`.github/workflows/ci.yml`): tests + template-sync on Node 20 and 24
- [x] Tests: translation, masking, invites, schema cache, reads, writes/retries, ownership, `createDevGateway` HTTP e2e, template guards, executed inline bundle
- [x] `npm run verify` green; committed and pushed
- [x] Community surfaces: `CONTRIBUTING.md`, `llms.txt`, GitHub Pages `index.html`, contributor invitations
- [x] Community direction codified in `AGENTS.md` §0 (file issues, upstream fixes, recruit contributors)
- [x] Static guard tests keep the issue/PR/contributor direction from rotting
- [—] Live AWS deployment + MeridianLink calls (blocked: no AWS account or vendor access)
- [x] Guided issue forms: `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_improvement.yml` (sanitization fields required)
- [x] Issue chooser config (`.github/ISSUE_TEMPLATE/config.yml`) links `CONTRIBUTING.md` and the support/issues surface
- [x] PR template (`.github/pull_request_template.md`): actual verification, regression test, not-validated-against-tenant/deploy disclosure
- [x] Static guards over forms, config, and template so the scaffolding cannot silently rot
- [x] Purged the original dev-doc transcript; its requirements now live in `README.md`, `AGENTS.md`, `llms.txt`, and `CONTRIBUTING.md`
- [—] Enable GitHub Discussions so the support contact can move off the issues list (maintainer action; verified 404 today)
- [x] GitHub Pages enabled on `main` / root (2026-11-06); canonical page served at the project Pages URL
- [x] `robots.txt` + `sitemap.xml` so crawlers find the canonical page and the agent-facing `llms.txt`
- [—] Contributor invitations and a designated triage rotation (maintainer action)
