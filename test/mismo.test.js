const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseLoan, feesToXml } = require("../src/mismo");
const { mask } = require("../src/mask");

const xml = fs.readFileSync(path.join(__dirname, "..", "fixtures", "loan.xml"), "utf8");

test("parseLoan normalizes MISMO 3.4 XML", () => {
  const loan = parseLoan(xml);
  assert.equal(loan.loanId, "ML-998822");
  assert.equal(loan.milestone, "Underwriting");
  assert.equal(loan.property.city, "Irvine");
  assert.equal(loan.property.postalCode, "92618");
  assert.equal(loan.terms.loanAmount, 450000);
  assert.equal(loan.terms.noteRate, 6.875);
  assert.equal(loan.conditions.length, 2);
  assert.equal(loan.conditions[1].status, "Satisfied");
  assert.equal(loan.fees.length, 2);
  assert.deepEqual(loan.fees[1], { feeType: "SettlementClosingFee", amount: 600, paidTo: "First American Title" });
});

test("mask strips NPI for title and AMC personas", () => {
  const loan = parseLoan(xml);
  const title = mask(loan, "TITLE_VENDOR");
  assert.equal(title.borrower, undefined);
  assert.equal(title.conditions, undefined);
  assert.equal(title.fees.length, 2);
  assert.equal(JSON.stringify(title).includes("123-45-6789"), false);
  assert.equal(JSON.stringify(title).includes("742"), false);

  const amc = mask(loan, "AMC_VENDOR");
  assert.equal(amc.borrower, undefined);
  assert.equal(amc.appraisalContact, "Acme Appraisal Co");
  assert.equal(amc.terms.loanAmount, 450000);
  assert.equal(amc.property.city, "Irvine");
});

test("mask gives brokers borrower identity but never SSN or credit score", () => {
  const broker = mask(parseLoan(xml), "TPO_BROKER");
  assert.equal(broker.borrower.name, "Dana Borrower");
  assert.equal(broker.borrower.email, "dana@example.com");
  assert.equal(broker.borrower.taxpayerIdentifier, undefined);
  assert.equal(broker.borrower.creditScore, undefined);
  assert.equal(broker.lockStatus, "Locked");
  assert.equal(broker.terms.noteRate, 6.875);
});

test("mask fails closed on an unknown role", () => {
  assert.equal(mask({ loanId: "ML-1" }, "UNKNOWN_ROLE"), null);
  assert.equal(mask({ loanId: "ML-1" }, undefined), null);
  assert.deepEqual(mask({ loanId: "ML-1" }, "TPO_BROKER"), { loanId: "ML-1" });
});

test("feesToXml builds a valid MISMO fee update and escapes values", () => {
  const xml = feesToXml("ML-998822", [{ feeType: "TitleLenderCoveragePremium", amount: 1350, paidTo: "A & B <Title>" }]);
  assert.match(xml, /MISMOVersionID="3.4"/);
  assert.match(xml, /<LoanIdentifier>ML-998822<\/LoanIdentifier>/);
  assert.match(xml, /<FeeActualPaymentAmount>1350\.00<\/FeeActualPaymentAmount>/);
  assert.match(xml, /A &amp; B &lt;Title&gt;/);
  assert.equal(parseLoan(xml).fees[0].amount, 1350);
});
