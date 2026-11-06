/** Local HTTP adapter: turns Node requests into API-Gateway-shaped events. */
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { log } = require("./log");

/** resolveApiKey mimics API Gateway's key-id injection from the x-api-key header. */
function createServer({ handle, resolveApiKey = () => undefined }) {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const header = req.headers["x-api-key"];
      const apiKeyId = resolveApiKey(Array.isArray(header) ? header[0] : header);
      const event = {
        httpMethod: req.method,
        path: url.pathname,
        queryStringParameters: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        requestContext: { requestId: randomUUID(), identity: apiKeyId ? { apiKeyId } : {} }
      };
      try {
        const { statusCode, headers, body } = await handle(event);
        res.writeHead(statusCode, headers);
        res.end(body);
      } catch (err) {
        log("ERROR", "UNHANDLED_SERVER_ERROR", { message: err.message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal gateway error" }));
      }
    });
  });
}

module.exports = { createServer };
