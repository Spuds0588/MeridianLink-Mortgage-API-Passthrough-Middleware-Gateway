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

// Markdown wraps prose; match phrases in flowing text, not raw lines.
const flat = (text) => text.replace(/\s+/g, " ");

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
