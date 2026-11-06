/** Persona schema masking: deny by default, allow only the listed JSON paths. */
const ALLOWLISTS = {
  TITLE_VENDOR: [
    "loanId", "milestone",
    "property.street", "property.city", "property.state", "property.postalCode",
    "terms.loanAmount", "terms.noteRate", "terms.estimatedClosingDate",
    "fees"
  ],
  TPO_BROKER: ["loanId", "milestone", "property", "terms", "borrower.name", "borrower.email", "conditions", "lockStatus"],
  AMC_VENDOR: ["loanId", "milestone", "property", "appraisalContact", "terms.loanType", "terms.loanAmount"]
};

const get = (obj, path) => path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), obj);
const set = (obj, path, value) => {
  const keys = path.split(".");
  const leaf = keys.pop();
  const target = keys.reduce((node, key) => (node[key] ??= {}), obj);
  target[leaf] = value;
  return obj;
};

/** Returns the masked loan, or null when the role has no allowlist (fail closed). */
const mask = (loan, role) => {
  const allow = ALLOWLISTS[role];
  if (!allow) return null;
  return allow
    .filter((path) => get(loan, path) != null)
    .reduce((out, path) => set(out, path, get(loan, path)), {});
};

module.exports = { mask, ALLOWLISTS };
