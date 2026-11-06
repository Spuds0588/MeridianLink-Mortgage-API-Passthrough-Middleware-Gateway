const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockMeridian } = require("../mock/meridian");
const { createMemoryStore } = require("../dev/memory-store");
const { createLocalRunner } = require("../dev/local-runner");
const { createMeridian } = require("../src/meridian");
const { createApp } = require("../src/app");
const { localEnv, INVITES, createDevGateway } = require("../dev/server");

const httpEvent = ({ method = "GET", path, query = null, body = null, apiKeyId = null, headers = {} }) => ({
  httpMethod: method,
  path,
  queryStringParameters: query,
  headers,
  body: body === null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  requestContext: { requestId: "request-1", identity: apiKeyId ? { apiKeyId } : {} }
});

async function setup(t, { lockOnWrite = 0, password = "demo" } = {}) {
  const mock = createMockMeridian({ lockOnWrite });
  const { url } = await mock.listen(0);
  const store = createMemoryStore();
  const meridian = createMeridian({ baseUrl: url, username: "demo", password });
  const app = createApp({ store, meridian, env: localEnv() });
  const runner = createLocalRunner({ store, meridian, retryDelayMs: 1 });
  t.after(() => mock.close());

  const call = (method, path, { body, apiKeyId, query } = {}) => app.handle(httpEvent({ method, path, body, apiKeyId, query }));
  const provision = (overrides = {}) =>
    call("POST", "/portal", {
      body: { tenantName: "First American Title", email: "dev@firstam.test", role: "title", code: INVITES.title, ...overrides }
    });
  const tenantKey = async (overrides) => {
    const res = await provision(overrides);
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    return { key: body.apiKey, apiKeyId: store.keyIdsByValue.get(body.apiKey), body };
  };
  const parse = (res) => JSON.parse(res.body);

  return { mock, store, meridian, app, runner, call, provision, tenantKey, parse };
}

test("GET /health is unauthenticated", async (t) => {
  const { call } = await setup(t);
  const res = await call("GET", "/health");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { status: "ok", system: "MeridianLinkGateway" });
});

