/** MeridianLink Mortgage API client: Basic auth, MISMO XML over HTTPS (static egress in AWS). */
function createMeridian({ baseUrl, username, password, passwordProvider, timeoutMs = 8000, fetchImpl = globalThis.fetch }) {
  if (!baseUrl) throw new Error("MERIDIAN_BASE_URL is required");
  let resolvedPassword = password;
  const secret = async () => (resolvedPassword ??= (await passwordProvider?.()) || "");

  const call = async (path, init = {}) => {
    const authorization = `Basic ${Buffer.from(`${username}:${await secret()}`).toString("base64")}`;
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: AbortSignal.timeout(Number(timeoutMs) || 8000),
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
