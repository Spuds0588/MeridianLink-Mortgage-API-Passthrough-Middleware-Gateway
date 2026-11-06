const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const REPO = "https://github.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway";

const page = read("index.html");
const agents = read("AGENTS.md");
const contributing = read("CONTRIBUTING.md");
const llms = read("llms.txt");
const readme = read("README.md");
const bugForm = read(".github/ISSUE_TEMPLATE/bug_report.yml");
const improvementForm = read(".github/ISSUE_TEMPLATE/feature_improvement.yml");
const issueConfig = read(".github/ISSUE_TEMPLATE/config.yml");
const prTemplate = read(".github/pull_request_template.md");

// Markdown wraps prose; match phrases in flowing text, not raw lines.
const flat = (text) => text.replace(/\s+/g, " ");

// Minimal issue-form structure: the 40 lines of YAML do not justify a parser dependency.
const formBlocks = (yaml) => `\n${yaml}`.split(/\n\s*-\s+type:\s+/).slice(1);
const formBlock = (yaml, id) => {
  const block = formBlocks(yaml).find((part) => new RegExp(`^\\s*id:\\s*${id}\\s*$`, "m").test(part));
  assert.ok(block, `issue form is missing the "${id}" field`);
  return block;
};
const requiredBlock = (yaml, id) => {
  const block = formBlock(yaml, id);
  assert.match(block, /validations:\s*\n\s*required:\s*true/, `"${id}" must have validations.required: true`);
  return block;
};
// Checkboxes require each option to be marked, not a group-level validations block.
const requiredCheckboxes = (yaml, id) => {
  const block = formBlock(yaml, id);
  const options = (block.match(/^\s*-\s+label:/gm) || []).length;
  const required = (block.match(/^\s*required:\s*true$/gm) || []).length;
  assert.ok(options > 0, `"${id}" must define checkbox options`);
  assert.equal(required, options, `every "${id}" checkbox must be required: true`);
  return block;
};

test("landing page is self-contained, indexable and machine-readable", () => {
  assert.match(page, /<link rel="canonical" href="https:\/\/spuds0588\.github\.io\/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway\/">/);
  assert.match(page, /<link rel="alternate" type="text\/plain" href="\.\/llms\.txt"/);
  assert.ok(fs.existsSync(path.join(root, "llms.txt")), "the linked llms.txt must exist");
  assert.doesNotMatch(page, /<script[^>]+src=/i, "no external scripts");
  assert.doesNotMatch(page, /<link[^>]+stylesheet/i, "no external stylesheets");

  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page);
  assert.ok(ld, "JSON-LD block required");
  assert.deepEqual(
    JSON.parse(ld[1])["@graph"].map((node) => node["@type"]),
    ["WebSite", "SoftwareSourceCode", "FAQPage"]
  );
});

test("landing page pushes issues, pull requests and contributor invitations", () => {
  assert.match(page, /id="community"/);
  for (const link of [`${REPO}/issues/new`, `${REPO}/pulls`, `${REPO}/blob/main/CONTRIBUTING.md`, `${REPO}/blob/main/AGENTS.md`]) {
    assert.ok(page.includes(link), `landing page must link ${link}`);
  }
  assert.match(flat(page), /happy to add contributors/i);
  assert.match(flat(page), /Never include API keys/i);
  assert.match(flat(page), /no MeridianLink access and no AWS account/i);
  assert.match(flat(page), /shared responsibility/i);
  assert.doesNotMatch(flat(page), /production verified|deployed and verified/i);
});