test("portal landing requires an invite link and publishes the field cheat sheet", async (t) => {
  const { call } = await setup(t);
  const res = await call("GET", "/portal");
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  assert.match(res.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(res.headers["X-Frame-Options"], "DENY");
  assert.match(res.body, /Invite link required/);
  assert.match(res.body, /terms\.loanAmount/);
  assert.match(res.body, /fees\[\]\.amount/);
  assert.doesNotMatch(res.body, /admin token/i);
});

test("portal renders a persona-locked form for a valid invite and rejects the rest", async (t) => {
  const { call } = await setup(t);

  const good = await call("GET", "/portal", { query: { role: "title", code: INVITES.title } });
  assert.equal(good.statusCode, 200);
  assert.match(good.body, /Title \/ Settlement/);
  assert.match(good.body, /TITLE_VENDOR/);
  assert.match(good.body, /id="email"/);

  const badCode = await call("GET", "/portal", { query: { role: "title", code: "nope" } });
  assert.equal(badCode.statusCode, 403);
  assert.match(badCode.body, /invalid or has expired/i);

  const roleMismatch = await call("GET", "/portal", { query: { role: "broker", code: INVITES.title } });
  assert.equal(roleMismatch.statusCode, 403);

  const unknownRole = await call("GET", "/portal", { query: { role: "super_admin", code: INVITES.title } });
  assert.equal(unknownRole.statusCode, 403);
});

test("portal provisions a persona-locked key and never stores it in plaintext", async (t) => {
  const { tenantKey, store } = await setup(t);
  const { key, apiKeyId, body } = await tenantKey();

  assert.ok(key.startsWith("mlg_"));
  assert.equal(body.role, "title");
  assert.equal(body.persona, "TITLE_VENDOR");

  const tenant = await store.getTenant(apiKeyId);
  assert.equal(tenant.email, "dev@firstam.test");
  assert.equal(tenant.persona, "TITLE_VENDOR");
  assert.equal(tenant.apiKey, undefined);
  assert.equal(JSON.stringify(tenant).includes(key), false);
});

test("portal validates the invite, company name, email and JSON body", async (t) => {
  const { call } = await setup(t);

  assert.equal((await call("POST", "/portal", { body: { tenantName: "Acme", email: "dev@acme.test", role: "title", code: "wrong" } })).statusCode, 403);
  assert.equal((await call("POST", "/portal", { body: { tenantName: "Acme", email: "dev@acme.test", role: "broker", code: INVITES.title } })).statusCode, 403);
  assert.equal((await call("POST", "/portal", { body: { tenantName: "", email: "dev@acme.test", role: "title", code: INVITES.title } })).statusCode, 400);
  assert.equal((await call("POST", "/portal", { body: { tenantName: "Acme", email: "not-an-email", role: "title", code: INVITES.title } })).statusCode, 400);
  assert.equal((await call("POST", "/portal", { body: "{not-json" })).statusCode, 400);
});

test("portal fails closed when a role has no configured invite code", async (t) => {
  const mock = createMockMeridian();
  const { url } = await mock.listen(0);
  const store = createMemoryStore();
  const meridian = createMeridian({ baseUrl: url, username: "u", password: "p" });
  const app = createApp({ store, meridian, env: { INVITE_TITLE: undefined } });
  t.after(() => mock.close());

  const res = await app.handle(
    httpEvent({ method: "POST", path: "/portal", body: { tenantName: "Acme", email: "dev@acme.test", role: "title", code: INVITES.title } })
  );
  assert.equal(res.statusCode, 403);
});

test("title read is masked and never leaks NPI", async (t) => {
  const { call, tenantKey } = await setup(t);
  const { apiKeyId, key } = await tenantKey();

  const unauth = await call("GET", "/v1/loans/ML-998822");
  assert.equal(unauth.statusCode, 403);

  const res = await call("GET", "/v1/loans/ML-998822", { apiKeyId });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "private, max-age=15");
  const body = JSON.parse(res.body);
  assert.equal(body.loanId, "ML-998822");
  assert.equal(body.milestone, "Underwriting");
  assert.equal(body.property.city, "Irvine");
  assert.equal(body.fees.length, 2);
  assert.equal(body.borrower, undefined);
  assert.equal(res.body.includes("123-45-6789"), false);
  assert.equal(res.body.includes("742"), false);
  assert.equal(res.body.includes(key), false);
});

test("broker and appraisal personas get different masked shapes", async (t) => {
  const { call, tenantKey } = await setup(t);
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });
  const appraisal = await tenantKey({ role: "appraisal", code: INVITES.appraisal, tenantName: "Acme Appraisal", email: "amc@acme.test" });

  const brokerBody = JSON.parse((await call("GET", "/v1/loans/ML-998822", { apiKeyId: broker.apiKeyId })).body);
  assert.equal(brokerBody.borrower.name, "Dana Borrower");
  assert.equal(brokerBody.borrower.taxpayerIdentifier, undefined);
  assert.equal(brokerBody.borrower.creditScore, undefined);
  assert.equal(brokerBody.conditions.length, 2);
  assert.equal(brokerBody.lockStatus, "Locked");

  const amcBody = JSON.parse((await call("GET", "/v1/loans/ML-998822", { apiKeyId: appraisal.apiKeyId })).body);
  assert.equal(amcBody.borrower, undefined);
  assert.equal(amcBody.fees, undefined);
  assert.equal(amcBody.appraisalContact, "Acme Appraisal Co");
  assert.equal(amcBody.terms.loanType, "Conventional");
});

