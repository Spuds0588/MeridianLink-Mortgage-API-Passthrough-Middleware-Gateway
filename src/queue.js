/** Local stand-in for the SQS FIFO write pipeline: per-loanId ordering, capped concurrency, exponential backoff. */
const { feesToXml } = require("./mismo");
const { log } = require("./log");

function createQueue({ meridian, store, concurrency = 10, maxAttempts = 5, retryDelayMs = 250 }) {
  const groups = new Map();
  let active = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const save = (job, status, attempts, error) =>
    store.saveJob({ ...job, status, attempts, error, updatedAt: new Date().toISOString() });

  async function deliver(job) {
    let attempts = job.attempts || 0;
    let error = null;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const res = await meridian.updateFees(job.loanId, feesToXml(job.loanId, job.fees));
        if (res.status < 300) {
          save(job, "COMPLETED", attempts, null);
          log("INFO", "WRITE_JOB_COMPLETED", { jobId: job.jobId, loanId: job.loanId, attempts });
          return;
        }
        error = `upstream ${res.status}`;
        if (res.status !== 423 && res.status !== 429 && res.status < 500) {
          save(job, "FAILED", attempts, error);
          log("ERROR", "WRITE_JOB_REJECTED", { jobId: job.jobId, loanId: job.loanId, status: res.status, attempts });
          return;
        }
        log("WARN", "RECORD_LOCK_BACKOFF", { jobId: job.jobId, loanId: job.loanId, status: res.status, attempts });
      } catch (err) {
        error = err.message;
        log("WARN", "WRITE_JOB_TRANSPORT_ERROR", { jobId: job.jobId, loanId: job.loanId, attempts, message: err.message });
      }
      if (attempts < maxAttempts) {
        save(job, "RETRYING", attempts, error);
        await sleep(retryDelayMs * 2 ** (attempts - 1));
      }
    }
    save(job, "FAILED", attempts, error);
    log("ERROR", "WRITE_JOB_EXHAUSTED", { jobId: job.jobId, loanId: job.loanId, attempts, error });
  }

  function pump() {
    for (const [groupId, group] of groups) {
      if (active >= concurrency) return;
      if (group.busy || !group.tasks.length) continue;
      group.busy = true;
      active += 1;
      deliver(group.tasks.shift()).finally(() => {
        group.busy = false;
        active -= 1;
        if (!group.tasks.length) groups.delete(groupId);
        pump();
      });
    }
  }

  return {
    enqueue(job) {
      if (!groups.has(job.loanId)) groups.set(job.loanId, { tasks: [], busy: false });
      groups.get(job.loanId).tasks.push(job);
      pump();
    },
    /** Resolves when every queued job finished (used by tests and graceful shutdown). */
    idle() {
      return new Promise((resolve) => {
        const check = () => (active === 0 && ![...groups.values()].some((g) => g.busy || g.tasks.length) ? resolve() : setTimeout(check, 5));
        check();
      });
    }
  };
}

module.exports = { createQueue };
