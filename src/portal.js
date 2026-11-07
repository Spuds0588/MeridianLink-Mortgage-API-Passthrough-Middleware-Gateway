/** Zero-build SSR invite portal with the common-field cheat sheet and hardened headers. */
// [category, name, JSON path, type, sample]
const FIELD_CATALOG = [
  ["Property", "Street", "property.street", "STRING", '"123 Main St"'],
  ["Property", "City", "property.city", "STRING", '"Irvine"'],
  ["Property", "State", "property.state", "STRING", '"CA"'],
  ["Property", "Postal code", "property.postalCode", "STRING", '"92618"'],
  ["Loan terms", "Loan amount", "terms.loanAmount", "DECIMAL", "450000.00"],
  ["Loan terms", "Note rate", "terms.noteRate", "DECIMAL", "6.875"],
  ["Loan terms", "Estimated closing", "terms.estimatedClosingDate", "DATE", '"2026-11-20"'],
  ["Milestones", "Current milestone", "milestone", "STRING", '"Underwriting"'],
  ["Fees", "Fee type", "fees[].feeType", "STRING", '"TitleLenderCoveragePremium"'],
  ["Fees", "Fee amount", "fees[].amount", "DECIMAL", "1250.00"],
  ["Conditions", "Description", "conditions[].description", "STRING", '"Updated title commitment"'],
  ["Conditions", "Status", "conditions[].status", "STRING", '"Satisfied"'],
  ["Appraisal", "Appraisal contact", "appraisalContact", "STRING", '"Acme Appraisal Co"']
];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const renderPortal = ({ role, error } = {}) => {
  const rows = FIELD_CATALOG.map(
    ([category, name, jsonPath, type, sample]) =>
      `<tr><td>${escapeHtml(category)}</td><td>${escapeHtml(name)}</td><td class="path">${escapeHtml(jsonPath)}</td><td>${type}</td><td><code>${escapeHtml(sample)}</code></td></tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MeridianLink Mortgage Gateway Portal</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; background: #0f172a; color: #e2e8f0; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 860px; margin: auto; padding: 24px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; }
  h1 { margin: 0; font-size: 21px; }
  h2 { margin: 0 0 8px; font-size: 15px; }
  p.sub, .hint { margin: 6px 0 16px; color: #94a3b8; font-size: 13px; }
  label { display: block; margin: 14px 0 6px; font-size: 11px; text-transform: uppercase; color: #94a3b8; }
  input { width: 100%; padding: 9px 10px; border: 1px solid #334155; border-radius: 8px; background: #0f172a; color: #f8fafc; font: inherit; }
  button { margin-top: 14px; padding: 9px 12px; border: 0; border-radius: 8px; background: #4f46e5; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  .hidden { display: none; }
  .error { margin-top: 14px; padding: 9px 11px; border-radius: 8px; background: #450a0a; color: #fecaca; font-size: 13px; }
  .notice, .ok, .invite { margin: 14px 0; padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; font-size: 13px; }
  .keyrow { display: flex; gap: 8px; margin-bottom: 12px; }
  .keyrow button { width: auto; margin: 0; }
  pre { margin: 0 0 4px; padding: 10px; overflow-x: auto; background: #020617; border-radius: 8px; font-size: 12px; }
  a { color: #a5b4fc; font-size: 12px; }
  .docs { margin-top: 20px; padding-top: 16px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 7px 9px; text-align: left; border-bottom: 1px solid #1e293b; }
  th { color: #94a3b8; font-size: 11px; text-transform: uppercase; }
  td.path { color: #fde68a; }
  td.path, code, pre { font-family: ui-monospace, Menlo, monospace; }
  code { padding: 1px 4px; background: #020617; border-radius: 4px; color: #c7d2fe; }
</style>
</head>
<body>
<main>
  <h1>MeridianLink Mortgage Gateway</h1>
  <p class="sub">Self-serve API access for title, broker, and appraisal partners. Your invite link locks your persona and the data you can see.</p>

  ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ""}

  ${role
    ? `<section class="invite">
        <span class="badge">${escapeHtml(role.label)}</span>
        <p class="hint">Persona locked to <code>${escapeHtml(role.persona)}</code>. Every response is masked to that persona.</p>
      </section>
      <form id="form">
        <label for="tenantName">Company name</label>
        <input id="tenantName" type="text" maxlength="100" placeholder="e.g. First American Title" required>
        <label for="email">Developer email</label>
        <input id="email" type="email" maxlength="254" placeholder="dev@firstam.com" required>
        <button id="submit" type="submit">Generate API key</button>
      </form>`
    : `<div class="notice"><strong>Invite link required.</strong> Ask your lender for a role-scoped link such as <code>/portal?role=title&amp;code=...</code>. The link fixes your persona and permissions.</div>`}

  <div id="error" class="error hidden" role="alert"></div>

  <section id="result" class="ok hidden">
    <h2>Key provisioned successfully</h2>
    <p class="hint">Copy this key now. It is not stored in plaintext and will not be shown again.</p>
    <div class="keyrow">
      <input id="apiKey" readonly>
      <button id="copy" type="button">Copy</button>
    </div>
    <label>Endpoints</label>
    <pre id="endpoints"></pre>
    <label for="curl">Verification cURL</label>
    <pre id="curl"></pre>
    <p><a href="#" id="again">Generate another key with this invite</a></p>
  </section>

  <section class="docs">
    <h2>Common response paths</h2>
    <p class="hint">These are the JSON paths the gateway emits. Anything outside your persona allowlist is not returned at all; custom MISMO fields come from <code>GET /v1/fields</code>.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Category</th><th>Field</th><th>JSON path</th><th>Type</th><th>Sample</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const show = (id) => $(id).classList.remove('hidden');
  const hide = (id) => $(id).classList.add('hidden');
  const lines = (items) => items.join(String.fromCharCode(10));

  const form = $('form');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hide('error');
      const params = new URLSearchParams(location.search);
      const tenantName = $('tenantName').value.trim();
      const email = $('email').value.trim();
      if (!tenantName || !email) {
        $('error').textContent = 'Company name and developer email are required.';
        return show('error');
      }
      const button = $('submit');
      button.disabled = true;
      button.textContent = 'Generating...';
      try {
        const res = await fetch(location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantName, email, role: params.get('role'), code: params.get('code') })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to generate key');
        const base = location.origin;
        const broker = data.persona === 'TPO_BROKER';
        const endpoints = [
          'GET    ' + base + '/v1/loans/{loanId}',
          'GET    ' + base + '/v1/jobs/{jobId}',
          'GET    ' + base + '/v1/fields?ids=11,646,CX.TITLE.STATUS'
        ];
        if (data.persona !== 'AMC_VENDOR') endpoints.push('PATCH  ' + base + '/v1/loans/{loanId}/fees');
        if (broker) endpoints.push(
          'POST   ' + base + '/v1/loans/{loanId}/conditions',
          'POST   ' + base + '/v1/loans/{loanId}/documents',
          'GET    ' + base + '/v1/loans/{loanId}/documents',
          'GET    ' + base + '/v1/loans/{loanId}/documents/{documentId}'
        );
        $('apiKey').value = data.apiKey;
        $('endpoints').textContent = lines(endpoints);
        $('curl').textContent = lines([
          'curl -s "' + base + '/v1/loans/ML-998822" -H "x-api-key: ' + data.apiKey + '"',
          'curl -s -X PATCH "' + base + '/v1/loans/ML-998822/fees" -H "x-api-key: ' + data.apiKey + '" -H "content-type: application/json" -d \\'{"fees":[{"feeType":"TitleLenderCoveragePremium","amount":1350}]}\\''
        ]);
        if (broker) $('curl').textContent += lines([
          '',
          'curl -s -X POST "' + base + '/v1/loans/ML-998822/conditions" -H "x-api-key: ' + data.apiKey + '" -H "content-type: application/json" -d @conditions.json',
          'curl -s -X POST "' + base + '/v1/loans/ML-998822/documents" -H "x-api-key: ' + data.apiKey + '" -H "content-type: application/json" -d @document.json'
        ]);
        hide('form');
        show('result');
      } catch (err) {
        $('error').textContent = err.message;
        show('error');
      } finally {
        button.disabled = false;
        button.textContent = 'Generate API key';
      }
    });
  }

  if ($('copy')) {
    $('copy').addEventListener('click', async () => {
      $('apiKey').select();
      try { await navigator.clipboard.writeText($('apiKey').value); } catch { document.execCommand('copy'); }
      $('copy').textContent = 'Copied';
      setTimeout(() => { $('copy').textContent = 'Copy'; }, 1500);
    });
  }

  if ($('again')) {
    $('again').addEventListener('click', (event) => {
      event.preventDefault();
      location.reload();
    });
  }
</script>
</body>
</html>`;
};

module.exports = { renderPortal, FIELD_CATALOG };