test("read maps upstream 404, 423 and unknown keys", async (t) => {
  const { call, tenantKey } = await setup(t);
  const { apiKeyId } = await tenantKey();

  assert.equal((await call("GET", "/v1/loans/ML-998822", { apiKeyId: "key_unknown" })).statusCode, 403);
  assert.equal((await call("GET", "/v1/loans/ML-404", { apiKeyId })).statusCode, 404);
  const locked = await call("GET", "/v1/loans/ML-LOCKED-1", { apiKeyId });
  assert.equal(locked.statusCode, 423);
  assert.equal(JSON.parse(locked.body).code, "FILE_LOCKED");
});

test("field schema is proxied, validated and cached per persona", async (t) => {
  const { call, tenantKey, mock } = await setup(t);
  const { apiKeyId } = await tenantKey();

  const res = await call("GET", "/v1/fields", { apiKeyId, query: { ids: "11,CX.TITLE.STATUS" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "private, max-age=300");
  const body = JSON.parse(res.body);
  assert.equal(body["11"].description, "Subject Property Address Line");
  assert.equal(body["CX.TITLE.STATUS"].type, "STRING");

  await call("GET", "/v1/fields", { apiKeyId, query: { ids: "11,CX.TITLE.STATUS" } });
  assert.equal(mock.state.fieldCalls, 1, "second lookup must hit the container cache");

  assert.equal((await call("GET", "/v1/fields", { apiKeyId })).statusCode, 400);
  assert.equal((await call("GET", "/v1/fields", { apiKeyId, query: { ids: "11;DROP" } })).statusCode, 400);
  const tooMany = Array.from({ length: 101 }, (_, index) => `F${index}`).join(",");
  assert.equal((await call("GET", "/v1/fields", { apiKeyId, query: { ids: tooMany } })).statusCode, 400);
  assert.equal((await call("GET", "/v1/fields", { query: { ids: "11" } })).statusCode, 403);
});

test("field schema maps upstream failures", async (t) => {
  const { call, tenantKey, mock } = await setup(t);
  const { apiKeyId } = await tenantKey();

  mock.state.fieldsFailure = 500;
  assert.equal((await call("GET", "/v1/fields", { apiKeyId, query: { ids: "11" } })).statusCode, 502);
});

test("PATCH fees enqueues a job and the worker completes it", async (t) => {
  const { call, runner, store, mock, tenantKey } = await setup(t);
  const { apiKeyId } = await tenantKey();

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", {
    apiKeyId,
    body: { fees: [{ feeType: "TitleLenderCoveragePremium", amount: 1350, paidTo: "First American" }] }
  });
  assert.equal(res.statusCode, 202);
  const accepted = JSON.parse(res.body);
  assert.equal(accepted.status, "ACCEPTED");
  assert.match(accepted.jobId, /^job_/);
  assert.equal(accepted.statusUrl, `/v1/jobs/${accepted.jobId}`);
  assert.equal(store.queue.length, 1);
  assert.match(store.queue[0].mismo, /<FeeType>TitleLenderCoveragePremium<\/FeeType>/);

  const pending = JSON.parse((await call("GET", accepted.statusUrl, { apiKeyId })).body);
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.fees, undefined, "job view must not echo fee payloads");

  await runner.drain();
  const done = JSON.parse((await call("GET", accepted.statusUrl, { apiKeyId })).body);
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.attempts, 1);
  assert.equal(done.error, null);
  assert.equal(mock.state.updates.length, 1);
  assert.match(mock.state.updates[0].body, /<FeeActualPaymentAmount>1350\.00<\/FeeActualPaymentAmount>/);
  const job = await store.getJob(accepted.jobId);
  assert.equal(job.fees, undefined);
});

test("write retries record-lock contention then completes", async (t) => {
  const { call, runner, mock, tenantKey } = await setup(t, { lockOnWrite: 2 });
  const { apiKeyId } = await tenantKey();

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", { apiKeyId, body: { fees: [{ feeType: "SettlementClosingFee", amount: 650 }] } });
  await runner.drain();

  const job = JSON.parse((await call("GET", `/v1/jobs/${JSON.parse(res.body).jobId}`, { apiKeyId })).body);
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.attempts, 3);
  assert.equal(mock.state.updates.length, 1);
});

