# history.md — Decision & Work Log

Append-only. Newest entries at the top. Never rewrite past entries; add a correction instead.

---

## 2026-11-06 — EDocs document upload, list, and download; template headroom restored

**Why.** Document exchange is the highest-value broker workflow after conditions, and it was blocked by two
separate problems: no EDocs transport and only 19 bytes of template headroom. Solving only the transport
would have produced code that could not be deployed.

**Size strategy.** `scripts/build.js` now minifies the inlined Lambda copy (strings, templates, and regex
literals preserved; whitespace and comments removed) instead of only stripping full-line comments. It is a
zero-dependency tokenizer, not a third-party minifier. The readable `dist/gateway.js` is unchanged in role,
and the deploy stays one inline CloudFormation file with no S3 or zip. Result: **49,173 bytes, 2,027 bytes
under the 51,200-byte limit** (previously 51,181 bytes, 19 bytes under), with a 1 KB minimum asserted in
`test/template.test.js`. The build also parses the minified output before writing it.

**Changed**

- `src/meridian.js`: `EDocsService.asmx` SOAP 1.1 client with `ListEdocsByLoanNumber`, `UploadPDFDocument`,
  and `DownloadEdocsPdfById`; `AuthService.asmx` `GetUserAuthTicket` cached for 50 minutes per Lambda
  container and refreshed once on a `401`/`403`. The EDocs mount path defaults to `<baseUrl>/edocs`.
- `src/app.js`: broker-only `POST /v1/loans/{id}/documents` validates `documentType` (max 100), `notes` (max
  500), base64 syntax, the `%PDF-` signature, and a 180,000-byte decoded cap before creating a job. It returns
  `202` plus the standard status URL. `GET /v1/loans/{id}/documents` returns IDs/types/names; `GET
  /v1/loans/{id}/documents/{docId}` returns `{ documentId, contentType: "application/pdf", contentBase64 }`.
- `src/writes.js`, `src/lambda.js`, `dev/local-runner.js`: the queue message carries either `mismo` or `doc`;
  the worker calls `uploadDocument` for documents and keeps the existing retry/backoff/DLQ behavior. The job
  record still contains no payload.
- `src/edocs.js`: parses EDocs `edoc` attributes and the base64 download result.
- `mock/meridian.js`: fake SOAP `AuthService`/`EDocsService` with ticket issuance, per-loan documents, list,
  download, and ticket counters, so tests exercise the real envelope and parser.
- `README.md`, `llms.txt`, `index.html`, `AGENTS.md`: document routes, broker-only authorization, the 180 KB
  SQS cap, the minifier, and the unverified EDocs shapes.

**Verified.** `npm run verify`: 58 tests, 58 pass, 0 fail. New coverage: upload 202 → queue payload → worker →
SOAP envelope → fake EDocs document; list and download round-trip; ticket reuse across writes and reads;
non-broker rejections; invalid base64 (`400`), non-PDF (`415`), oversized (`413`), and missing fields (`400`);
EDocs auth failure (`502`); and execution of the exact minified inline bundle.

**Not verified.** No MeridianLink tenant exists here, so the SOAP response shapes and the `/edocs` mount path
are assumptions checked only against the local fake. Uploads over 180,000 bytes are rejected because the PDF
travels inside the SQS message; an S3 staging hop would be the next architecture change if deployments need
larger files. The production GitHub Pages copy is verified after push; there is no deployed AWS API to call.

---

## 2026-11-06 — Broker condition submission through the FIFO pipeline

**Why.** Conditions were readable but could not be answered, which blocks the main broker workflow. The
MeridianLink integration documentation states that conditions are matched by description and that a save
only updates the rows included in the payload, so a partial condition update is a documented behavior rather
than an invented merge rule.

**Changed**

- `POST /v1/loans/{id}/conditions` for the `TPO_BROKER` persona, accepting `{ conditions: [{ description,
  status }] }`, validated to 100 rows with 200/50-character limits, returning `202` and a job ID.
- `src/mismo.js`: `conditionsToXml` emits MISMO `<CONDITIONS>` and shares one `mismoUpdate` wrapper with
  `feesToXml` to keep the bundle inside the deployment limit.
