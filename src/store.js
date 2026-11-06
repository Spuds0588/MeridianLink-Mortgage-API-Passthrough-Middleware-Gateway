/** Local stand-in for DynamoDB `Tenants` + `Jobs` tables. Pass `file` to persist across restarts. */
const fs = require("node:fs");
const path = require("node:path");

function createStore({ file = null } = {}) {
  const data = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { tenants: {}, jobs: {} };
  const save = () => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  };

  return {
    // Resolves a tenant by raw API key (local) or API Gateway key id (deployed).
    tenantFor: (key) => (key ? Object.values(data.tenants).find((t) => t.apiKey === key || t.apiKeyId === key) ?? null : null),
    addTenant: (tenant) => { data.tenants[tenant.apiKeyId] = tenant; save(); return tenant; },
    saveJob: (job) => { data.jobs[job.jobId] = job; save(); return job; },
    getJob: (jobId) => (jobId ? data.jobs[jobId] ?? null : null),
    snapshot: () => data
  };
}

module.exports = { createStore };
