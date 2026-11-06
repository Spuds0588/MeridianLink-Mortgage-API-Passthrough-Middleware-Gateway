const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockMeridian } = require("../mock/meridian");
const { createStore } = require("../src/store");
const { createMeridian } = require("../src/meridian");
const { createQueue } = require("../src/queue");
const { createApp } = require("../src/app");
const { createServer } = require("../src/server");

async function setup(t, { lockOnWrite = 0, maxAttempts = 5 } = {}) {
  const mock = createMockMeridian({ lockOnWrite });
  const { url } = await mock.listen(0);
  const store = createStore();
  const meridian = createMeridian({ baseUrl: url, username: "user", password: "pass" });
  const queue = createQueue({ meridian, store, maxAttempts, retryDelayMs: 10 });
  const app = createApp({ store, queue, meridian });
  t.after(() => mock.close());

  const call = (method, path, { body, key, query } = {}) =>
    app.handle({
      httpMethod: method,
      path,
      queryStringParameters: query,
      headers: key ? { "x-api-key": key } : {},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  const provision = async (tenantName, role) => JSON.parse((await call("POST", "/portal", { body: { tenantName, role } })).body);
  return { mock, store, queue, app, call, provision };
}

test("portal issues a key; title read is masked and never leaks NPI", async (t) => {
  const { call, provision } = await setup(t);
  const tenant = await provision("First American Title", "TITLE_VENDOR");
  assert.match(tenant.apiKey, /^mlg_/);
  assert.match(tenant.example, /x-api-key: mlg_/);

  const res = await call("GET", "/v1/loans/ML-998822", { key: tenant.apiKey });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "private, max-age=15");
  const body = JSON.parse(res.body);
  assert.equal(body.loanId, "ML-998822");
  assert.equal(body.property.city, "Irvine");
  assert.equal(body.terms.loanAmount, 450000);
  assert.equal(body.fees.length, 2);
  assert.equal(body.borrower, undefined);
  assert.equal(res.body.includes("123-45-6789"), false);
});

test("broker persona sees borrower identity but not SSN or credit score", async (t) => {
  const { call, provision } = await setup(t);
  const tenant = await provision("Acme Mortgage Brokers", "TPO_BROKER");
  const res = await call("GET", "/v1/loans/ML-998822", { key: tenant.apiKey });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.borrower.name, "Dana Borrower");
  assert.equal(body.borrower.taxpayerIdentifier, undefined);
  assert.equal(body.borrower.creditScore, undefined);
  assert.equal(body.conditions.length, 2);
});

test("read requires a valid key and maps upstream 404/423", async (t) => {
  const { call, provision } = await setup(t);
  assert.equal((await call("GET", "/v1/loans/ML-998822")).statusCode, 403);
  assert.equal((await call("GET", "/v1/loans/ML-998822", { key: "mlg_nope" })).statusCode, 403);

  const tenant = await provision("Title Co", "TITLE_VENDOR");
  const missing = await call("GET", "/v1/loans/ML-404", { key: tenant.apiKey });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(JSON.parse(missing.body), { error: "Loan not found" });

  const locked = await call("GET", "/v1/loans/ML-LOCKED-1", { key: tenant.apiKey });
  assert.equal(locked.statusCode, 423);
});

test("PATCH fees returns 202 and the worker completes the job", async (t) => {
  const { call, queue, mock, provision } = await setup(t);
  const tenant = await provision("Title Co", "TITLE_VENDOR");

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", {
    key: tenant.apiKey,
    body: { fees: [{ feeType: "TitleLenderCoveragePremium", amount: 1350, paidTo: "First American" }] }
  });
  assert.equal(res.statusCode, 202);
  const accepted = JSON.parse(res.body);
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.loanId, "ML-998822");
  assert.equal(accepted.statusUrl, `/v1/jobs/${accepted.jobId}`);

  await queue.idle();
  const job = JSON.parse((await call("GET", accepted.statusUrl, { key: tenant.apiKey })).body);
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.attempts, 1);
  assert.equal(job.error, null);
  assert.equal(job.fees, undefined, "job view must not echo fee payloads");
  assert.equal(mock.state.updates.length, 1);
  assert.match(mock.state.updates[0].body, /<FeeActualPaymentAmount>1350\.00<\/FeeActualPaymentAmount>/);
});

test("write retries through record-lock contention", async (t) => {
  const { call, queue, mock, provision } = await setup(t, { lockOnWrite: 2 });
  const tenant = await provision("Title Co", "TITLE_VENDOR");

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", { key: tenant.apiKey, body: { fees: [{ feeType: "SettlementClosingFee", amount: 650 }] } });
  await queue.idle();

  const job = JSON.parse((await call("GET", `/v1/jobs/${JSON.parse(res.body).jobId}`, { key: tenant.apiKey })).body);
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.attempts, 3);
  assert.equal(mock.state.updates.length, 1);
});

