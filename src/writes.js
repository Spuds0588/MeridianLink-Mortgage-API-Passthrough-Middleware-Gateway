/** Shared write-delivery logic used by the SQS worker and the local drain runner. */
const { feesToXml } = require("./mismo");
const { log } = require("./log");

const RETRYABLE = (status) => status === 423 || status === 429 || status >= 500;

/** Marks a job FAILED permanently. */
const fail = (store, job, attempts, error, now) => store.putJob({ ...job, status: "FAILED", attempts, error, updatedAt: new Date(now()).toISOString() });

/**
 * Attempts one fee write. Returns normally when the job reached a terminal state;
 * throws for a retryable failure so SQS (or the local runner) redelivers it.
 */
async function processWrite({ job, fees, meridian, store, attempts, maxAttempts = 5, now = Date.now }) {
  if (!job) return log("WARN", "JOB_NOT_FOUND", { attempts });
  if (job.status === "COMPLETED") return;

  const updatedAt = () => new Date(now()).toISOString();
  let response;
  try {
    response = await meridian.updateFees(job.loanId, feesToXml(job.loanId, fees));
  } catch (err) {
    log("WARN", "WRITE_TRANSPORT_ERROR", { jobId: job.jobId, loanId: job.loanId, attempts, message: err.message });
    if (attempts >= maxAttempts) return void (await fail(store, job, attempts, err.message, now), log("ERROR", "WRITE_ATTEMPTS_EXHAUSTED", { jobId: job.jobId, attempts }));
    await store.putJob({ ...job, status: "RETRYING", attempts, error: err.message, updatedAt: updatedAt() });
    throw err;
  }

  if (response.status < 300) {
    await store.putJob({ ...job, status: "COMPLETED", attempts, error: null, updatedAt: updatedAt() });
    log("INFO", "WRITE_COMPLETED", { jobId: job.jobId, loanId: job.loanId, attempts });
    return;
  }

  if (!RETRYABLE(response.status)) {
    await fail(store, job, attempts, `upstream ${response.status}`, now);
    log("ERROR", "WRITE_REJECTED", { jobId: job.jobId, loanId: job.loanId, status: response.status, attempts });
    return;
  }

  if (attempts >= maxAttempts) {
    await fail(store, job, attempts, `upstream still ${response.status} after ${maxAttempts} attempts`, now);
    log("ERROR", "WRITE_ATTEMPTS_EXHAUSTED", { jobId: job.jobId, loanId: job.loanId, status: response.status, attempts });
    return;
  }

  await store.putJob({ ...job, status: "RETRYING", attempts, error: `upstream ${response.status}`, updatedAt: updatedAt() });
  log("WARN", "RECORD_LOCK_BACKOFF", { jobId: job.jobId, loanId: job.loanId, status: response.status, attempts });
  throw new Error(`Retryable upstream status ${response.status}`);
}

module.exports = { processWrite };
