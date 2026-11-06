/** Mock MeridianLink Mortgage API for local development and tests (no vendor access required). */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const FIXTURE = fs.readFileSync(path.join(__dirname, "..", "fixtures", "loan.xml"), "utf8");
const FIELDS = {
  "11": { description: "Subject Property Address Line", type: "STRING" },
  "646": { description: "Title - Lender Title Insurance", type: "DECIMAL" },
  CX: { description: "Custom field namespace", type: "STRING" },
  "CX.TITLE.STATUS": { description: "Custom Title Milestone Status", type: "STRING" }
};

function createMockMeridian({ lockOnWrite = 0 } = {}) {
  const state = { lockOnWrite, updates: [], requests: [] };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, type, body) => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };

    state.requests.push({ method: req.method, path: url.pathname, search: url.search });
    if (!req.headers.authorization?.startsWith("Basic ")) return send(401, "application/json", JSON.stringify({ error: "Unauthorized" }));

    const loanMatch = /^\/api\/mismo\/v3_4\/loans\/([^/]+)$/.exec(url.pathname);
    if (loanMatch && req.method === "GET") {
      const loanId = decodeURIComponent(loanMatch[1]);
      if (loanId.startsWith("ML-LOCKED")) return send(423, "application/xml", "<MESSAGE><ERROR>Record locked</ERROR></MESSAGE>");
      if (loanId === "ML-404") return send(404, "application/xml", "<MESSAGE><ERROR>Not found</ERROR></MESSAGE>");
      return send(200, "application/xml", FIXTURE.replace(/<LoanIdentifier>[^<]*<\/LoanIdentifier>/, `<LoanIdentifier>${loanId}</LoanIdentifier>`));
    }

    if (loanMatch && req.method === "PATCH") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (state.lockOnWrite > 0) {
          state.lockOnWrite -= 1;
          return send(423, "application/json", JSON.stringify({ error: "Record locked by another user" }));
        }
        if (!body.includes("MISMOVersionID=\"3.4\"")) return send(400, "application/json", JSON.stringify({ error: "Invalid MISMO payload" }));
        state.updates.push({ loanId: decodeURIComponent(loanMatch[1]), body });
        send(200, "application/json", JSON.stringify({ status: "accepted" }));
      });
      return;
    }

    if (url.pathname === "/api/mismo/v3_4/fields" && req.method === "GET") {
      const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
      const payload = Object.fromEntries(ids.map((id) => [id, FIELDS[id] ?? { description: "Unknown field", type: "STRING" }]));
      return send(200, "application/json", JSON.stringify(payload));
    }

    send(404, "application/json", JSON.stringify({ error: "Not found" }));
  });

  return {
    state,
    server,
    listen: (port = 0) => new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}` }))),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

module.exports = { createMockMeridian, FIELDS };