test("exhausted retries end FAILED with the upstream reason", async (t) => {
  const { call, queue, provision } = await setup(t, { lockOnWrite: 9, maxAttempts: 3 });
  const tenant = await provision("Title Co", "TITLE_VENDOR");

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", { key: tenant.apiKey, body: { fees: [{ feeType: "SettlementClosingFee", amount: 650 }] } });
  await queue.idle();

  const job = JSON.parse((await call("GET", `/v1/jobs/${JSON.parse(res.body).jobId}`, { key: tenant.apiKey })).body);
  assert.equal(job.status, "FAILED");
  assert.equal(job.attempts, 3);
  assert.equal(job.error, "upstream 423");
});

test("write validation rejects malformed payloads", async (t) => {
  const { call, provision } = await setup(t);
  const tenant = await provision("Title Co", "TITLE_VENDOR");

  assert.equal((await call("PATCH", "/v1/loans/ML-998822/fees", { key: tenant.apiKey, body: {} })).statusCode, 400);
  assert.equal((await call("PATCH", "/v1/loans/ML-998822/fees", { key: tenant.apiKey, body: { fees: [] } })).statusCode, 400);
  assert.equal((await call("PATCH", "/v1/loans/ML-998822/fees", { key: tenant.apiKey, body: { fees: [{ feeType: "", amount: 1 }] } })).statusCode, 400);
  assert.equal((await call("PATCH", "/v1/loans/ML-998822/fees", { key: tenant.apiKey, body: { fees: [{ feeType: "X", amount: "12" }] } })).statusCode, 400);
  assert.equal((await call("PATCH", "/v1/loans/ML-998822/fees", { body: { fees: [{ feeType: "X", amount: 1 }] } })).statusCode, 403);
});

test("jobs are private to the tenant that created them", async (t) => {
  const { call, queue, provision } = await setup(t);
  const owner = await provision("Owner Title", "TITLE_VENDOR");
  const rival = await provision("Rival Title", "TITLE_VENDOR");

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", { key: owner.apiKey, body: { fees: [{ feeType: "SettlementClosingFee", amount: 600 }] } });
  await queue.idle();
  const jobId = JSON.parse(res.body).jobId;

  assert.equal((await call("GET", `/v1/jobs/${jobId}`, { key: rival.apiKey })).statusCode, 403);
  assert.equal((await call("GET", `/v1/jobs/${jobId}`, { key: owner.apiKey })).statusCode, 200);
  assert.equal((await call("GET", "/v1/jobs/job-missing", { key: owner.apiKey })).statusCode, 404);
});

test("field dictionary is proxied from the source of truth", async (t) => {
  const { call, provision } = await setup(t);
  const tenant = await provision("Title Co", "TITLE_VENDOR");

  const res = await call("GET", "/v1/fields", { key: tenant.apiKey, query: { ids: "11,CX.TITLE.STATUS" } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body)["11"].description, "Subject Property Address Line");
  assert.equal(JSON.parse(res.body)["CX.TITLE.STATUS"].type, "STRING");

  assert.equal((await call("GET", "/v1/fields", { key: tenant.apiKey })).statusCode, 400);
  assert.equal((await call("GET", "/v1/fields", { query: { ids: "11" } })).statusCode, 403);
});

test("portal rejects bad provisioning input and unknown routes", async (t) => {
  const { call } = await setup(t);
  assert.equal((await call("POST", "/portal", { body: {} })).statusCode, 400);
  assert.equal((await call("POST", "/portal", { body: { tenantName: "X", role: "SUPER_ADMIN" } })).statusCode, 400);
  assert.equal((await call("GET", "/v1/nope")).statusCode, 404);
  assert.equal((await call("DELETE", "/v1/loans/ML-1")).statusCode, 405);
});

test("local HTTP server serves health, portal and a full read/write flow", async (t) => {
  const { app } = await setup(t);
  const server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const portal = await fetch(`${base}/portal`);
  assert.equal(portal.status, 200);
  assert.match(portal.headers.get("content-type"), /text\/html/);
  assert.match(await portal.text(), /Provision API Access/);

  const provisioned = await fetch(`${base}/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantName: "First American Title", role: "TITLE_VENDOR" })
  });
  const { apiKey } = await provisioned.json();

  const read = await fetch(`${base}/v1/loans/ML-998822`, { headers: { "x-api-key": apiKey } });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).property.state, "CA");

  const write = await fetch(`${base}/v1/loans/ML-998822/fees`, {
    method: "PATCH",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ fees: [{ feeType: "TitleLenderCoveragePremium", amount: 1400 }] })
  });
  assert.equal(write.status, 202);
  const { jobId, statusUrl } = await write.json();
  assert.ok(jobId.startsWith("job-"));

  let job;
  for (let i = 0; i < 50; i += 1) {
    job = await (await fetch(`${base}${statusUrl}`, { headers: { "x-api-key": apiKey } })).json();
    if (job.status === "COMPLETED") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.attempts, 1);
});
