#!/usr/bin/env node
/** Local dev stack: mock MeridianLink on :8081 + gateway on :8080. Stop with Ctrl+C. */
const { createMockMeridian } = require("../mock/meridian");
const { createServer, buildApp } = require("../src/server");
const { log } = require("../src/log");

(async () => {
  const mock = createMockMeridian();
  const { url } = await mock.listen(Number(process.env.MOCK_PORT ?? 8081));
  process.env.MERIDIAN_BASE_URL = url;

  const port = Number(process.env.PORT ?? 8080);
  const { app } = buildApp();
  const server = createServer(app.handle);
  server.listen(port, () => {
    log("INFO", "DEV_STACK_READY", { mock: url, portal: `http://localhost:${port}/portal` });
    console.log(`\n  Portal:          http://localhost:${port}/portal`);
    console.log(`  Sample loans:    ML-998822   (always locked: ML-LOCKED-1, missing: ML-404)`);
    console.log(`  Mock vendor API: ${url}/api/mismo/v3_4/loans/ML-998822\n`);
  });

  const shutdown = () => {
    server.close();
    mock.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})();
