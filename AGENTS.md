# AGENTS.md — Operating Manual

For AI agents and developers working in this repository. Read this before touching code.

## 1. Operating Philosophy

- **YAGNI first.** Build only what the current task needs. No speculative flags, config knobs, abstraction layers, or "just in case" endpoints. If a feature is not in `todo.md`, do not write it.
- **Prefer the one-line solution.** If a helper, ternary, or `Array` method does the job, use it instead of a multi-function module. Reach for structure only when a second caller appears.
- **Delete, don't accumulate.** When a shim is replaced, remove the old code in the same commit. No dead branches behind `if (false)`.
- **Fix the cause, not the test.** Never weaken an assertion or skip a test to get green. A failing check is information.
- **Measure before claiming.** Performance or reliability claims need a number from a command you actually ran.

## 2. Scope Discipline

This gateway is a **stateless passthrough**. It must never become a system of record.

- Do **not** store loan data, borrower data, or MISMO documents at rest. Only tenant mappings, job status, and in-flight fee payloads (local dev store) exist.
- Do **not** build a field translation dictionary. Encompass/MeridianLink field IDs come from the source of truth (`GET /v1/fields`).
- Do **not** add SDKs. `fetch` + the AWS runtime's built-in clients are enough. The local runtime has **zero production dependencies**.
- Deny by default: any JSON path not in a persona allowlist is pruned before the response leaves the gateway.

## 3. Standardized Logging

All handlers emit structured JSON via `src/log.js`:

```json
{ "timestamp": "2026-11-06T15:00:00.000Z", "system": "MeridianLinkGateway", "level": "INFO", "action": "READ_REQUEST_RECEIVED" }
```

- Levels: `INFO` | `WARN` | `ERROR`.
- Action names are `SCREAMING_SNAKE_CASE` and stable — they are log-filter keys.
- **Never log** API keys, passwords, SSNs/TaxpayerIdentifiers, credit scores, or full request bodies. Log counts and identifiers (`jobId`, `loanId`, `tenantName`, `feeCount`).

## 4. Handler Contract

Handlers are pure `async (event) => { statusCode, headers, body }` functions shaped like API Gateway REST proxy events, so the same code runs behind API Gateway or the local HTTP server in `src/server.js`. Routing lives in `src/app.js` only.

## 5. Development Environment Hygiene (limited memory)

This machine has limited memory and the local runtime has no build step. Keep the footprint tiny:

1. **No dependencies unless unavoidable.** `npm install` currently installs nothing; keep it that way.
2. **No daemons left running.** The dev/demo server and mock are started explicitly (`npm run dev`) and must be stopped when the task ends: kill the recorded PID (or `pkill -P <pid>`), never a name pattern.
3. **Clean generated state.** Tests run in-memory (no files). If you run `npm start`/`npm run dev`, delete `data/` and any temp fixtures afterwards: `rm -rf data/`.
4. **One test run, then stop.** Use `npm test` (built-in `node:test`, no reporters, no watchers). Do not leave `--watch` processes alive.
5. **No Docker, no emulators, no localstack.** AWS services are represented by the small adapters in `src/` (`store.js`, `queue.js`, credentials from env), which is all the MVP needs.

## 6. Working Agreement

- `todo.md` is the single source of truth for current work; `history.md` is append-only. Update both when a phase changes, and never re-litigate a decision recorded in `history.md` — amend it with a new dated entry instead.
- Commit in small, green increments: `npm test` must pass before every commit.
- Keep `README.md`, `todo.md`, and code in sync. A behavior change without a doc line is an incomplete change.
