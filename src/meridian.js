/** MeridianLink Mortgage API client: Basic auth, MISMO XML over HTTPS (static egress in AWS). */
function createMeridian({ baseUrl, username, password, timeoutMs = 8000 }) {
  if (!baseUrl) throw new Error("MERIDIAN_BASE_URL is required");
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const call = async (path, init = {}) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: authorization, ...init.headers }
    });
    return { status: res.status, body: await res.text() };
  };

  return {
    getLoan: (loanId) => call(`/api/mismo/v3_4/loans/${encodeURIComponent(loanId)}`, { headers: { Accept: "application/xml" } }),
    updateFees: (loanId, xml) =>
      call(`/api/mismo/v3_4/loans/${encodeURIComponent(loanId)}`, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/xml" },
        body: xml
      }),
    getFields: (ids) =>
      call(`/api/mismo/v3_4/fields?ids=${encodeURIComponent(ids.join(","))}`, { headers: { Accept: "application/json" } })
  };
}

module.exports = { createMeridian };
