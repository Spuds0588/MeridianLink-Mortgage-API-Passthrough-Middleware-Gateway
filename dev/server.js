/** Local API Gateway + SQS emulator around the real handler (fake MeridianLink, in-memory AWS). */
const { createMockMeridian } = require("../mock/meridian");
const { createMemoryStore } = require("./memory-store");
const { createLocalRunner } = require("./local-runner");
const { createMeridian } = require("../src/meridian");
const { createApp } = require("../src/app");
const { createServer } = require("../src/server");
const { log } = require("../src/log");

const INVITES = {
  title: "local-title-invite-0123456789",
  broker: "local-broker-invite-0123456789",
  appraisal: "local-appraisal-invite-0123456789"
};

const localEnv = (overrides = {}) => ({
  INVITE_TITLE: INVITES.title,
  INVITE_BROKER: INVITES.broker,
  INVITE_APPRAISAL: INVITES.appraisal,
  ...overrides
});

async function createDevGateway({ port = 0, lockOnWrite = 0, env = {} } = {}) {
  const mock = createMockMeridian({ lockOnWrite });
  const { url: mockUrl } = await mock.listen(0);
  const store = createMemoryStore();
  const meridian = createMeridian({ baseUrl: mockUrl, username: "demo", password: "demo" });
  const app = createApp({ store, meridian, env: localEnv(env) });
  const runner = createLocalRunner({ store, meridian, retryDelayMs: 20 });
  const server = createServer({ handle: app.handle, resolveApiKey: (key) => store.keyIdsByValue.get(key) });

  let draining = false;
  const timer = setInterval(async () => {
    if (draining || store.queue.length === 0) return;
    draining = true;
    try {
      await runner.drain();
    } catch (err) {
      log("ERROR", "LOCAL_DRAIN_FAILED", { message: err.message });
    } finally {
      draining = false;
    }
  }, 20);
  timer.unref();

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    store,
    mock,
    runner,
    invites: INVITES,
    close: async () => {
      clearInterval(timer);
      await new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      });
      await mock.close();
    }
  };
}

if (require.main === module) {
  createDevGateway({ port: Number(process.env.PORT) || 3000 }).then((gateway) => {
    console.log(`Gateway:   ${gateway.url}`);
    console.log(`Portal:    ${gateway.url}/portal?role=title&code=${INVITES.title}`);
    console.log(`Broker:    ${gateway.url}/portal?role=broker&code=${INVITES.broker}`);
    console.log(`Appraisal: ${gateway.url}/portal?role=appraisal&code=${INVITES.appraisal}`);
    console.log("Loans:     ML-998822 (normal), ML-LOCKED-1 (423), ML-404 (missing)");
    console.log("Press Ctrl+C to stop.");
  });
}

module.exports = { createDevGateway, INVITES, localEnv };
