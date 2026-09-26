import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT, AS_OF, createScenario, referenceCommitments } from "../lib/fixtures.ts";
import { claimViolation, validateBriefs } from "../lib/pipeline/guardrails.ts";
import { parseModelJson } from "../lib/pipeline/json.ts";
import { narrativeSources, templateNarrative } from "../lib/pipeline/narrative.ts";
import { referenceTriage } from "../lib/pipeline/triage.ts";
import { reconcile } from "../lib/reconcile.ts";
import { AUDIT_EXPORT_BRIEF, briefsFor } from "./helpers/nebius-mock.ts";

function setup(scenario: "blocked" | "enabled" | "stale" = "blocked") {
  const { sources, facts } = createScenario(scenario);
  const commitments = referenceCommitments.map((commitment) => reconcile(commitment, facts, ACCOUNT.id, AS_OF)).filter((commitment) => commitment.intent === "committed");
  const allowed = narrativeSources(commitments, sources, referenceTriage(sources, ["audit-export"]));
  return { sources, commitments, allowed };
}

const blocked = setup().commitments[0];
const verified = setup("enabled").commitments[0];
const promiseQuote = { sourceId: "SRC-01", quote: "Maya Chen: I will make audit log export available to Northstar by 2026-09-14." };
const accessQuote = { sourceId: "SRC-03", quote: "The customer-specific audit_export entitlement is disabled." };
const claim = (text: string, citations = [accessQuote]) => ({ text, citations });

test("accepts grounded briefs and counts exact citations", () => {
  const { commitments, allowed } = setup();
  const decisions = validateBriefs({ briefs: briefsFor({ "PL-101": AUDIT_EXPORT_BRIEF }) }, commitments, allowed);
  assert.equal(decisions.length, 5);
  assert.ok(decisions.every((decision) => decision.brief !== null), JSON.stringify(decisions.map((decision) => decision.reason)));
  assert.equal(decisions[0].citations, 6);
});

test("rejects dates and timeframes that the claim's own citations do not contain", () => {
  for (const text of ["We expect to enable it by 2026-09-20.", "Access is planned for September 20.", "Access is planned for the 20th of September.", "Expect it on 9/20.", "We will look at this tomorrow.", "Access should be ready next week.", "The team will check on Friday.", "It should be sorted soon.", "We aim to finish within 3 days.", "Target is end of the month."]) {
    assert.match(claimViolation(claim(text), "explanation", blocked) ?? "", /introduces the (date|timeframe)/, text);
  }
});

test("allows a date or timeframe that appears in the claim's citations", () => {
  assert.equal(claimViolation(claim("Maya committed to deliver this by 2026-09-14.", [promiseQuote]), "ownerNudge", blocked), null);
  assert.equal(claimViolation(claim("Maya agreed on September 14 as the date.", [promiseQuote]), "ownerNudge", blocked), null);
  assert.equal(claimViolation(claim("The customer asked to explore it next quarter.", [{ sourceId: "SRC-01", quote: "Can we explore that next quarter? No commitment or date agreed." }]), "explanation", blocked), null);
});

test("a date cited by another claim does not license this claim", () => {
  assert.match(claimViolation(claim("It is due 2026-09-14.", [accessQuote]), "explanation", blocked) ?? "", /introduces the date "2026-09-14"/);
});

test("rejects new promises in the customer update only", () => {
  for (const text of ["The export will be enabled shortly after review.", "We guarantee access for the security review.", "We promise to have this done.", "We can commit to enabling it.", "It will be available in your workspace."]) {
    assert.ok(claimViolation(claim(text), "customerUpdate", blocked), text);
  }
  assert.equal(claimViolation(claim("We are enabling access and will confirm with you once an export succeeds."), "customerUpdate", blocked), null);
  assert.equal(claimViolation(claim("Please confirm when the entitlement will be enabled."), "ownerNudge", blocked), null);
});

