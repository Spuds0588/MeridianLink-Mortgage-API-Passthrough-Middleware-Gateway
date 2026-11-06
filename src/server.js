/** Local HTTP entrypoint: translates Node requests into API-Gateway-shaped events. */
const http = require("node:http");
const { createApp } = require("./app");
const { createMeridian } = require("./meridian");
const { createQueue } = require("./queue");
const { createStore } = require("./store");
const { log } = require("./log");

const toEvent = (req, body) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  return {
    httpMethod: req.method,
    path: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers: req.headers,
    body
  };
};

function createServer(handle) {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const event = toEvent(req, Buffer.concat(chunks).toString("utf8"));
      try {
        const { statusCode, headers, body } = await handle(event);
        res.writeHead(statusCode, headers);
        res.end(body);
      } catch (err) {
        log("ERROR", "UNHANDLED_SERVER_ERROR", { message: err.message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Gateway Error" }));
      }
    });
  });
}

function buildApp() {
  const store = createStore({ file: process.env.STORE_FILE ?? "data/store.json" });
  const meridian = createMeridian({
    baseUrl: process.env.MERIDIAN_BASE_URL ?? "http://127.0.0.1:8081",
    username: process.env.MERIDIAN_USERNAME ?? "demo",
    password: process.env.MERIDIAN_PASSWORD ?? "demo"
  });
  return { app: createApp({ store, queue: createQueue({ meridian, store }), meridian }), store };
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8080);
  const { app } = buildApp();
  createServer(app.handle).listen(port, () => log("INFO", "GATEWAY_LISTENING", { port, portal: `http://localhost:${port}/portal` }));
}

module.exports = { createServer, buildApp, toEvent };
