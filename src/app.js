/** Vendor-facing routes. API-Gateway-shaped events; tenant identity comes only from apiKeyId. */
const { randomUUID } = require("node:crypto");
const { log } = require("./log");
const { mask } = require("./mask");
const { parseLoan, feesToXml, conditionsToXml } = require("./mismo");
const { parseDocumentList, parseDocumentContent } = require("./edocs");
const { roleFor, safeEqual } = require("./roles");
const { renderPortal } = require("./portal");

const MAX_IDS = 100;
const FIELD_ID = /^[A-Za-z0-9._-]+$/;
const SCHEMA_TTL_MS = 5 * 60_000;
const SCHEMA_CACHE_MAX = 200;
const JOB_TTL_SECONDS = 30 * 24 * 60 * 60;
// SQS caps a message at 256 KiB; base64 plus JSON overhead leaves room for a
// ~180 KB PDF. Larger files need an S3 staging hop, not a silent truncation.
const MAX_DOCUMENT_BYTES = 180_000;

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  body: JSON.stringify(body)
});
const error = (statusCode, message, extra = {}) => json(statusCode, { error: message, ...extra });
const html = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY"
  },
  body
});

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseIds = (raw) => {
  const ids = [...new Set(String(raw || "").split(",").map((id) => id.trim()).filter(Boolean))];
  return ids.length && ids.length <= MAX_IDS && ids.every((id) => FIELD_ID.test(id)) ? ids : null;
};

const validFees = (fees) =>
  Array.isArray(fees) &&
  fees.length > 0 &&
  fees.length <= MAX_IDS &&
  fees.every(
    (fee) =>
      typeof fee?.feeType === "string" &&
      fee.feeType.trim().length > 0 &&
      fee.feeType.length <= 100 &&
      Number.isFinite(fee.amount) &&
      fee.amount >= 0 &&
      (fee.paidTo === undefined || (typeof fee.paidTo === "string" && fee.paidTo.length <= 200))
  );

const validConditions = (conditions) =>
  Array.isArray(conditions) &&
  conditions.length > 0 &&
  conditions.length <= MAX_IDS &&
  conditions.every(
    (condition) =>
      typeof condition?.description === "string" &&
      condition.description.trim().length > 0 &&
      condition.description.length <= 200 &&
      typeof condition?.status === "string" &&
      condition.status.trim().length > 0 &&
      condition.status.length <= 50
  );

const parsePdf = (content) => {
  if (typeof content !== "string" || !content.trim()) return { error: [400, "contentBase64 is required"] };
  const clean = content.replace(/\s+/g, "");
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return { error: [400, "contentBase64 must be valid base64"] };
  const bytes = Buffer.from(clean, "base64");
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return { error: [415, "Only PDF content is supported"] };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { error: [413, `Document exceeds ${MAX_DOCUMENT_BYTES} bytes (SQS message limit)`, { maxBytes: MAX_DOCUMENT_BYTES }] };
  return { content: clean };
};