- `src/writes.js`, `src/lambda.js`, `dev/local-runner.js`: the queue message now carries prebuilt MISMO XML
  (`mismo`) instead of a fees array, so fee and condition writes share one delivery and retry path.
- `src/meridian.js`: `updateFees` renamed to `updateLoan` to match the generalized pipeline.
- `src/portal.js`: portal CSS trimmed to make room for the new code; the template is 51,181 bytes, 19 bytes
  under CloudFormation's 51,200-byte limit.
- `README.md`, `llms.txt`, `index.html`: condition submission documented, document coverage still listed as
  missing, and the FAQ/JSON-LD answer corrected.
- `todo.md`: documents and conditions moved to a Priority 1 section.

**Verified.** `npm run verify`: 53 tests, 53 pass, 0 fail. The new tests cover broker submission end to end
(queue payload, worker completion, upstream XML), broker-only authorization, and validation failures. Not
verified: real MeridianLink condition semantics, since there is no tenant access.

**Still blocked.** Document upload/download needs the EDocs SOAP service and an AuthService ticket, plus
about 2 KB of bundle headroom that does not exist today (19 bytes remain). `todo.md` records the exact
unblock requirement.

---

## 2026-11-06 — Close the AMC fee-write authorization gap

**Finding.** `enqueueWrite` authorized any valid tenant without checking the persona, so an `AMC_VENDOR`
key could queue fee writes for any loan. The appraisal allowlist deliberately omits fees, so those writes
produced records the caller could not read or verify, from a persona scoped to appraisal data only.

**Changed**

- `src/app.js`: fee writes now require `TITLE_VENDOR` or `TPO_BROKER`; any other persona fails closed with
  `403 {"error":"Persona cannot write fees"}` before the body is parsed or a job is written. One line, no new
  configuration, no new storage.
- `test/gateway.test.js`: an appraisal key receives `403` and `store.queue.length` stays `0`, proving the
  rejection happens before enqueue.
- `README.md` and `llms.txt`: state the persona restriction so integrations do not discover it at runtime.
- `template.yaml`: regenerated at 51,035 bytes, still under the 51,200-byte direct-upload limit.

**Verified locally.** `npm run verify`: 51 tests, 51 pass, 0 fail. Post-push fresh-clone reproduction and the
live Pages `llms.txt` check are run in the same turn and reported in the session summary.

---

## 2026-11-06 — Correct the implied broker loan isolation claim

**Finding.** The audit that accompanied the broker write-scope change exposed a second gap: tenant
resolution fixes the persona, not the loan. `readLoan` and `enqueueWrite` never compare the loan to the
caller's organization, and the deployed handler authenticates to MeridianLink with one shared credential.
Any valid broker key can therefore request any loan ID the shared credential can reach. The README row that
listed "other-org data" as never visible to a broker implied an isolation check that does not exist.

**Changed**

