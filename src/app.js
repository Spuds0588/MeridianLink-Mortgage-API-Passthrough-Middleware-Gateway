/** Vendor-facing routes. Shaped like an API Gateway REST proxy event so handlers are deployment-portable. */
const crypto = require("node:crypto");
const { log } = require("./log");
const { parseLoan } = require("./mismo");
const { mask, ALLOWLISTS } = require("./mask");
const { renderPortal } = require("./portal");

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body)
});
const html = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "text/html; charset=utf-8" }, body });

function createApp({ store, queue, meridian }) {
  // API Gateway injects the key id; local callers send the raw key header.
  const tenantOf = (event) => {
    const apiKeyId = event.requestContext?.identity?.apiKeyId;
    const raw = event.headers?.["x-api-key"] ?? event.headers?.["X-Api-Key"];
    return store.tenantFor(apiKeyId) ?? store.tenantFor(raw);
  };

  async function readLoan(event) {
    const tenant = tenantOf(event);
    if (!tenant) return json(403, { error: "Unauthorized API key" });

    const loanId = event.pathParameters?.id;
    if (!loanId) return json(400, { error: "Missing loanId path parameter" });

    let upstream;
    try {
      upstream = await meridian.getLoan(loanId);
    } catch (err) {
      log("ERROR", "MERIDIANLINK_UNREACHABLE", { loanId, message: err.message });
      return json(502, { error: "Upstream MeridianLink unreachable" });
    }
    log("INFO", "MERIDIANLINK_RESPONSE_RECEIVED", { loanId, status: upstream.status });
    if (upstream.status === 404) return json(404, { error: "Loan not found" });
    if (upstream.status === 423) return json(423, { error: "Loan record locked upstream, retry shortly" });
    if (upstream.status >= 300) return json(502, { error: "Upstream MeridianLink error", status: upstream.status });

    const masked = mask(parseLoan(upstream.body), tenant.role);
    if (!masked) return json(403, { error: `Role ${tenant.role} has no schema allowlist` });
    log("INFO", "SCHEMA_MASKING_APPLIED", { loanId, role: tenant.role });
    return json(200, masked, { "Cache-Control": "private, max-age=15" });
  }

  function enqueueWrite(event) {
    const tenant = tenantOf(event);
    if (!tenant) return json(403, { error: "Unauthorized API key" });

    const loanId = event.pathParameters?.id;
    if (!loanId) return json(400, { error: "Missing loanId path parameter" });

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const fees = body.fees;
    if (!Array.isArray(fees) || fees.length === 0 || fees.length > 100) {
      return json(400, { error: "fees must be a non-empty array of at most 100 items" });
    }
    const invalid = fees.some((fee) => typeof fee?.feeType !== "string" || !fee.feeType.trim() || !Number.isFinite(fee.amount) || fee.amount < 0);
    if (invalid) return json(400, { error: "Each fee requires feeType (string) and amount (number >= 0)" });

    const job = store.saveJob({
      jobId: `job-${crypto.randomUUID()}`,
      loanId,
      tenantName: tenant.tenantName,
      status: "PENDING",
      attempts: 0,
      updatedAt: new Date().toISOString(),
      error: null,
      fees
    });
    queue.enqueue(job);
    log("INFO", "WRITE_JOB_ENQUEUED", { jobId: job.jobId, loanId, tenantName: tenant.tenantName, feeCount: fees.length });

    return json(202, { status: "ACCEPTED", jobId: job.jobId, loanId, statusUrl: `/v1/jobs/${job.jobId}` });
  }

  function jobStatus(event) {
    const tenant = tenantOf(event);
    if (!tenant) return json(403, { error: "Unauthorized API key" });

    const job = store.getJob(event.pathParameters?.id);
    if (!job) return json(404, { error: "Job not found" });
    if (job.tenantName !== tenant.tenantName) return json(403, { error: "Job belongs to another tenant" });

    const { fees, ...view } = job;
    return json(200, view);
  }

  async function fields(event) {
    const tenant = tenantOf(event);
    if (!tenant) return json(403, { error: "Unauthorized API key" });

    const ids = (event.queryStringParameters?.ids || "").split(",").map((id) => id.trim()).filter(Boolean);
    if (!ids.length) return json(400, { error: "ids query parameter required, e.g. ?ids=11,646" });

    try {
      const upstream = await meridian.getFields(ids);
      log("INFO", "FIELD_SCHEMA_LOOKUP", { count: ids.length, status: upstream.status });
      return upstream.status === 200 ? json(200, JSON.parse(upstream.body)) : json(502, { error: "Upstream MeridianLink error", status: upstream.status });
    } catch (err) {
      log("ERROR", "MERIDIANLINK_UNREACHABLE", { action: "FIELDS", message: err.message });
      return json(502, { error: "Upstream MeridianLink unreachable" });
    }
  }

  function provision(event) {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const tenantName = String(body.tenantName || "").trim();
    const role = String(body.role || "").trim().toUpperCase();
    if (!tenantName) return json(400, { error: "tenantName is required" });
    if (!ALLOWLISTS[role]) return json(400, { error: `role must be one of ${Object.keys(ALLOWLISTS).join(", ")}` });

    const tenant = store.addTenant({
      apiKeyId: `key_${crypto.randomBytes(8).toString("hex")}`,
      apiKey: `mlg_${crypto.randomBytes(24).toString("base64url")}`,
      tenantName,
      role,
      status: "ACTIVE",
      createdAt: new Date().toISOString()
    });
    log("INFO", "PARTNER_PROVISIONED", { tenantName, role, apiKeyId: tenant.apiKeyId });

    return json(200, {
      message: "Tenant provisioned successfully",
      apiKey: tenant.apiKey,
      tenantName,
      role,
      example: [
        `curl "$GATEWAY/v1/loans/ML-998822" -H "x-api-key: ${tenant.apiKey}"`,
        `curl -X PATCH "$GATEWAY/v1/loans/ML-998822/fees" -H "x-api-key: ${tenant.apiKey}" -H "Content-Type: application/json" \\`,
        `  -d '{"fees":[{"feeType":"TitleLenderCoveragePremium","amount":1350}]}'`
      ].join("\n")
    });
  }

  async function handle(event) {
    const method = (event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
    const path = event.path || event.rawPath || "/";
    log("INFO", "REQUEST_RECEIVED", { method, path });

    try {
      if (path === "/health" && method === "GET") return json(200, { status: "ok", system: "MeridianLinkGateway" });
      if (path === "/portal") return method === "POST" ? provision(event) : html(200, renderPortal());

      const withLoanId = (match, next) => {
        event.pathParameters = { ...event.pathParameters, id: decodeURIComponent(match[1]) };
        return next(event);
      };

      let match;
      if ((match = /^\/v1\/loans\/([^/]+)\/fees$/.exec(path))) {
        return method === "PATCH" ? withLoanId(match, enqueueWrite) : json(405, { error: "Method not allowed" });
      }
      if ((match = /^\/v1\/loans\/([^/]+)$/.exec(path))) {
        return method === "GET" ? withLoanId(match, readLoan) : method === "PATCH" ? withLoanId(match, enqueueWrite) : json(405, { error: "Method not allowed" });
      }
      if ((match = /^\/v1\/jobs\/([^/]+)$/.exec(path))) {
        return method === "GET" ? withLoanId(match, jobStatus) : json(405, { error: "Method not allowed" });
      }
      if (path === "/v1/fields") {
        return method === "GET" ? await fields(event) : json(405, { error: "Method not allowed" });
      }
      return json(404, { error: "Not found" });
    } catch (err) {
      log("ERROR", "REQUEST_EXCEPTION", { method, path, message: err.message });
      return json(500, { error: "Internal Gateway Error" });
    }
  }

  return { handle };
}

module.exports = { createApp };