test("write stops after the retry budget and fails the job", async (t) => {
  const { call, runner, tenantKey } = await setup(t, { lockOnWrite: 9 });
  const { apiKeyId } = await tenantKey();

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", { apiKeyId, body: { fees: [{ feeType: "SettlementClosingFee", amount: 650 }] } });
  await runner.drain();

  const job = JSON.parse((await call("GET", `/v1/jobs/${JSON.parse(res.body).jobId}`, { apiKeyId })).body);
  assert.equal(job.status, "FAILED");
  assert.equal(job.attempts, 5);
  assert.match(job.error, /423/);
});

test("write fails permanently on a non-retryable upstream status", async (t) => {
  const { call, runner, store, tenantKey } = await setup(t);
  const { apiKeyId } = await tenantKey();

  const res = await call("PATCH", "/v1/loans/ML-404/fees", { apiKeyId, body: { fees: [{ feeType: "SettlementClosingFee", amount: 1 }] } });
  await runner.drain();

  const job = JSON.parse((await call("GET", `/v1/jobs/${JSON.parse(res.body).jobId}`, { apiKeyId })).body);
  assert.equal(job.status, "FAILED");
  assert.equal(job.error, "upstream 404");
  assert.equal(store.queue.length, 0);
});

test("write validation rejects malformed payloads", async (t) => {
  const { call, tenantKey } = await setup(t);
  const { apiKeyId } = await tenantKey();
  const patch = (body) => call("PATCH", "/v1/loans/ML-998822/fees", { apiKeyId, body });

  assert.equal((await patch({})).statusCode, 400);
  assert.equal((await patch({ fees: [] })).statusCode, 400);
  assert.equal((await patch({ fees: [{ feeType: "", amount: 1 }] })).statusCode, 400);
  assert.equal((await patch({ fees: [{ feeType: "X", amount: "12" }] })).statusCode, 400);
  assert.equal((await patch({ fees: [{ feeType: "X", amount: -1 }] })).statusCode, 400);
  assert.equal((await call("PATCH", "/v1/loans/ML-998822/fees", { body: { fees: [{ feeType: "X", amount: 1 }] } })).statusCode, 403);
});

test("job status is scoped to the owning API key", async (t) => {
  const { call, runner, tenantKey } = await setup(t);
  const owner = await tenantKey();
  const rival = await tenantKey({ tenantName: "Rival Title", email: "dev@rival.test" });

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", { apiKeyId: owner.apiKeyId, body: { fees: [{ feeType: "SettlementClosingFee", amount: 600 }] } });
  await runner.drain();
  const jobId = JSON.parse(res.body).jobId;

  assert.equal((await call("GET", `/v1/jobs/${jobId}`, { apiKeyId: rival.apiKeyId })).statusCode, 404);
  assert.equal((await call("GET", `/v1/jobs/${jobId}`, { apiKeyId: owner.apiKeyId })).statusCode, 200);
  assert.equal((await call("GET", "/v1/jobs/job_missing", { apiKeyId: owner.apiKeyId })).statusCode, 404);
});

test("broker read exposes identity, property, terms and conditions but no 1003 detail", async (t) => {
  const { call, tenantKey } = await setup(t);
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });

  const body = JSON.parse((await call("GET", "/v1/loans/ML-998822", { apiKeyId: broker.apiKeyId })).body);
  assert.deepEqual(Object.keys(body).sort(), ["borrower", "conditions", "loanId", "lockStatus", "milestone", "property", "terms"]);
  assert.deepEqual(Object.keys(body.borrower).sort(), ["email", "name"]);
  assert.deepEqual(Object.keys(body.terms).sort(), ["estimatedClosingDate", "loanAmount", "loanType", "noteRate"]);
  assert.equal(body.conditions.length, 2);

  // Documented gap: the parser has no 1003 employment/income/assets/liabilities/declarations sections yet.
  for (const section of ["employment", "income", "assets", "liabilities", "declarations", "documents"]) {
    assert.equal(body[section], undefined, `${section} must stay absent until a real MISMO shape is contributed`);
  }
});

