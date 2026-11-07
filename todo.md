# todo.md — Task Tracker

Single source of truth for work in progress. Append to `history.md` when an item changes state.
Legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[—]` deliberately deferred (YAGNI / blocked)

## Priority 1 — Loan file documents & condition responses

- [x] Condition submission: `POST /v1/loans/{id}/conditions` (broker persona) queued through FIFO as MISMO `<CONDITIONS>`, matched by description (commit `1ba6fd1`)
- [x] Loan document upload/download: `POST /v1/loans/{id}/documents` (broker persona, base64 PDF, 180,000-byte SQS cap), `GET /v1/loans/{id}/documents`, and `GET /v1/loans/{id}/documents/{docId}` through `EDocsService.asmx` with a cached `AuthService.asmx` ticket (commit `93d43e7`)
- [x] Portal onboarding shows the invited role its real surface: title/broker fee writes, broker condition submission, and broker document upload/list/download, plus condition paths in the cheat sheet (commit `db6a97c`)
- [x] Portal persona filtering proven by executing the served inline script against a document stub: title and broker see fee writes, broker also sees conditions plus document upload/list/download, appraisal sees no fee write. The test exposed and removed an appraisal-only fee curl (commit `3301d52`)
- [—] Live EDocs validation (blocked: no MeridianLink tenant; the SOAP response shapes and default `/edocs` mount path are verified only against `mock/meridian.js`)

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
- [x] Broker capability audit (2026-11-06): partial 1003 read, fee-only writes, no document or condition writes (superseded for conditions by `1ba6fd1` and documents by `93d43e7`)
- [x] `PATCH /v1/loans/{id}` returns `501` instead of acting as an undocumented fees alias
- [x] Fee writes reject the read-only `AMC_VENDOR` persona before any job is created (commit `4aa360e`); title and broker personas keep write access
- [—] Full 1003 read/write (blocked: needs sanitized MeridianLink MISMO samples; inventing shapes would violate the no-guess rule)
- [—] Per-loan organization scoping (blocked: the MISMO samples carry no loan-to-organization field; until then any valid key can request any loan ID the shared credential reaches)

## Phase 5 — Self-Serve Onboarding (sister-project parity)

- [x] Role-scoped invite codes (`title`/`broker`/`appraisal`), timing-safe compare, fails closed
- [x] `GET /portal?role=…&code=…` persona-locked form; invalid/mismatched invites rejected
- [x] `POST /portal` provisions a scoped key and stores only `apiKeyId`
- [x] Hardened portal: strict CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, inline CSS (no CDN)
- [x] Common-field cheat sheet in the portal (JSON paths, links to `/v1/fields` for the rest)
- [—] Single-use invite codes / revocation UI / admin dashboard (deferred; codes are rotatable per role)

## Phase 6 — Packaging, Distribution & Verification

- [x] `scripts/build.js`: bundle `src/` → readable `dist/gateway.js`, minify the inlined copy (comments/whitespace, no dependency), 51,200-byte guard, `--check`
- [x] Template headroom restored: 49,173 bytes, 2,027 bytes under the limit, with a 1 KB minimum enforced by `test/template.test.js` (commit `93d43e7`)
- [x] Portal endpoint list consumes headroom: 50,010 bytes, 1,190 bytes under the limit, still above the 1 KB guard (commit `db6a97c`)
- [x] Executable portal test: 59 tests, template 50,135 bytes with 1,065 bytes headroom, only 41 bytes above the 1 KB guard (commit `3301d52`)
- [x] `infra/template.yaml`: VPC + NAT + static EIP, DynamoDB, SQS FIFO + DLQ, Secrets Manager, API Gateway usage plan, inline Lambda
- [x] `deploy.sh` one-line CloudShell installer (prompts for Meridian creds, generates invite codes, prints invite links + egress IP)
- [x] CI (`.github/workflows/ci.yml`): tests + template-sync on Node 20 and 24
- [x] Tests: translation, masking, invites, schema cache, reads, writes/retries, ownership, `createDevGateway` HTTP e2e, template guards, executed inline bundle
- [x] `npm run verify` green; committed and pushed
- [x] Community surfaces: `CONTRIBUTING.md`, `llms.txt`, GitHub Pages `index.html`, contributor invitations
- [x] Community direction codified in `AGENTS.md` §0 (file issues, upstream fixes, recruit contributors)
- [x] Static guard tests keep the issue/PR/contributor direction from rotting
- [—] Live AWS deployment + MeridianLink calls (blocked: no AWS account or vendor access; probed 2026-11-06: `aws` is not installed (`command not found`, exit 127), no `AWS_*` environment variables exist, `~/.aws` and `~/.config/aws` are absent, the repository records no stack or API URL, and CI has no deploy job. Document upload/download code is complete and shipped to `main` at `93d43e7`; only the AWS API deployment is blocked on account credentials)
- [x] Guided issue forms: `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_improvement.yml` (sanitization fields required)
- [x] Issue chooser config (`.github/ISSUE_TEMPLATE/config.yml`) links `CONTRIBUTING.md` and the support/issues surface
- [x] PR template (`.github/pull_request_template.md`): actual verification, regression test, not-validated-against-tenant/deploy disclosure
- [x] Static guards over forms, config, and template so the scaffolding cannot silently rot
- [x] Purged the original dev-doc transcript; its requirements now live in `README.md`, `AGENTS.md`, `llms.txt`, and `CONTRIBUTING.md`
- [—] Enable GitHub Discussions so the support contact can move off the issues list (maintainer action; verified 404 today)
- [x] GitHub Pages enabled on `main` / root (2026-11-06); canonical page served at the project Pages URL
- [x] `robots.txt` + `sitemap.xml` so crawlers find the canonical page and the agent-facing `llms.txt`
- [—] Contributor invitations and a designated triage rotation (maintainer action)
