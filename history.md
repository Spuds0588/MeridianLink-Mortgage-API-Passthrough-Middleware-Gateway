# history.md — Decision & Work Log

Append-only. Newest entries at the top. Never rewrite past entries; add a correction instead.

---

## 2026-11-06 — Sister-project parity (Encompass gateway)

Reviewed `https://github.com/Spuds0588/Encompass-API-Passhrough-Middleware-Gateway-` (15 commits) and
adopted the patterns that fit MeridianLink. This entry **supersedes** the earlier MVP decisions on the
open portal, plaintext-key storage, and the missing deployment path; it does not erase them.

**Adopted**

- **Role invite codes.** `title`/`broker`/`appraisal` map server-side to a persona allowlist; the invite
  code is compared with `timingSafeEqual` and provisioning fails closed if a role or code is unset. The
  portal is invite-locked (`GET /portal?role=…&code=…`) instead of open. Replaces "portal unauthenticated
  by design".
- **No plaintext keys.** Only `apiKeyId` is persisted; the portal returns the key once and the dev store
  keeps a key→id map in memory only. Matches API Gateway's model in AWS.
- **Hardened portal.** Inline CSS (Tailwind CDN dropped), strict CSP, `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, developer email captured, cheat sheet of JSON response paths.
- **Schema cache.** `/v1/fields` results cached per persona + field set for 5 minutes, `private, max-age=300`.
- **SQS-shaped writes.** `src/writes.js` classifies retryable vs permanent failures; the SQS event source
  redelivers retryable ones up to 5 times before the DLQ, and `dev/local-runner.js` simulates redelivery
  locally. Jobs store no fee payload; fees travel in the queue message.
- **One-file deployment.** `scripts/build.js` bundles `src/` into a single CJS file, inlines it into
  `infra/template.yaml`, and enforces CloudFormation's 51,200-byte direct-upload limit; `template.yaml` is
  generated and committed. Template guards plus a test that extracts and executes the inline bundle.
- **Distribution.** `deploy.sh` (CloudShell, generates invite codes, prints invite links and the egress IP)
  and `.github/workflows/ci.yml` (tests + `build --check` on Node 20 and 24).
- **Async storage interface** injected as `getTenant`/`putTenant`/`getJob`/`putJob`/`enqueueWrite`/
  `createApiKey`/`getSecret`, with AWS and in-memory implementations.

**Adapted or rejected**

- **Persona token impersonation** is N/A for MeridianLink (no subject-user token exchange). The gateway
  mask is the persona boundary; the role table selects it server-side.
- **30-second read cache** rejected: the Meridian design forbids a local copy of loan data. Reads keep a
  15-second client `private` cache only.
- **`?fields=` projection** rejected: MeridianLink's JSON contract is masked MISMO containers, not numeric
  field IDs, so the allowlist already defines the projection. Fewer knobs, no validation surface.
- **Static site extras** (`index.html`, `llms.txt`, `robots.txt`, `sitemap.xml`, `CONTRIBUTING.md`) deferred;
  they are distribution polish, not gateway behavior, and are logged in `todo.md`.
- **VPC + NAT + static Elastic IP** added beyond the sister template because MeridianLink requires an
  allowlisted egress address; the sister's Encompass host does not.

Template size forced two concessions: the inlined deploy copy drops comments/indentation (source stays
readable), and verbose CloudFormation descriptions were shortened. Final template: 50,858 bytes.

## 2026-11-06 — Local verification run (post-build)

Ran `npm test` → **16/16 pass, 0 fail** (~1.0s). Then started the real stack
(`PORT=8099 MOCK_PORT=8098 node scripts/dev.js`) against the mock MeridianLink API and exercised every
route with HTTP requests:

| Check | Result |
| --- | --- |
| `GET /health` | `200 {"status":"ok"}` |
| `GET /portal` | `200 text/html; charset=utf-8` |
| `POST /portal` (TITLE_VENDOR) | `200`, key issued (`mlg_…`, 36 chars) |
| `GET /v1/loans/ML-998822` without key | `403` |
| `GET /v1/loans/ML-998822` with key | `200`, `Cache-Control: private, max-age=15`, no `borrower` object, no SSN, no credit score |
| `GET /v1/loans/ML-LOCKED-1` | `423` (upstream lock surfaced) |
| `GET /v1/loans/ML-404` | `404` |
| `PATCH /v1/loans/ML-998822/fees` (2 fees) | `202 ACCEPTED` + `jobId` + `statusUrl` |
| `GET /v1/jobs/{jobId}` | `COMPLETED`, `attempts: 1`, `error: null` |
| `GET /v1/fields?ids=11,646,CX.TITLE.STATUS` | `200` with all three definitions |
| `PATCH …/fees` with empty array | `400` |

Cleanup: background PID killed with `kill $PID`, `data/` (log + store + captured responses) removed, no
node process left behind. Only the outer `bash -c` wrapper matched `pgrep` (its own command line), so no
process was killed by pattern.

**Production verification is still outstanding**: this environment has no AWS account and no MeridianLink
credentials, so the running check above is production-equivalent only at the code/runtime level, not the
deployed topology (API Gateway usage plans, VPC/NAT static IP, Secrets Manager, SQS).

---

## 2026-11-06 — MVP build

**Read the source of truth.** `chat-branch-of-encompass-api-middle-google-ai-studio-2026-11-06-1602.md`
contains the Master Dev Document for the MeridianLink Mortgage gateway (PRD, architecture, API spec,
task list, canonical `read_proxy.js`, `deploy.sh`). Several section bodies in the export are collapsed
to headings; where the doc is silent, the implementation followed its stated principles.

**Decisions**

- **Local-first MVP, no cloud dependency.** No AWS account and no MeridianLink credentials are available.
  Each AWS primitive is replaced by a tiny adapter with the same contract:
  - DynamoDB `Tenants`/`Jobs` → `src/store.js` (in-memory, optional JSON file for `npm start`).
  - SQS FIFO + worker Lambda → `src/queue.js` (per-`loanId` FIFO groups, concurrency 10, exponential
    backoff on `423`/`429`/`5xx`, `PENDING → RETRYING → COMPLETED|FAILED`).
  - Secrets Manager + NAT static egress → `src/meridian.js` credentials from env, `MERIDIAN_BASE_URL`.
  - API Gateway REST proxy → `src/server.js` converts HTTP to API-Gateway-shaped events, so handlers are
    drop-in compatible with the real deployment target.
- **Zero dependencies.** `fetch`, `node:http`, `node:test` are sufficient; nothing to install, nothing to
  clean up. Keeps the memory footprint of the dev environment minimal per `AGENTS.md`.
- **Masking is allowlist-based and deny-by-default.** Unknown roles get `null` → `403`, so a bad DynamoDB
  record fails closed instead of leaking a full loan.
- **No CloudFormation yet.** `template.yaml`, VPC/NAT/Elastic IP and `deploy.sh` cannot be verified without
  AWS; shipping them untested would be unverified infrastructure. Logged as deferred in `todo.md`.
- **Portal is unauthenticated by design for MVP**, matching the doc, and flagged in README as the first
  hardening item (invite link or IdP gate).

**Verification performed**

- `npm test` (built-in runner): translation, masking/NPI, read 200/403/404, write `202` → `COMPLETED`,
  lock-contention retry, exhausted retries → `FAILED`, cross-tenant job access denied, validation `400`,
  field dictionary, HTTP smoke on `/health` and `/portal`.
- Local run: gateway on `:8080` against mock MeridianLink on `:8081`, exercised with real HTTP requests
  (portal provisioning → masked read → async fee write → job status).
- **Not verified:** real MeridianLink API behavior, AWS deployment (VPC/NAT/IP whitelist), CloudFormation.
