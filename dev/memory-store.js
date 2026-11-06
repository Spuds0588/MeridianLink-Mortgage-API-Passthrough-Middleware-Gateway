/** In-memory storage/queue adapter for local development and tests. Never deployed. */
const { randomUUID } = require("node:crypto");

function createMemoryStore({ password = "test-password" } = {}) {
  const tenants = new Map();
  const jobs = new Map();
  const keyIdsByValue = new Map();
  const queue = [];

  return {
    queue,
    keyIdsByValue,
    async getSecret() {
      return { password };
    },
    async getTenant(apiKeyId) {
      return tenants.get(apiKeyId) || null;
    },
    async putTenant(tenant) {
      tenants.set(tenant.apiKeyId, tenant);
    },
    async getJob(jobId) {
      return jobs.get(jobId) || null;
    },
    async putJob(job) {
      jobs.set(job.jobId, job);
    },
    async enqueueWrite(message) {
      queue.push({ ...message, receives: 0 });
    },
    // Mirrors API Gateway key creation: the value is returned once, only the id is stored.
    async createApiKey() {
      const id = `key_${randomUUID()}`;
      const value = `mlg_${randomUUID().replace(/-/g, "")}`;
      keyIdsByValue.set(value, id);
      return { id, value };
    }
  };
}

module.exports = { createMemoryStore };
