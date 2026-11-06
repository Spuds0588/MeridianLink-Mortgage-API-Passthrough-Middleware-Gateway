/** Zero-build SSR admin portal (single Lambda in AWS, inline HTML locally). */
const renderPortal = () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MeridianLink Gateway — Partner Access</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex items-center justify-center p-6">
  <div class="max-w-xl w-full bg-slate-800 border border-slate-700 rounded-xl p-8 shadow-2xl">
    <div class="mb-6 border-b border-slate-700 pb-4">
      <h1 class="text-2xl font-bold tracking-tight text-white">MeridianLink Mortgage Gateway</h1>
      <p class="text-sm text-slate-400 mt-1">Provision a scoped partner key. Persona masking is enforced on every response.</p>
    </div>

    <div id="form-container" class="space-y-4">
      <div>
        <label class="block text-xs uppercase font-semibold text-slate-400 mb-1" for="tenantName">Partner / Vendor Name</label>
        <input id="tenantName" type="text" placeholder="e.g. First American Title"
          class="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500">
      </div>
      <div>
        <label class="block text-xs uppercase font-semibold text-slate-400 mb-1" for="role">Persona</label>
        <select id="role" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500">
          <option value="TITLE_VENDOR">Title / Settlement — property, terms, fees</option>
          <option value="TPO_BROKER">TPO Broker — 1003, conditions, lock status</option>
          <option value="AMC_VENDOR">Appraisal (AMC) — property, appraisal contact</option>
        </select>
        <p class="text-xs text-slate-500 mt-1">NPI (SSN, credit score, income) is stripped unless the persona allows it.</p>
      </div>
      <button id="btn-submit" onclick="generateKey()"
        class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-lg transition-all">
        Provision API Access
      </button>
    </div>

    <div id="result-box" class="hidden mt-6 bg-slate-950 border border-emerald-500/30 rounded-lg p-5">
      <div class="flex items-center space-x-2 text-emerald-400 mb-3">
        <span class="font-semibold text-sm">Key Provisioned Successfully</span>
      </div>
      <p class="text-xs text-slate-400 mb-2">Copy this key now. It will not be shown again.</p>
      <div class="flex items-center space-x-2 mb-4">
        <input id="out-key" readonly class="w-full bg-slate-900 border border-slate-700 text-yellow-300 font-mono text-sm px-3 py-2 rounded">
        <button onclick="copyKey()" class="bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded text-xs font-semibold">Copy</button>
      </div>
      <label class="block text-xs uppercase font-semibold text-slate-400 mb-1" for="out-curl">Partner Verification cURL</label>
      <pre id="out-curl" class="bg-slate-900 p-3 rounded font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap"></pre>
      <button onclick="resetForm()" class="mt-4 text-xs text-slate-400 hover:text-white underline">Provision another partner</button>
    </div>
  </div>

  <script>
    async function generateKey() {
      const btn = document.getElementById('btn-submit');
      const tenantName = document.getElementById('tenantName').value.trim();
      const role = document.getElementById('role').value;
      if (!tenantName) return alert('Please enter a partner name.');

      btn.disabled = true;
      btn.innerText = 'Provisioning...';
      try {
        const res = await fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantName, role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create key');

        document.getElementById('form-container').classList.add('hidden');
        document.getElementById('result-box').classList.remove('hidden');
        document.getElementById('out-key').value = data.apiKey;
        document.getElementById('out-curl').innerText = data.example.split('$GATEWAY').join(window.location.origin);
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Provision API Access';
      }
    }

    function copyKey() {
      const input = document.getElementById('out-key');
      input.select();
      navigator.clipboard.writeText(input.value);
    }

    function resetForm() {
      document.getElementById('tenantName').value = '';
      document.getElementById('result-box').classList.add('hidden');
      document.getElementById('form-container').classList.remove('hidden');
    }
  </script>
</body>
</html>`;

module.exports = { renderPortal };