test("broker writes cover fees, conditions and documents; 1003 writes fail loudly", async (t) => {
  const { call, tenantKey } = await setup(t);
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });

  const loanPatch = await call("PATCH", "/v1/loans/ML-998822", { apiKeyId: broker.apiKeyId, body: { borrower: { name: "Dana Borrower" } } });
  assert.equal(loanPatch.statusCode, 501);
  assert.match(JSON.parse(loanPatch.body).error, /Only fee, condition, and document writes are supported/);

  assert.equal((await call("POST", "/v1/loans/ML-998822/documents", { apiKeyId: broker.apiKeyId, body: { name: "paystub.pdf" } })).statusCode, 400);
  assert.equal((await call("PATCH", "/v1/loans/ML-998822/conditions/1", { apiKeyId: broker.apiKeyId, body: { status: "Satisfied" } })).statusCode, 404);

  const fees = await call("PATCH", "/v1/loans/ML-998822/fees", {
    apiKeyId: broker.apiKeyId,
    body: { fees: [{ feeType: "BrokerCompensation", amount: 500 }] }
  });
  assert.equal(fees.statusCode, 202);
});

test("broker submits conditions through the FIFO queue", async (t) => {
  const { call, runner, store, mock, tenantKey } = await setup(t);
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });

  const res = await call("POST", "/v1/loans/ML-998822/conditions", {
    apiKeyId: broker.apiKeyId,
    body: { conditions: [{ description: "Updated title commitment", status: "Satisfied" }] }
  });
  assert.equal(res.statusCode, 202);
  assert.match(store.queue[0].mismo, /<ConditionStatus>Satisfied<\/ConditionStatus>/);

  await runner.drain();
  const job = JSON.parse((await call("GET", `/v1/jobs/${JSON.parse(res.body).jobId}`, { apiKeyId: broker.apiKeyId })).body);
  assert.equal(job.status, "COMPLETED");
  assert.match(mock.state.updates[0].body, /<ConditionDescription>Updated title commitment<\/ConditionDescription>/);
});

test("condition submission is broker-only and validated", async (t) => {
  const { call, tenantKey } = await setup(t);
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });
  const title = await tenantKey();
  const post = (apiKeyId, body) => call("POST", "/v1/loans/ML-998822/conditions", { apiKeyId, body });

  assert.equal((await post(title.apiKeyId, { conditions: [{ description: "X", status: "Open" }] })).statusCode, 403);
  assert.equal((await post(broker.apiKeyId, {})).statusCode, 400);
  assert.equal((await post(broker.apiKeyId, { conditions: [] })).statusCode, 400);
  assert.equal((await post(broker.apiKeyId, { conditions: [{ description: "", status: "Open" }] })).statusCode, 400);
  assert.equal((await post(broker.apiKeyId, { conditions: [{ description: "X", status: 7 }] })).statusCode, 400);
  assert.equal((await call("GET", "/v1/loans/ML-998822/conditions", { apiKeyId: broker.apiKeyId })).statusCode, 405);
});

const PDF = Buffer.from("%PDF-1.4\npaystub\n%%EOF").toString("base64");