test("llms.txt is a complete, honest agent entry point", () => {
  for (const link of [REPO, `${REPO}/issues`, `${REPO}/pulls`, `${REPO}/blob/main/CONTRIBUTING.md`, `${REPO}/blob/main/AGENTS.md`]) {
    assert.ok(llms.includes(link), `llms.txt must link ${link}`);
  }
  assert.match(llms, /## Community contract/);
  assert.match(llms, /## Instructions for coding agents/);
  assert.match(llms, /## Verification status and limitations/);
  assert.match(flat(llms), /happy to add contributors/i);
  assert.match(flat(llms), /Do not claim live MeridianLink or AWS verification/);
  assert.match(llms, /npm run verify/);
});

test("AGENTS.md makes community maintenance and dev-env hygiene non-negotiable", () => {
  assert.match(agents, /## 0\. Community maintenance is part of the job/);
  assert.match(flat(agents), /open a GitHub issue/i);
  assert.match(flat(agents), /upstream/i);
  assert.match(flat(agents), /add contributors/i);
  assert.match(flat(agents), /YAGNI first/);
  assert.match(flat(agents), /Prefer the one-line solution/);
  assert.match(flat(agents), /limited memory/i);
  assert.match(flat(agents), /Delete, don't accumulate/);
});

test("CONTRIBUTING.md explains the issue and pull-request workflow", () => {
  assert.match(contributing, /## Ways to help/);
  assert.match(contributing, /## Before opening an issue/);
  assert.match(contributing, /## Pull requests/);
  assert.match(contributing, /npm run verify/);
  assert.match(flat(contributing), /happy to add contributors/i);
  assert.match(flat(contributing), /Never include API keys/);
  assert.match(flat(contributing), /template\.yaml` must stay in sync/);
});

test("README points newcomers at every community surface", () => {
  for (const target of ["CONTRIBUTING.md", "llms.txt", "index.html", "AGENTS.md"]) {
    assert.ok(readme.includes(target), `README must reference ${target}`);
  }
  assert.match(flat(readme), /happy to add contributors/i);
  assert.match(readme, /issues\/new/);
  assert.match(readme, /Community-supported — contribute aggressively/);
});

test("bug report form demands a sanitized reproduction and forbids sensitive data", () => {
  assert.match(bugForm, /^name: Bug report$/m);
  assert.match(bugForm, /^title: "\[Bug\]: "$/m);
  for (const id of ["environment", "commit", "steps", "expected", "verify_result", "evidence"]) {
    requiredBlock(bugForm, id);
  }
  const redaction = requiredCheckboxes(bugForm, "redaction");
  for (const phrase of ["API keys", "invite codes", "passwords", "client secrets", "tenant credentials", "loan data", "borrower PII"]) {
    assert.ok(
      flat(redaction).toLowerCase().includes(phrase.toLowerCase()),
      `bug form redaction must forbid ${phrase}`
    );
  }
  assert.match(flat(bugForm), /production loan data/i);
  assert.doesNotMatch(bugForm, /\t/, "issue form YAML must not use tab indentation");
});

test("improvement form keeps scope small and asks how it will be verified", () => {
  assert.match(improvementForm, /^name: Feature or improvement$/m);
  for (const id of ["area", "problem", "proposal", "verification", "implementer"]) {
    requiredBlock(improvementForm, id);
  }
  const agreements = requiredCheckboxes(improvementForm, "agreements");
  assert.match(flat(agreements), /no API keys/i);
  assert.match(flat(improvementForm), /YAGNI/);
  assert.match(flat(improvementForm), /smallest/i);
  assert.doesNotMatch(improvementForm, /\t/, "issue form YAML must not use tab indentation");
});

test("issue chooser routes to the contributing guide and a support surface", () => {
  assert.match(issueConfig, /^blank_issues_enabled:\s*(true|false)$/m);
  assert.match(issueConfig, /^contact_links:$/m);
  const urls = [...issueConfig.matchAll(/^\s*url:\s*(\S+)$/gm)].map((match) => match[1]);
  assert.ok(urls.some((url) => url.endsWith("/blob/main/CONTRIBUTING.md")), "config must link CONTRIBUTING.md");
  assert.ok(urls.some((url) => /\/(issues|discussions)$/.test(url)), "config must link a support surface");
  assert.match(flat(issueConfig), /sanitized|Never post API keys/i);
});

test("PR template requires verification disclosure, regression test and tenant/deploy honesty", () => {
  assert.match(prTemplate, /## What changed and why/);
  assert.match(prTemplate, /Fixes #/);
  assert.match(flat(prTemplate), /Regression test added or updated for this bug fix/i);
  assert.match(flat(prTemplate), /what was actually run/i);
  assert.match(flat(prTemplate), /Not validated against a real MeridianLink tenant/i);
  assert.match(flat(prTemplate), /Not validated against a live AWS deployment/i);
  assert.match(flat(prTemplate), /Do not check a box for a run that did not happen/i);
  assert.match(flat(prTemplate), /API keys/i);
  assert.match(flat(prTemplate), /borrower PII/i);
});

test("documented issue and pull-request links land on shipped templates", () => {
  for (const text of [page, readme, llms, contributing]) {
    assert.ok(text.includes(`${REPO}/issues/new`), "every surface must link the guided issue chooser");
  }
  for (const text of [page, readme, llms, contributing]) {
    assert.ok(text.includes(`${REPO}/pulls`), "every surface must link the pull-request workflow");
  }
  for (const file of [
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_improvement.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/pull_request_template.md",
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
  }
  assert.ok(flat(contributing).includes(`${REPO}/issues/new?template=bug_report.yml`), "CONTRIBUTING must deep-link the bug form");
  assert.ok(flat(contributing).includes(`${REPO}/issues/new?template=feature_improvement.yml`), "CONTRIBUTING must deep-link the improvement form");
});
