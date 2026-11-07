#!/usr/bin/env node
/**
 * Opt-in production check for the only deployed surface: GitHub Pages.
 * Fetches the live page, tolerates deploy lag, and requires byte equality with
 * the committed index.html. It also reports whether the invite portal exists;
 * Pages serves only the static page, so persona rendering cannot be exercised
 * there without a deployed API.
 */
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BASE =
  process.env.PRODUCTION_URL ||
  "https://spuds0588.github.io/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/";
const expected = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const digest = (text) => createHash("sha256").update(text).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url, attempts = 1) {
  let last = { status: 0, body: "" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { "cache-control": "no-cache" }
      });
      last = { status: response.status, body: await response.text() };
      if (last.status === 200) return last;
    } catch (error) {
      last = { status: 0, body: "", error: error.message };
    }
    if (attempt < attempts) await sleep(5_000);
  }
  return last;
}

(async () => {
  const live = await get(BASE, Number(process.env.PRODUCTION_ATTEMPTS) || 6);
  const matches = live.status === 200 && live.body === expected;

  console.log(`live_url=${BASE}`);
  console.log(`live_status=${live.status}`);
  console.log(`live_sha256=${digest(live.body)}`);
  console.log(`repo_sha256=${digest(expected)}`);
  console.log(`served_page_matches_commit=${matches ? "yes" : "no"}`);

  if (!matches) {
    console.error("Served page is stale or diverged from index.html; re-run after Pages deploys.");
    process.exit(1);
  }

  const scripts = [...live.body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  console.log(`inline_scripts=${scripts.length}`);
  for (const [, attrs, body] of scripts) {
    if (/ld\+json/i.test(attrs)) {
      const data = JSON.parse(body);
      console.log(`json_ld_types=${data["@graph"].map((node) => node["@type"]).join(",")}`);
    } else {
      console.log("executable_script=present");
    }
  }

  const portal = await get(new URL("portal", BASE).href);
  console.log(`portal_status=${portal.status}`);
  if (portal.status === 200) {
    console.log("portal_route=served; persona endpoint verification needs the deployed invite flow");
  } else {
    console.log("portal_route=absent (the invite portal is served by the Lambda handler, not Pages)");
    console.log("persona_endpoint_execution=blocked: no deployed API");
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