test("broker uploads a PDF through the FIFO queue and the worker reaches EDocs", async (t) => {
  const { call, runner, store, mock, tenantKey } = await setup(t);
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });

  const res = await call("POST", "/v1/loans/ML-998822/documents", {
    apiKeyId: broker.apiKeyId,
    body: { documentType: "Paystub", notes: "November", contentBase64: PDF }
  });
  assert.equal(res.statusCode, 202);
  const accepted = JSON.parse(res.body);
  assert.match(accepted.jobId, /^job_/);
  assert.equal(accepted.statusUrl, `/v1/jobs/${accepted.jobId}`);
  assert.equal(store.queue[0].doc.documentType, "Paystub");
  assert.equal(store.queue[0].doc.contentBase64, PDF);
  assert.equal(store.queue[0].mismo, undefined);
  assert.equal((await store.getJob(accepted.jobId)).doc, undefined, "the job record must not persist the PDF");

  const pending = JSON.parse((await call("GET", accepted.statusUrl, { apiKeyId: broker.apiKeyId })).body);
  assert.equal(pending.status, "PENDING");

  await runner.drain();
  const job = JSON.parse((await call("GET", accepted.statusUrl, { apiKeyId: broker.apiKeyId })).body);
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.attempts, 1);
  assert.deepEqual(mock.state.edocsRequests, ["UploadPDFDocument"]);
  assert.equal(mock.state.documents.get("ML-998822")[0].contentBase64, PDF);
  assert.equal(mock.state.ticketCalls, 1);
});

test("document list and download round-trip through EDocs with ticket reuse", async (t) => {
  const { call, runner, mock, tenantKey } = await setup(t);
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });
  const upload = async (documentType) => {
    const res = await call("POST", "/v1/loans/ML-998822/documents", { apiKeyId: broker.apiKeyId, body: { documentType, contentBase64: PDF } });
    assert.equal(res.statusCode, 202);
    await runner.drain();
  };

  await upload("Paystub");
  await upload("W2");
  assert.equal(mock.state.ticketCalls, 1, "the auth ticket must be cached across writes");

  const list = await call("GET", "/v1/loans/ML-998822/documents", { apiKeyId: broker.apiKeyId });
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers["Cache-Control"], "private, max-age=15");
  const { documents } = JSON.parse(list.body);
  assert.equal(documents.length, 2);
  assert.equal(documents[0].documentType, "Paystub");
  assert.equal(documents[1].documentType, "W2");
  assert.ok(documents[0].id);

  const download = await call("GET", `/v1/loans/ML-998822/documents/${documents[0].id}`, { apiKeyId: broker.apiKeyId });
  assert.equal(download.statusCode, 200);
  assert.equal(download.headers["Cache-Control"], "no-store");
  const body = JSON.parse(download.body);
  assert.equal(body.documentId, documents[0].id);
  assert.equal(body.contentType, "application/pdf");
  assert.equal(body.contentBase64, PDF);
  assert.equal(mock.state.ticketCalls, 1, "reads must reuse the cached ticket too");
});

test("document routes are broker-only and reject bad payloads", async (t) => {
  const { call, tenantKey, store } = await setup(t);
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });
  const title = await tenantKey();
  const upload = (apiKeyId, body) => call("POST", "/v1/loans/ML-998822/documents", { apiKeyId, body });

  assert.equal((await upload(title.apiKeyId, { documentType: "Paystub", contentBase64: PDF })).statusCode, 403);
  assert.equal((await upload(broker.apiKeyId, { documentType: "Paystub" })).statusCode, 400);
  assert.equal((await upload(broker.apiKeyId, { documentType: "", contentBase64: PDF })).statusCode, 400);
  assert.equal((await upload(broker.apiKeyId, { documentType: "Paystub", notes: "x".repeat(501), contentBase64: PDF })).statusCode, 400);
  assert.equal((await upload(broker.apiKeyId, { documentType: "Paystub", contentBase64: "not base64!!" })).statusCode, 400);
  assert.equal(
    (await upload(broker.apiKeyId, { documentType: "Paystub", contentBase64: Buffer.from("plain text").toString("base64") })).statusCode,
    415
  );
  const oversized = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(180001)]).toString("base64");
  const tooBig = await upload(broker.apiKeyId, { documentType: "Paystub", contentBase64: oversized });
  assert.equal(tooBig.statusCode, 413);
  assert.equal(JSON.parse(tooBig.body).maxBytes, 180000);
  assert.equal(store.queue.length, 0, "a rejected upload must not enqueue a job");

  assert.equal((await call("GET", "/v1/loans/ML-998822/documents")).statusCode, 403);
  assert.equal((await call("GET", "/v1/loans/ML-998822/documents", { apiKeyId: title.apiKeyId })).statusCode, 403);
  assert.equal((await call("GET", "/v1/loans/ML-998822/documents/doc_1", { apiKeyId: title.apiKeyId })).statusCode, 403);
  assert.equal((await call("PUT", "/v1/loans/ML-998822/documents", { apiKeyId: broker.apiKeyId })).statusCode, 405);
});

