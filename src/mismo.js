/** Zero-dependency MISMO 3.4 <-> vendor JSON translation (src/mismo.js). */
const escapeXml = (value) => String(value).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
const tag = (xml, name) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1].trim() ?? null;
const blocks = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => m[1]);
const num = (raw) => { const n = Number(raw); return raw == null || raw === "" || Number.isNaN(n) ? null : n; };

const parseLoan = (xml) => ({
  loanId: tag(xml, "LoanIdentifier") ?? "UNKNOWN",
  milestone: tag(xml, "CurrentMilestoneName") ?? "Processing",
  property: {
    street: tag(xml, "AddressLineText"),
    city: tag(xml, "CityName"),
    state: tag(xml, "StateCode"),
    postalCode: tag(xml, "PostalCode"),
    legalDescription: tag(xml, "LegalDescription")
  },
  terms: {
    loanAmount: num(tag(xml, "LoanAmount")),
    noteRate: num(tag(xml, "NoteRatePercent")),
    estimatedClosingDate: tag(xml, "EstimatedClosingDate"),
    loanType: tag(xml, "LoanType")
  },
  borrower: {
    name: tag(xml, "FullName"),
    email: tag(xml, "BorrowerEmailAddress"),
    taxpayerIdentifier: tag(xml, "TaxpayerIdentifier"),
    creditScore: num(tag(xml, "CreditScoreValue"))
  },
  appraisalContact: tag(xml, "AppraisalContactName"),
  lockStatus: tag(xml, "RateLockStatus"),
  conditions: blocks(xml, "CONDITION").map((c) => ({ description: tag(c, "ConditionDescription"), status: tag(c, "ConditionStatus") })),
  fees: blocks(xml, "FEE").map((f) => ({ feeType: tag(f, "FeeType"), amount: num(tag(f, "FeeActualPaymentAmount")), paidTo: tag(f, "FeePaidToName") }))
});

const feesToXml = (loanId, fees) => `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE MISMOVersionID="3.4" xmlns="http://www.mismo.org/residential/2009/schemas">
  <DEAL_SETS><DEAL_SET><DEALS><DEAL><LOANS><LOAN>
    <LOAN_IDENTIFIERS><LOAN_IDENTIFIER><LoanIdentifier>${escapeXml(loanId)}</LoanIdentifier></LOAN_IDENTIFIER></LOAN_IDENTIFIERS>
    <FEES>${fees.map((fee) => `
      <FEE><FEE_DETAIL>
        <FeeType>${escapeXml(fee.feeType)}</FeeType>
        <FeeActualPaymentAmount>${Number(fee.amount).toFixed(2)}</FeeActualPaymentAmount>
        <FeePaidToName>${escapeXml(fee.paidTo ?? "")}</FeePaidToName>
      </FEE_DETAIL></FEE>`).join("")}
    </FEES>
  </LOAN></LOANS></DEAL></DEALS></DEAL_SET></DEAL_SETS>
</MESSAGE>`;

module.exports = { parseLoan, feesToXml, escapeXml };
