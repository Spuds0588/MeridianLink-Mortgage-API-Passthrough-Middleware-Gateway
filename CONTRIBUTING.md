# Contributing

This project is community-supported. It is an independent open-source template, not a vendor-hosted
service and not affiliated with MeridianLink. The maintainer does not have a MeridianLink tenant or a
lender AWS account, so real-world validation is a shared responsibility. Please contribute what you learn
back to the project.

Bugs, MISMO shape corrections, and fixes are a shared responsibility: file them as GitHub
[issues](https://github.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/issues) or
[pull requests](https://github.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/pulls)
with sanitized evidence (redacted field shapes, deployment or log excerpts), never secrets or PII.
Privately-patched forks are discouraged. Do not claim live MeridianLink or AWS verification that did not
happen.

**Want to become a contributor?** Say so on your issue or pull request. The maintainer is happy to add
contributors who want to keep improving this project; validating a real deployment, correcting a MISMO
shape, or reviewing a PR are all strong ways to start.

## Ways to help

- Report reproducible bugs with a minimal case.
- Submit fixes with regression tests.
- Share sanitized MISMO response shapes from a real MeridianLink tenant.
- Run the stack in an AWS sandbox and report what worked or failed, including the static egress IP setup.
- Improve the docs, agent directions, landing page, local fakes, or masking allowlists.
- Review other pull requests.

If you find a bug while deploying the template for a lender, do not leave the fix only in a private fork.
Upstream the smallest fix so the next deployment benefits.

## Before opening an issue

1. Search [existing issues](https://github.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/issues) first.
2. Run `npm run verify` and include the result.
3. Try to reproduce with the local fake in `mock/meridian.js` and the local stack with `npm run dev`.
4. Reduce the report to one endpoint and one unexpected behavior where possible.

A useful bug report includes:

- The commit SHA you tested.
- Node.js version, and whether you used the local fake, AWS, a real MeridianLink tenant, or a combination.
- Expected behavior and actual behavior.
- Steps to reproduce.
- Sanitized request/response examples and logs.
- Whether `npm run verify` passes.
- The smallest test or fake change that reproduces the issue.

Never include API keys, invite codes, passwords, client secrets, loan data, personally identifiable
information, or full upstream payloads. Rotate any credential that was exposed before posting a redacted
report. For an unpatched security issue, use GitHub's private vulnerability reporting for this repository
if it is available; otherwise open a minimal issue without exploit details and ask for a private follow-up
channel.

## Pull requests

1. Fork the repository and create a focused branch.
2. Make the smallest change that fixes the problem. Do not add speculative features, services, or dependencies.
3. Add or update a test that fails before the change.
4. If `src/` or `infra/template.yaml` changed, regenerate and verify:

   ```bash
   npm run build
   npm run verify
   ```

5. Optionally lint the generated template. Install `cfn-lint` outside the repo, run it, and remove the temporary install:

   ```bash
   python3 -m pip install --quiet --target /tmp/cfnlint cfn-lint
   PYTHONPATH=/tmp/cfnlint /tmp/cfnlint/bin/cfn-lint template.yaml
   rm -rf /tmp/cfnlint
   ```

6. Update the relevant docs when behavior, API, deployment, or security changes: `README.md`, `AGENTS.md`,
   `llms.txt`, `index.html`, and `todo.md`. Maintainers should also append to `history.md`; it is an
   append-only work log.
7. Open the pull request with:
   - What changed and why.
   - Tests run and their results.
   - What was not tested, especially live MeridianLink or AWS behavior.
   - Any migration, security, or compatibility impact.

CI must pass on Node 20 and Node 24, and `template.yaml` must stay in sync with the generated build
(`node scripts/build.js --check`).

## Testing against a real environment

If you have access to a MeridianLink Mortgage sandbox or an AWS sandbox:

- Run `deploy.sh` in CloudShell and record the stack outputs.
- Ask MeridianLink support to allowlist `StaticEgressIp`, then confirm the gateway can reach the API.
- Provision one key per role and confirm a mismatched role is rejected.
- Exercise `/v1/fields` with standard IDs and `CX.*` fields.
- Exercise a read, an async fee write, a record-lock retry, and a job status.
- Report the result with sanitized logs, the MeridianLink API version, and the exact response shapes that
  differed from `mock/meridian.js`.

Do not test against production loan data. Use a sandbox and redact all customer information before sharing
anything publicly.

## Community expectations

Keep discussion specific and respectful. Assume good faith, focus on reproducible behavior, and document
uncertainty honestly. A clear bug report with no fix is more useful than an unverified patch that hides the
failure. By contributing, you agree that your contribution is licensed under the repository's MIT License.