test("document reads fail closed when EDocs rejects the ticket", async (t) => {
  const { call, tenantKey } = await setup(t, { password: "wrong" });
  const broker = await tenantKey({ role: "broker", code: INVITES.broker, tenantName: "Acme Brokers", email: "dev@acme.test" });

  const res = await call("GET", "/v1/loans/ML-998822/documents", { apiKeyId: broker.apiKeyId });
  assert.equal(res.statusCode, 502);
  assert.match(JSON.parse(res.body).error, /document request failed/i);
});

test("appraisal persona cannot write fees", async (t) => {
  const { call, tenantKey, store } = await setup(t);
  const amc = await tenantKey({ role: "appraisal", code: INVITES.appraisal, tenantName: "Acme Appraisal", email: "amc@acme.test" });

  const res = await call("PATCH", "/v1/loans/ML-998822/fees", {
    apiKeyId: amc.apiKeyId,
    body: { fees: [{ feeType: "AppraisalFee", amount: 450 }] }
  });
  assert.equal(res.statusCode, 403);
  assert.match(JSON.parse(res.body).error, /cannot write fees/);
  assert.equal(store.queue.length, 0, "a rejected write must not enqueue a job");
});

test("unknown routes and wrong methods are rejected", async (t) => {
  const { call } = await setup(t);
  assert.equal((await call("GET", "/v1/nope")).statusCode, 404);
  assert.equal((await call("DELETE", "/v1/loans/ML-1")).statusCode, 405);
  assert.equal((await call("POST", "/v1/loans/ML-1")).statusCode, 405);
  assert.equal((await call("PUT", "/portal")).statusCode, 405);
  assert.equal((await call("POST", "/v1/fields")).statusCode, 405);
});

test("local HTTP stack serves health, invite portal, masked read and an async write", async (t) => {
  const gateway = await createDevGateway({ port: 0 });
  t.after(() => gateway.close());

  const health = await fetch(`${gateway.url}/health`);
  assert.equal(health.status, 200);

  const portal = await fetch(`${gateway.url}/portal?role=title&code=${INVITES.title}`);
  assert.equal(portal.status, 200);
  assert.match(await portal.text(), /Generate API key/);

  const provisioned = await fetch(`${gateway.url}/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantName: "First American Title", email: "dev@firstam.test", role: "title", code: INVITES.title })
  });
  assert.equal(provisioned.status, 200);
  const { apiKey } = await provisioned.json();

  const read = await fetch(`${gateway.url}/v1/loans/ML-998822`, { headers: { "x-api-key": apiKey } });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).property.state, "CA");

  const write = await fetch(`${gateway.url}/v1/loans/ML-998822/fees`, {
    method: "PATCH",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ fees: [{ feeType: "TitleLenderCoveragePremium", amount: 1400 }] })
  });
  assert.equal(write.status, 202);
  const { statusUrl } = await write.json();

  let job;
  for (let i = 0; i < 100; i += 1) {
    job = await (await fetch(`${gateway.url}${statusUrl}`, { headers: { "x-api-key": apiKey } })).json();
    if (job.status === "COMPLETED") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(job.status, "COMPLETED");
});