- `README.md`: the broker row no longer claims other-org isolation and notes fees are write-only for that
  persona; the limitations section states the missing loan-to-organization check and the deployment
  consequence (do not share one tenant's key with a competitor without adding it).
- `llms.txt`: same warning for agents and integrators.
- `todo.md`: records per-loan organization scoping as blocked on a loan-to-organization field in the MISMO
  payload; no guessing at an organization tag.

**Not changed.** No code path was altered for this entry. Enforcing scoping needs a real field that ties a
loan to an organization, which the fixture and local fake do not model; a fabricated check would look like
security without being one. `npm run verify` stays green at 50 tests and `template.yaml` at 50,916 bytes.

---

## 2026-11-06 — Broker capability audit; unsupported loan writes now say so

**Finding.** Broker keys (`TPO_BROKER`) read identity (name, email), property, terms, conditions, and lock
status, and can queue fee updates. They do **not** get a full 1003: the parser has no employment, income,
assets, liabilities, or declarations sections, and the mask allowlist has no paths for them. There is also no
write path for 1003 fields, borrower documents, or condition responses. The recovered dev-doc intent was
broader ("Keep: 1003 Data, Milestones, Conditions, Rate Lock Status"), but implementing it requires real
MeridianLink MISMO shapes and document transport; guessing them would violate the repository's no-invented-
endpoints rule and produce a tested-but-fictional contract.

**Changed**

- `PATCH /v1/loans/{id}` now returns `501` with "Only fee writes are supported; 1003, document, and condition
  writes are not implemented" instead of silently behaving as an undocumented fees alias. `PATCH
  /v1/loans/{id}/fees` is unchanged.
- `test/gateway.test.js`: a broker read-contract test (exact top-level keys, borrower name/email only, 1003
  sections asserted absent) and a broker write-scope test (loan PATCH `501`, document and condition routes
  `404`, fee write `202`).
- `README.md`: broker workflow coverage matrix, the `501` row in the API table, and the limitation explaining
  what is missing and why. `llms.txt`: broker coverage bullet so agents do not build against absent paths.
- `index.html`: broker FAQ entry plus the matching `FAQPage` JSON-LD question.
- `todo.md`: audit and `501` marked done; full 1003, document upload, and condition responses recorded as
  blocked on sanitized vendor samples.

**Verified.** `npm run verify`: 50 tests, 50 pass, 0 fail; `template.yaml` regenerated and still under the
CloudFormation limit at 50,916 bytes. Not verified: any real 1003 MISMO shape, document endpoint, condition
merge semantics, or live AWS/MeridianLink behavior.

---

## 2026-11-06 — Purge the original dev-doc transcript

**Why.** `chat-branch-of-encompass-api-middle-google-ai-studio-2026-11-06-1602.md` was the 87 KB build
transcript that seeded this repository. Its requirements are implemented, tested, and restated in
`README.md`, `AGENTS.md`, `llms.txt`, `CONTRIBUTING.md`, `index.html`, and this log, so the stale transcript
only invited contributors to follow superseded instructions and inflated clones and Pages payloads.

**Changed**

- Deleted the transcript from the repository and removed its entry from the `README.md` docs list.
- Recorded the removal in `todo.md`.
- No source, test, template, or deployment file referenced the document; the only remaining mention is this
  log's earlier entry that describes where the requirements came from.

**Not done.** Git history is unchanged: the file still exists in the commits that introduced and updated it.
Removing it from history requires a rewrite (`git filter-repo`) and a force-push, which is separate,
destructive work that the maintainer must authorize.

**Verification.** `npm run verify` passes with the full suite green and `template.yaml` still at 50,858
bytes; a repository search for the filename returns only the historical entry in this log.

---

## 2026-11-06 — GitHub Pages live; crawler and agent discovery files

**Context.** The maintainer enabled GitHub Pages on `main` / root, so `index.html` now serves the project
publicly at `https://spuds0588.github.io/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/`. The
pre-deploy fetch confirmed the page, its canonical tag, JSON-LD, and `./llms.txt` all resolve (HTTP 200),
while `robots.txt` and `sitemap.xml` returned 404.

**Changed**

- `robots.txt`: allow all crawlers and point at the canonical sitemap URL. The landing page and `llms.txt`
  stay crawlable for both search engines and agent tooling.
- `sitemap.xml`: single canonical URL with a last-modified date, so search engines index the Pages URL and
  not a duplicate `index.html` path.
- `index.html`: declares the sitemap in the document head.
- `test/static.test.js`: one more guard for the sitemap declaration, the robots directives, and the sitemap
  URL matching the canonical HTTPS URL.
- `README.md` and `todo.md`: record the Pages enablement and the new files; the Pages toggle is no longer an
  open maintainer action.

**Verification before push.** `npm run verify`: 48 tests, 48 pass, 0 fail; `template.yaml` unchanged at
50,858 bytes. `sitemap.xml` parses as XML with one `<loc>`. Post-push publication is checked by fetching the
live `robots.txt`, `sitemap.xml`, page head, and `llms.txt` once Pages rebuilds.

---

## 2026-11-06 — Guided issue and PR intake

**Requirement.** The docs, README, and landing page told contributors to open issues and pull requests,
but `issues/new` and `/pulls` led to blank forms. The contribution path is now usable end to end from the
repository alone, with no account or repository-setting access required.

**Changed**

- `.github/ISSUE_TEMPLATE/bug_report.yml`: environment dropdown (local fake, deployed stack, real tenant,
  combination, inspection only), required commit SHA, minimal reproduction, expected vs actual, `npm run
  verify` output, and sanitized evidence; required redaction checklist forbidding API keys, invite codes,
  passwords, client secrets, tenant credentials, loan data, and borrower PII, plus no-production-loan-data
  and verification-honesty acknowledgements.
- `.github/ISSUE_TEMPLATE/feature_improvement.yml`: area, problem, smallest proposal (YAGNI), alternatives,
  how it would be verified, whether the reporter can implement it, and required search/no-secrets/
  scope-expectation acknowledgements.
- `.github/ISSUE_TEMPLATE/config.yml`: contact links to `CONTRIBUTING.md` and to the issues list as the
  support and deployment-report surface. Blank issues stay enabled because GitHub Discussions is not enabled
  on this repository (verified HTTP 404), so a discussions-only entry point would dead-end.
- `.github/pull_request_template.md`: what changed, linked issue, actual `npm run verify`/build results, a
  required regression test for bug fixes, an explicit "not validated against a real MeridianLink tenant" and
  "not validated against a live AWS deployment" disclosure with a place to explain what remains unproven,
  redaction and no-storage checks, docs checklist, and reviewer notes.
- `CONTRIBUTING.md`, `README.md`, `llms.txt`, `index.html`: deep-link the bug and improvement forms and point
  PR authors at the template. README and llms.txt now link the PR template file directly.
- `test/static.test.js`: six new guards for form structure (required fields and required checkboxes), the
  chooser config's contributing and support links, the PR template's verification and redaction language, and
  the fact that every documented issue/PR link resolves to shipped scaffolding.

**Correction.** The previous entry and `todo.md` said issue/PR templates needed repository settings or a
maintainer decision. They do not: `.github/ISSUE_TEMPLATE/*` and `.github/pull_request_template.md` are
ordinary repository files, and GitHub serves them as soon as they are on the default branch. The remaining
maintainer actions are enabling GitHub Pages, optionally enabling Discussions, and inviting contributors.

**Verified.** `npm run verify`: 47 tests, 47 pass, 0 fail; `template.yaml` unchanged at 50,858 bytes. The
three YAML files parse with PyYAML and report the intended required fields. Issue forms were not rendered in
GitHub's UI (no authenticated account access), so form rendering on github.com remains unverified until the
files are on `main` and a browser opens `issues/new/choose`.

---

## 2026-11-06 — Aggressive community maintenance

**Requirement.** The sister project asks deployers to report back; this repository did not. The maintainer
does not have MeridianLink or AWS access for this project, so real usage is the only source of truth.
Community contribution is now treated as a product requirement rather than a nicety.

**Changed**

- `AGENTS.md` §0 "Community maintenance is part of the job": file an issue for every found bug, upstream
  every fix with a regression test, state explicitly when a fix cannot be contributed, recruit contributors,
  never claim unperformed verification, never leak secrets or loan data, keep all surfaces in sync.
- `llms.txt` (new): canonical links, API and deploy summary, community contract, numbered instructions for
  coding agents, and an honest verification/limitations section.
- `CONTRIBUTING.md` (new): ways to help, issue checklist and report template, pull-request workflow with
  `npm run build`/`npm run verify`, optional `cfn-lint`, real-environment testing steps, redaction rules,
  and an explicit "maintainer will add contributors" invitation.
- `index.html` (new): GitHub Pages landing page with a community section above the features, direct
  `issues/new` and `pulls` links, contributor invitation, FAQ (including what is unverified), canonical
  metadata, OG/Twitter tags, and JSON-LD. Self-contained: inline CSS, no external scripts or fonts.
- `README.md`: a community section at the top pointing at issues, PRs, `CONTRIBUTING.md`, `AGENTS.md`,
  `llms.txt`, and `index.html`.
- `test/static.test.js`: guards the canonical/JSON-LD metadata, the absence of external assets, the
  issue/PR/contributor links, the `AGENTS.md` maintenance and hygiene principles, and the `llms.txt`
  contract. The direction cannot silently rot.

**Decisions**

- No false verification claims anywhere: the maintainer has no MeridianLink or AWS access, and every
  surface says so. The FAQ answers "what has not been verified" directly.
- Privately patched forks are discouraged; the smallest upstream fix plus a regression test is the
  expected path.
- GitHub Pages is served from `main` root when enabled in repository settings; there is no separate build.
- Issue/PR templates and a triage rotation are deferred in `todo.md`; they need repository settings or a
  maintainer decision, not code.

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