test("the model cannot upgrade a verdict through its wording", () => {
  for (const text of ["Audit log export has been delivered to Northstar.", "The export is now live.", "Delivery is complete for this item.", "You can now use the export."]) {
    assert.match(claimViolation(claim(text), "customerUpdate", blocked) ?? "", /claims delivery/, text);
    assert.match(claimViolation(claim(text), "explanation", blocked) ?? "", /claims delivery/, text);
  }
  assert.match(claimViolation(claim("The export has been enabled for you."), "customerUpdate", blocked) ?? "", /claims customer access/);
  assert.equal(claimViolation(claim("The export has not been delivered to your workspace yet."), "customerUpdate", blocked), null);
  assert.equal(claimViolation(claim("Audit log export has been delivered and your acceptance test passed.", [{ sourceId: "SRC-03", quote: "Northstar exported an audit log successfully in the acceptance test at 16:50 UTC." }]), "customerUpdate", verified), null);
});

test("rejects links, contact addresses and template placeholders", () => {
  assert.match(claimViolation(claim("See https://evil.example for details."), "customerUpdate", blocked) ?? "", /link/);
  assert.match(claimViolation(claim("Write to help@vendor.example for access."), "customerUpdate", blocked) ?? "", /link or contact/);
  assert.match(claimViolation(claim("Hi [Customer Name], access is pending."), "customerUpdate", blocked) ?? "", /placeholder/);
});

test("rejects fabricated or out-of-scope citations per brief, keeping other briefs", () => {
  const { commitments, allowed } = setup();
  const decisions = validateBriefs({ briefs: briefsFor({
    "PL-101": { explanation: [claim("Engineering says it is done.", [{ sourceId: "SRC-02", quote: "implementation complete and enabled for every customer" }])] },
    "PL-102": { explanation: [claim("The SAML acceptance passed.", [{ sourceId: "SRC-06", quote: "Alex Rivera confirms the Northstar acceptance test passed." }])] },
  }) }, commitments, allowed);
  assert.match(decisions[0].reason ?? "", /not exact text from SRC-02/);
  assert.match(decisions[1].reason ?? "", /SRC-06, which is not part of this commitment's evidence/, "PL-102 may only cite its own evidence sources");
  assert.ok(decisions.slice(2).every((decision) => decision.brief));
});

test("a real quote attributed to the wrong source is named as a misattribution (seen live on September 26)", () => {
  const { commitments, allowed } = setup();
  const decisions = validateBriefs({ briefs: briefsFor({ "PL-103": { explanation: [claim("The owner committed to SAML SSO for Northstar by 2026-09-10.", [{ sourceId: "SRC-01", quote: "I committed to SAML SSO for Northstar by 2026-09-10" }])] } }) }, commitments, new Map([...allowed, ["PL-103", [...(allowed.get("PL-103") ?? []), ...setup().sources.filter((source) => source.id === "SRC-01")]]]));
  assert.match(decisions.find((decision) => decision.commitmentId === "PL-103")?.reason ?? "", /attributes a quote to SRC-01 that actually comes from SRC-06/);
});

test("a verdict field, extra keys, missing citations or missing briefs all fall back", () => {
  const { commitments, allowed } = setup();
  const [first, second, ...rest] = briefsFor();
  const decisions = validateBriefs({ briefs: [{ ...first, verdict: "verified" }, { ...second, customerUpdate: [{ text: "We are checking.", citations: [] }] }, ...rest.slice(1)] }, commitments, allowed);
  assert.match(decisions[0].reason ?? "", /brief format/);
  assert.match(decisions[1].reason ?? "", /brief format/);
  assert.match(decisions[2].reason ?? "", /not returned/);
  assert.throws(() => validateBriefs({ briefs: [], extra: true }, commitments, allowed));
});

test("template narratives cite exact evidence and never contain model output", () => {
  const narrative = templateNarrative(blocked, "Template draft: test reason");
  assert.equal(narrative.origin, "template");
  assert.equal(narrative.fallbackReason, "Template draft: test reason");
  const sources = createScenario("blocked").sources;
  for (const item of [...narrative.explanation, ...narrative.customerUpdate, ...narrative.ownerNudge]) {
    assert.ok(item.citations.length > 0);
    for (const citation of item.citations) assert.ok(sources.find((source) => source.id === citation.sourceId)?.text.includes(citation.quote));
  }
  assert.match(narrative.draftText, /Nothing has been sent/);
});

test("lenient JSON parsing tolerates fences and prose, but not garbage", () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Here you go: {"a":1} Done.'), { a: 1 });
  assert.throws(() => parseModelJson("no json here"));
});
