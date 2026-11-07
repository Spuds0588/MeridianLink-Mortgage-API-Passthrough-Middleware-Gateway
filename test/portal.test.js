const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { createMemoryStore } = require("../dev/memory-store");
const { localEnv, INVITES } = require("../dev/server");

const httpEvent = (path, query) => ({
  httpMethod: "GET",
  path,
  queryStringParameters: query,
  requestContext: { requestId: "portal-test" }
});

// The script must be taken from the served HTML, exactly as a browser would.
const shippedScript = (html) => {
  const match = /<script>([\s\S]*)<\/script>/.exec(html);
  assert.ok(match, "the served portal must include its inline script");
  return match[1];
};

const stubElement = (id) => ({
  value: id === "tenantName" ? "Acme Title" : id === "email" ? "dev@acme.test" : "",
  textContent: "",
  disabled: false,
  classList: { add() {}, remove() {} },
  select() {}
});

// Minimal document stub: the portal only needs getElementById, classList and
// one captured submit handler. No DOM package is installed for this.
const runPortal = async (script, persona) => {
  const elements = new Map();
  let submit;
  const document = {
    getElementById(id) {
      if (id === "form") {
        return {
          classList: { add() {}, remove() {} },
          addEventListener(type, handler) {
            if (type === "submit") submit = handler;
          }
        };
      }
      if (id === "copy" || id === "again") return null;
      if (!elements.has(id)) elements.set(id, stubElement(id));
      return elements.get(id);
    }
  };
  const location = {
    pathname: "/portal",
    search: "?role=broker&code=test",
    origin: "https://gateway.test",
    reload() {}
  };
  const fetch = async () => ({ ok: true, json: async () => ({ apiKey: "mlg_test", persona }) });

  new Function("document", "location", "fetch", script)(document, location, fetch);
  assert.equal(typeof submit, "function", "the portal must bind its form submit handler");
  await submit({ preventDefault() {} });

  return {
    endpoints: elements.get("endpoints").textContent.split("\n"),
    curl: elements.get("curl").textContent
  };
};

const lists = (lines, fragment) => lines.some((line) => line.includes(fragment));

test("shipped portal lists exactly the endpoints each persona can call", async () => {
  const app = createApp({ store: createMemoryStore(), meridian: {}, env: localEnv() });
  const page = await app.handle(httpEvent("/portal", { role: "broker", code: INVITES.broker }));
  assert.equal(page.statusCode, 200);
  const script = shippedScript(page.body);

  const title = await runPortal(script, "TITLE_VENDOR");
  assert.ok(lists(title.endpoints, "/v1/loans/{loanId}"));
  assert.ok(lists(title.endpoints, "/fees"));
  assert.equal(lists(title.endpoints, "/conditions"), false);
  assert.equal(lists(title.endpoints, "/documents"), false);
  assert.equal(title.curl.includes("@conditions.json"), false);
  assert.equal(title.curl.includes("@document.json"), false);

  const broker = await runPortal(script, "TPO_BROKER");
  assert.ok(lists(broker.endpoints, "/fees"));
  assert.ok(broker.endpoints.includes("POST   https://gateway.test/v1/loans/{loanId}/conditions"));
  assert.ok(broker.endpoints.includes("POST   https://gateway.test/v1/loans/{loanId}/documents"));
  assert.ok(broker.endpoints.includes("GET    https://gateway.test/v1/loans/{loanId}/documents"));
  assert.ok(broker.endpoints.includes("GET    https://gateway.test/v1/loans/{loanId}/documents/{documentId}"));
  assert.equal(broker.endpoints.filter((line) => line.includes("/documents")).length, 3);
  assert.ok(broker.curl.includes("@conditions.json"));
  assert.ok(broker.curl.includes("@document.json"));

  const appraisal = await runPortal(script, "AMC_VENDOR");
  assert.ok(lists(appraisal.endpoints, "/v1/loans/{loanId}"));
  assert.equal(lists(appraisal.endpoints, "/fees"), false);
  assert.equal(lists(appraisal.endpoints, "/conditions"), false);
  assert.equal(lists(appraisal.endpoints, "/documents"), false);
  assert.equal(appraisal.curl.includes("/fees"), false);
});
