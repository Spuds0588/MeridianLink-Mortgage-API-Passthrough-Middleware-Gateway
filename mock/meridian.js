/** Mock MeridianLink Mortgage API and EDocs SOAP service for local development and tests. */
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

const tag = (xml, name) => new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, "i").exec(xml)?.[1] ?? "";
const attr = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const soapResponse = (action, payload) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${action}Response xmlns="http://www.meridianlink.com/WebServices/"><${action}Result>${payload}</${action}Result></${action}Response></soap:Body></soap:Envelope>`;

function createMockMeridian({ lockOnWrite = 0 } = {}) {
  const state = {
    lockOnWrite,
    updates: [],
    requests: [],
    fieldCalls: 0,
    fieldsFailure: 0,
    ticketCalls: 0,
    edocsRequests: [],
    documents: new Map(),
    nextDocId: 1
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, type, body) => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };
    const collect = (cb) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => cb(Buffer.concat(chunks).toString("utf8")));
    };

    state.requests.push({ method: req.method, path: url.pathname, search: url.search });

    if (req.method === "POST" && url.pathname === "/edocs/AuthService.asmx") {
      return collect((body) => {
        state.ticketCalls += 1;
        if (tag(body, "sUserName") !== "demo" || tag(body, "sPassword") !== "demo") {
          return send(401, "text/xml", soapResponse("GetUserAuthTicket", ""));
        }
        send(200, "text/xml", soapResponse("GetUserAuthTicket", `ticket_${state.ticketCalls}`));
      });
    }

    if (req.method === "POST" && url.pathname === "/edocs/EDocsService.asmx") {
      return collect((body) => {
        const action = String(req.headers.soapaction || "").replace(/"/g, "").split("/").pop();
        state.edocsRequests.push(action);
        if (!/^ticket_\d+$/.test(tag(body, "sTicket"))) return send(401, "text/xml", soapResponse(action, ""));
        const loanId = tag(body, "sLNm");
        const docs = state.documents.get(loanId) || [];

        if (action === "UploadPDFDocument") {
          const documentType = tag(body, "documentType");
          const contentBase64 = tag(body, "sDataContent").replace(/\s+/g, "");
          if (!documentType || !contentBase64) return send(400, "text/xml", soapResponse(action, ""));
          const doc = { id: `doc_${state.nextDocId++}`, documentType, notes: tag(body, "notes"), contentBase64 };
          state.documents.set(loanId, [...docs, doc]);
          return send(200, "text/xml", soapResponse(action, "true"));
        }
        if (action === "ListEdocsByLoanNumber") {
          const payload = docs
            .map((doc) => `<edoc edocID="${doc.id}" documentType="${attr(doc.documentType)}" fileName="${attr(doc.documentType)}.pdf" notes="${attr(doc.notes)}" uploadedDate="2026-11-06"/>`)
            .join("");
          return send(200, "text/xml", soapResponse(action, payload));
        }
        if (action === "DownloadEdocsPdfById") {
          const documentId = tag(body, "docId");
          for (const list of state.documents.values()) {
            const doc = list.find((item) => item.id === documentId);
            if (doc) return send(200, "text/xml", soapResponse(action, doc.contentBase64));
          }
          return send(404, "text/xml", soapResponse(action, ""));
        }
        send(500, "text/xml", soapResponse(action, ""));
      });
    }

    if (!req.headers.authorization?.startsWith("Basic ")) return send(401, "application/json", JSON.stringify({ error: "Unauthorized" }));

    const loanMatch = /^\/api\/mismo\/v3_4\/loans\/([^/]+)$/.exec(url.pathname);
    if (loanMatch && req.method === "GET") {
      const loanId = decodeURIComponent(loanMatch[1]);
      if (loanId.startsWith("ML-LOCKED")) return send(423, "application/xml", "<MESSAGE><ERROR>Record locked</ERROR></MESSAGE>");
      if (loanId === "ML-404") return send(404, "application/xml", "<MESSAGE><ERROR>Not found</ERROR></MESSAGE>");
      return send(200, "application/xml", FIXTURE.replace(/<LoanIdentifier>[^<]*<\/LoanIdentifier>/, `<LoanIdentifier>${loanId}</LoanIdentifier>`));
    }

    if (loanMatch && req.method === "PATCH") {
      const loanId = decodeURIComponent(loanMatch[1]);
      if (loanId === "ML-404") return send(404, "application/json", JSON.stringify({ error: "Not found" }));
      return collect((body) => {
        if (state.lockOnWrite > 0) {
          state.lockOnWrite -= 1;
          return send(423, "application/json", JSON.stringify({ error: "Record locked by another user" }));
        }
        if (!body.includes('MISMOVersionID="3.4"')) return send(400, "application/json", JSON.stringify({ error: "Invalid MISMO payload" }));
        state.updates.push({ loanId, body });
        send(200, "application/json", JSON.stringify({ status: "accepted" }));
      });
    }

    if (url.pathname === "/api/mismo/v3_4/fields" && req.method === "GET") {
      state.fieldCalls += 1;
      if (state.fieldsFailure) return send(state.fieldsFailure, "application/json", JSON.stringify({ error: "schema_unavailable" }));
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
