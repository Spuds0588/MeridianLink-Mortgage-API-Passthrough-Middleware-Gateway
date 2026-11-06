/** Deployed Lambda: API Gateway routes plus SQS FIFO write records. */
const { createApp } = require("./app");
const { createMeridian } = require("./meridian");
const { processWrite } = require("./writes");
const { log } = require("./log");

function createHandler({ store, env = process.env, meridian, now = () => Date.now() }) {
  let client = meridian ?? null;
  const getClient = () => {
    if (!client) {
      client = createMeridian({
        baseUrl: env.MERIDIAN_BASE_URL,
        username: env.MERIDIAN_USERNAME,
        edocsUrl: env.MERIDIAN_EDOCS_URL,
        passwordProvider: async () => (await store.getSecret()).password,
        timeoutMs: env.UPSTREAM_TIMEOUT_MS
      });
    }
    return client;
  };
  const lazyMeridian = {
    getLoan: (loanId) => getClient().getLoan(loanId),
    updateLoan: (loanId, xml) => getClient().updateLoan(loanId, xml),
    uploadDocument: (loanId, doc) => getClient().uploadDocument(loanId, doc),
    listDocuments: (loanId) => getClient().listDocuments(loanId),
    downloadDocument: (documentId) => getClient().downloadDocument(documentId),
    getFields: (ids) => getClient().getFields(ids)
  };

  const app = createApp({ store, meridian: lazyMeridian, env, now });

  async function handleQueue(records) {
    const batchItemFailures = [];
    for (const record of records) {
      const attempts = Number(record.attributes?.ApproximateReceiveCount) || 1;
      let jobId;
      try {
        const message = JSON.parse(record.body || "{}");
        jobId = message.jobId;
        await processWrite({
          job: await store.getJob(message.jobId),
          mismo: message.mismo,
          doc: message.doc,
          meridian: lazyMeridian,
          store,
          attempts,
          now
        });
      } catch (err) {
        log("WARN", "WRITE_RETRY_SCHEDULED", { jobId, messageId: record.messageId, attempts, message: err.message });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  }

  return async function handler(event = {}) {
    if (Array.isArray(event.Records) && event.Records[0]?.eventSource === "aws:sqs") return handleQueue(event.Records);
    return app.handle(event);
  };
}

let defaultHandler = null;

exports.handler = async (event, context) => {
  if (!defaultHandler) {
    const { createAwsStore } = require("./aws-store");
    defaultHandler = createHandler({ store: createAwsStore(process.env) });
  }
  return defaultHandler(event, context);
};

exports.createHandler = createHandler;