function createApp({ store, meridian, env = process.env, now = () => Date.now() }) {
  if (!store) throw new Error("createApp requires a store");

  // Definitions are public-ish but still tenant-scoped: cache per persona + field set only.
  const schemaCache = new Map();
  const tenantFor = async (apiKeyId) => (apiKeyId ? (await store.getTenant(apiKeyId)) || null : null);

  async function fields(event, apiKeyId) {
    const tenant = await tenantFor(apiKeyId);
    if (!tenant) return error(403, "Unauthorized tenant mapping");

    const ids = parseIds(event.queryStringParameters?.ids);
    if (!ids) return error(400, "ids is required (comma-separated, max 100)");

    const cacheKey = `${tenant.persona}|${ids.join(",")}`;
    const cached = schemaCache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      log("INFO", "FIELD_SCHEMA_CACHE_HIT", { count: ids.length });
      return json(200, cached.body, { "Cache-Control": "private, max-age=300" });
    }

    let upstream;
    try {
      upstream = await meridian.getFields(ids);
    } catch (err) {
      log("ERROR", "MERIDIANLINK_UNREACHABLE", { path: "/v1/fields", message: err.message });
      return error(502, "MeridianLink field schema unavailable");
    }

    if (upstream.status === 401 || upstream.status === 403) {
      log("ERROR", "MERIDIANLINK_REJECTED_CREDENTIALS", { path: "/v1/fields", status: upstream.status });
      return error(502, "MeridianLink rejected gateway credentials");
    }
    if (upstream.status !== 200) {
      log("ERROR", "FIELD_SCHEMA_FAILED", { status: upstream.status });
      return error(502, "MeridianLink field schema unavailable");
    }

    let definitions;
    try {
      definitions = JSON.parse(upstream.body);
    } catch {
      return error(502, "Invalid MeridianLink response");
    }
    if (!definitions || typeof definitions !== "object" || Object.keys(definitions).length === 0) {
      return error(404, "No field definitions found");
    }

    schemaCache.set(cacheKey, { body: definitions, expiresAt: now() + SCHEMA_TTL_MS });
    if (schemaCache.size > SCHEMA_CACHE_MAX) schemaCache.clear();
    log("INFO", "FIELD_SCHEMA_LOOKUP", { count: Object.keys(definitions).length, requested: ids.length });
    return json(200, definitions, { "Cache-Control": "private, max-age=300" });
  }

  async function readLoan(event, apiKeyId, loanId) {
    const tenant = await tenantFor(apiKeyId);
    if (!tenant) return error(403, "Unauthorized tenant mapping");

    let upstream;
    try {
      upstream = await meridian.getLoan(loanId);
    } catch (err) {
      log("ERROR", "MERIDIANLINK_READ_FAILED", { loanId, message: err.message });
      return error(err.name === "TimeoutError" ? 504 : 502, "MeridianLink request failed");
    }

    log("INFO", "MERIDIANLINK_READ_COMPLETE", { loanId, status: upstream.status });
    if (upstream.status === 423) return error(423, "Loan is locked by MeridianLink", { code: "FILE_LOCKED" });
    if (upstream.status === 404) return error(404, "Loan not found");
    if (upstream.status === 429) return error(429, "MeridianLink rate limit reached");
    if (upstream.status === 401 || upstream.status === 403) return error(502, "MeridianLink rejected gateway credentials");
    if (upstream.status >= 500) return error(502, "MeridianLink unavailable");
    if (upstream.status >= 300) return error(400, "MeridianLink rejected the request", { upstreamStatus: upstream.status });

    const masked = mask(parseLoan(upstream.body), tenant.persona);
    if (!masked) return error(403, `Persona ${tenant.persona} has no schema allowlist`);
    log("INFO", "SCHEMA_MASKING_APPLIED", { loanId, persona: tenant.persona });
    return json(200, masked, { "Cache-Control": "private, max-age=15" });
  }

  async function enqueueWrite(event, apiKeyId, loanId, kind = "fees") {
    const tenant = await tenantFor(apiKeyId);
    if (!tenant) return error(403, "Unauthorized tenant mapping");
    const allowed =
      kind === "fees"
        ? ["TITLE_VENDOR", "TPO_BROKER"].includes(tenant.persona)
        : tenant.persona === "TPO_BROKER";
    const operation = { fees: "write fees", conditions: "submit conditions", documents: "upload documents" }[kind];
    if (!allowed) return error(403, `Persona cannot ${operation}`);

    let payload;
    try {
      payload = JSON.parse(event.body || "");
    } catch {
      return error(400, "Invalid JSON body");
    }

    let message;
    if (kind === "documents") {
      if (typeof payload?.documentType !== "string" || !payload.documentType.trim() || payload.documentType.length > 100) {
        return error(400, "documentType is required (max 100 chars)");
      }
      if (payload.notes !== undefined && (typeof payload.notes !== "string" || payload.notes.length > 500)) {
        return error(400, "notes must be a string (max 500 chars)");
      }
      const pdf = parsePdf(payload?.contentBase64);
      if (pdf.error) return error(pdf.error[0], pdf.error[1], pdf.error[2]);
      message = { doc: { documentType: payload.documentType.trim(), notes: String(payload.notes || "").trim(), contentBase64: pdf.content } };
    } else {
      const mismo =
        kind === "conditions"
          ? validConditions(payload?.conditions) && conditionsToXml(loanId, payload.conditions)
          : validFees(payload?.fees) && feesToXml(loanId, payload.fees);
      if (!mismo) return error(400, `Body must contain a non-empty ${kind} array (max 100)`);
      message = { mismo };
    }

    const createdAt = new Date(now()).toISOString();
    const job = {
      jobId: `job_${randomUUID()}`,
      loanId,
      apiKeyId,
      tenantName: tenant.tenantName,
      persona: tenant.persona,
      status: "PENDING",
      attempts: 0,
      error: null,
      createdAt,
      updatedAt: createdAt,
      ttl: Math.floor(now() / 1000) + JOB_TTL_SECONDS
    };
    await store.putJob(job);

    try {
      await store.enqueueWrite({ jobId: job.jobId, loanId, ...message });
    } catch (err) {
      await store.putJob({ ...job, status: "FAILED", error: "Queue unavailable", updatedAt: new Date(now()).toISOString() });
      log("ERROR", "WRITE_ENQUEUE_FAILED", { jobId: job.jobId, loanId, message: err.message });
      return error(503, "Write queue unavailable");
    }

    log("INFO", "WRITE_ENQUEUED", { jobId: job.jobId, loanId, tenantName: tenant.tenantName, kind });
    return json(202, { status: "ACCEPTED", jobId: job.jobId, loanId, statusUrl: `/v1/jobs/${job.jobId}` });
  }

  async function readDocuments(apiKeyId, loanId, documentId) {
    const tenant = await tenantFor(apiKeyId);
    if (!tenant) return error(403, "Unauthorized tenant mapping");
    if (tenant.persona !== "TPO_BROKER") return error(403, "Persona cannot read documents");

    let upstream;
    try {
      upstream = documentId ? await meridian.downloadDocument(documentId) : await meridian.listDocuments(loanId);
    } catch (err) {
      log("ERROR", "MERIDIANLINK_DOCUMENT_FAILED", { loanId, message: err.message });
      return error(err.name === "TimeoutError" ? 504 : 502, "MeridianLink document request failed");
    }

    log("INFO", "MERIDIANLINK_DOCUMENT_READ", { loanId, status: upstream.status, single: Boolean(documentId) });
    if (upstream.status === 423) return error(423, "Loan is locked by MeridianLink", { code: "FILE_LOCKED" });
    if (upstream.status === 404) return error(404, "Loan or document not found");
    if (upstream.status === 429) return error(429, "MeridianLink rate limit reached");
    if (upstream.status === 401 || upstream.status === 403) return error(502, "MeridianLink rejected gateway credentials");
    if (upstream.status >= 500) return error(502, "MeridianLink unavailable");
    if (upstream.status >= 300) return error(400, "MeridianLink rejected the request", { upstreamStatus: upstream.status });

    if (documentId) {
      const content = parseDocumentContent(upstream.body);
      if (!content) return error(502, "MeridianLink returned no document content");
      return json(200, { documentId, contentType: "application/pdf", contentBase64: content });
    }
    return json(200, { loanId, ...parseDocumentList(upstream.body) }, { "Cache-Control": "private, max-age=15" });
  }

  async function jobStatus(apiKeyId, jobId) {
    const tenant = await tenantFor(apiKeyId);
    if (!tenant) return error(403, "Unauthorized tenant mapping");

    const job = await store.getJob(jobId);
    if (!job || job.apiKeyId !== apiKeyId) return error(404, "Job not found");
    return json(200, {
      jobId: job.jobId,
      loanId: job.loanId,
      status: job.status,
      attempts: job.attempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error || null
    });
  }

  async function provision(event, requestId) {
    let payload;
    try {
      payload = JSON.parse(event.body || "");
    } catch {
      return error(400, "Invalid JSON body");
    }

    const role = String(payload?.role || "").trim().toLowerCase();
    const config = roleFor(env, role);
    if (!config || !safeEqual(String(payload?.code || ""), config.code)) {
      log("WARN", "PORTAL_INVITE_REJECTED", { requestId, role: role || "unknown" });
      return error(403, "Invalid or expired invite link");
    }

    const tenantName = String(payload.tenantName || "").trim();
    const email = String(payload.email || "").trim();
    if (!tenantName || tenantName.length > 100) return error(400, "tenantName is required (max 100 chars)");
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return error(400, "A valid email is required");

    const key = await store.createApiKey({ tenantName });
    await store.putTenant({
      apiKeyId: key.id,
      tenantName,
      email,
      role,
      persona: config.persona,
      status: "ACTIVE",
      createdAt: new Date(now()).toISOString()
    });
    log("INFO", "TENANT_PROVISIONED", { tenantName, role, persona: config.persona, apiKeyId: key.id });

    return json(200, {
      message: "Tenant provisioned successfully",
      apiKey: key.value,
      tenantName,
      email,
      role,
      persona: config.persona
    });
  }

  async function handle(event = {}) {
    const method = String(event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
    const path = event.path || event.rawPath || "/";
    const requestId = event.requestContext?.requestId;
    const apiKeyId = event.requestContext?.identity?.apiKeyId;
    const started = now();

    log("INFO", "REQUEST_RECEIVED", { requestId, method, path });
    try {
      if (method === "GET" && path === "/health") return json(200, { status: "ok", system: "MeridianLinkGateway" });

      if (path === "/portal") {
        if (method === "POST") return await provision(event, requestId);
        if (method !== "GET") return error(405, "Method not allowed");
        const role = String(event.queryStringParameters?.role || "").trim().toLowerCase();
        const code = String(event.queryStringParameters?.code || "");
        if (!role && !code) return html(200, renderPortal());
        const config = roleFor(env, role);
        if (!config || !safeEqual(code, config.code)) {
          log("WARN", "PORTAL_INVITE_REJECTED", { requestId, role: role || "unknown" });
          return html(403, renderPortal({ error: "This invite link is invalid or has expired." }));
        }
        return html(200, renderPortal({ role: config }));
      }

      if (path === "/v1/fields") {
        return method === "GET" ? await fields(event, apiKeyId) : error(405, "Method not allowed");
      }

      let match;
      if ((match = /^\/v1\/loans\/([^/]+)\/fees$/.exec(path))) {
        if (method !== "PATCH") return error(405, "Method not allowed");
        return await enqueueWrite(event, apiKeyId, decode(match[1]));
      }
      if ((match = /^\/v1\/loans\/([^/]+)\/conditions$/.exec(path))) {
        if (method !== "POST") return error(405, "Method not allowed");
        return await enqueueWrite(event, apiKeyId, decode(match[1]), "conditions");
      }
      if ((match = /^\/v1\/loans\/([^/]+)\/documents$/.exec(path))) {
        if (method === "POST") return await enqueueWrite(event, apiKeyId, decode(match[1]), "documents");
        if (method === "GET") return await readDocuments(apiKeyId, decode(match[1]));
        return error(405, "Method not allowed");
      }
      if ((match = /^\/v1\/loans\/([^/]+)\/documents\/([^/]+)$/.exec(path))) {
        if (method !== "GET") return error(405, "Method not allowed");
        return await readDocuments(apiKeyId, decode(match[1]), decode(match[2]));
      }
      if ((match = /^\/v1\/loans\/([^/]+)$/.exec(path))) {
        const loanId = decode(match[1]);
        if (method === "GET") return await readLoan(event, apiKeyId, loanId);
        if (method === "PATCH") return error(501, "Only fee, condition, and document writes are supported; 1003 loan-field writes are not implemented");
        return error(405, "Method not allowed");
      }
      if ((match = /^\/v1\/jobs\/([^/]+)$/.exec(path))) {
        if (method !== "GET") return error(405, "Method not allowed");
        return await jobStatus(apiKeyId, decode(match[1]));
      }

      return error(404, "Not found");
    } catch (err) {
      log("ERROR", "HANDLER_EXCEPTION", { requestId, method, path, message: err.message, stack: err.stack });
      return error(500, "Internal gateway error");
    } finally {
      log("INFO", "REQUEST_COMPLETE", { requestId, method, path, durationMs: now() - started });
    }
  }

  return { handle };
}

module.exports = { createApp };
