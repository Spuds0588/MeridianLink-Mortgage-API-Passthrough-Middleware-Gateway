/** MeridianLink Mortgage client: MISMO XML over HTTPS plus EDocsService SOAP (static egress in AWS). */
const escapeXml = (value) => String(value).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

function createMeridian({ baseUrl, edocsUrl, username, password, passwordProvider, timeoutMs = 8000, ticketTtlMs = 50 * 60_000, now = Date.now, fetchImpl = globalThis.fetch }) {
  if (!baseUrl) throw new Error("MERIDIAN_BASE_URL is required");
  let resolvedPassword = password;
  const secret = async () => (resolvedPassword ??= (await passwordProvider?.()) || "");
  const timeout = Number(timeoutMs) || 8000;

  const call = async (path, init = {}) => {
    const authorization = `Basic ${Buffer.from(`${username}:${await secret()}`).toString("base64")}`;
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeout),
      headers: { Authorization: authorization, ...init.headers }
    });
    return { status: res.status, body: await res.text() };
  };

  // EDocsService is SOAP 1.1 on the same tenant host. The department path is
  // configurable because tenants mount /edocs differently.
  const edocsBase = () => (edocsUrl || `${baseUrl.replace(/\/$/, "")}/edocs`).replace(/\/$/, "");
  let ticket = null;

  const soap = async (service, action, body) => {
    const res = await fetchImpl(`${edocsBase()}/${service}.asmx`, {
      method: "POST",
      signal: AbortSignal.timeout(timeout),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"http://www.meridianlink.com/WebServices/${action}"`
      },
      body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${action} xmlns="http://www.meridianlink.com/WebServices/">${body}</${action}></soap:Body></soap:Envelope>`
    });
    return { status: res.status, body: await res.text() };
  };

  const authTicket = async (refresh) => {
    if (!refresh && ticket && ticket.expiresAt > now()) return ticket.value;
    const res = await soap(
      "AuthService",
      "GetUserAuthTicket",
      `<sUserName>${escapeXml(username)}</sUserName><sPassword>${escapeXml(await secret())}</sPassword>`
    );
    if (res.status !== 200) throw new Error(`EDocs auth failed (${res.status})`);
    const value = /<(?:\w+:)?GetUserAuthTicketResult[^>]*>([\s\S]*?)<\//i.exec(res.body)?.[1]?.trim();
    if (!value) throw new Error("EDocs auth ticket missing");
    ticket = { value, expiresAt: now() + ticketTtlMs };
    return value;
  };

  const edocs = async (action, params) => {
    let res = await soap("EDocsService", action, `<sTicket>${escapeXml(await authTicket())}</sTicket>${params}`);
    if (res.status === 401 || res.status === 403) {
      res = await soap("EDocsService", action, `<sTicket>${escapeXml(await authTicket(true))}</sTicket>${params}`);
    }
    return res;
  };

  return {
    getLoan: (loanId) => call(`/api/mismo/v3_4/loans/${encodeURIComponent(loanId)}`, { headers: { Accept: "application/xml" } }),
    updateLoan: (loanId, xml) =>
      call(`/api/mismo/v3_4/loans/${encodeURIComponent(loanId)}`, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/xml" },
        body: xml
      }),
    getFields: (ids) =>
      call(`/api/mismo/v3_4/fields?ids=${encodeURIComponent(ids.join(","))}`, { headers: { Accept: "application/json" } }),
    listDocuments: (loanId) => edocs("ListEdocsByLoanNumber", `<sLNm>${escapeXml(loanId)}</sLNm>`),
    uploadDocument: (loanId, { documentType, notes, contentBase64 }) =>
      edocs(
        "UploadPDFDocument",
        `<sLNm>${escapeXml(loanId)}</sLNm><documentType>${escapeXml(documentType)}</documentType><notes>${escapeXml(notes || "")}</notes><sDataContent>${contentBase64}</sDataContent>`
      ),
    downloadDocument: (documentId) => edocs("DownloadEdocsPdfById", `<docId>${escapeXml(documentId)}</docId>`)
  };
}

module.exports = { createMeridian };
