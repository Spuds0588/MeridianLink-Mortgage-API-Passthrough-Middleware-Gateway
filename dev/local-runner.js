/** Drains the local write queue like an SQS event source: retryable failures are redelivered. */
const { processWrite } = require("../src/writes");
const { log } = require("../src/log");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createLocalRunner({ store, meridian, maxAttempts = 5, retryDelayMs = 50 }) {
  async function drain({ maxRounds = 200 } = {}) {
    const summary = { processed: 0, retried: 0 };
    for (let round = 0; round < maxRounds && store.queue.length > 0; round += 1) {
      const message = store.queue.shift();
      message.receives += 1;
      const job = await store.getJob(message.jobId);
      try {
        await processWrite({ job, mismo: message.mismo, meridian, store, attempts: message.receives, maxAttempts });
        summary.processed += 1;
      } catch (err) {
        summary.retried += 1;
        store.queue.push(message);
        await sleep(retryDelayMs * 2 ** (message.receives - 1));
      }
    }
    if (store.queue.length) log("WARN", "LOCAL_QUEUE_NOT_DRAINED", { remaining: store.queue.length });
    return summary;
  }

  return { drain };
}

module.exports = { createLocalRunner };
