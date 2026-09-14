import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT, AS_OF, FEATURE_IDS, createScenario, referenceCommitments } from "../lib/fixtures.ts";
import { draftUpdate, reconcile, validateExtraction } from "../lib/reconcile.ts";
import type { ProductFact } from "../lib/schema.ts";

const base = referenceCommitments[0];
const { sources, facts } = createScenario("blocked");

test("reconciles all six reference commitments without inventing delivery", () => {
  assert.deepEqual(referenceCommitments.map((commitment) => reconcile(commitment, facts, ACCOUNT.id, AS_OF).verdict), ["blocked", "on-track", "verified", "overdue", "verify", "discussed"]);
});

for (const built of [true, false, null]) {
  for (const enabled of [true, false, null]) {
    for (const verified of [true, false, null]) {
      test(`delivery truth table: built=${built}, enabled=${enabled}, verified=${verified}`, () => {
        const fact: ProductFact = { ...facts[0], built, enabled, verified };
        const result = reconcile(base, [fact], ACCOUNT.id, AS_OF);
        assert.equal(result.verdict === "verified", built === true && enabled === true && verified === true);
      });
    }
  }
}

test("customer acceptance, not ticket completion, closes the gap", () => {
  const scenario = createScenario("enabled");
  assert.equal(reconcile(base, scenario.facts, ACCOUNT.id, AS_OF).verdict, "verified");
  assert.equal(reconcile(base, facts, ACCOUNT.id, AS_OF).verdict, "blocked");
});

test("stale telemetry never proves delivery", () => {
  const scenario = createScenario("stale");
  assert.equal(reconcile(base, scenario.facts, ACCOUNT.id, AS_OF).verdict, "unknown");
});

for (const observedAt of ["not-a-date", "2026-09-14T17:00:00Z", "2026-09-01T17:00:00Z"]) {
  test(`invalid freshness fails closed: ${observedAt}`, () => {
    assert.equal(reconcile(base, [{ ...facts[0], built: true, enabled: true, verified: true, observedAt }], ACCOUNT.id, AS_OF).verdict, "unknown");
  });
}

test("freshness boundary is exactly 72 hours", () => {
  assert.equal(reconcile(base, [{ ...facts[0], observedAt: "2026-09-10T17:00:00Z" }], ACCOUNT.id, AS_OF).verdict, "blocked");
  assert.equal(reconcile(base, [{ ...facts[0], observedAt: "2026-09-10T16:59:59Z" }], ACCOUNT.id, AS_OF).verdict, "unknown");
});

test("another customer's enabled feature cannot close this promise", () => {
  assert.equal(reconcile(base, [{ ...facts[0], accountId: "other", enabled: true, verified: true }], ACCOUNT.id, AS_OF).verdict, "unknown");
});

test("due today is not overdue; prior UTC date is overdue", () => {
  const fact = { ...facts[0], built: false, enabled: false, verified: false };
  assert.equal(reconcile({ ...base, dueDate: "2026-09-13" }, [fact], ACCOUNT.id, AS_OF).verdict, "on-track");
  assert.equal(reconcile({ ...base, dueDate: "2026-09-12" }, [fact], ACCOUNT.id, AS_OF).verdict, "overdue");
});

test("an overdue enabled feature still needs acceptance", () => {
  assert.equal(reconcile({ ...base, dueDate: "2026-09-12" }, [{ ...facts[0], enabled: true, verified: null }], ACCOUNT.id, AS_OF).verdict, "overdue");
});

test("tentative discussion is never converted into an overdue promise", () => {
  assert.equal(reconcile({ ...base, intent: "tentative", dueDate: "2020-01-01" }, facts, ACCOUNT.id, AS_OF).verdict, "discussed");
});

test("reference citations match exact source spans", () => {
  assert.deepEqual(validateExtraction({ commitments: referenceCommitments }, sources, ACCOUNT.id, FEATURE_IDS), referenceCommitments);
});

test("fabricated evidence, cross-account sources, owners and dates are rejected", () => {
  const invalid = [
    { ...base, evidence: [{ sourceId: "SRC-99", quote: base.evidence[0].quote }] },
    { ...base, evidence: [{ sourceId: "SRC-01", quote: "Maya Chen promised everything would be ready tomorrow." }] },
    { ...base, owner: "Invented Person" },
    { ...base, dueDate: "2026-10-01" },
    { ...base, dueDate: "2026-02-30" },
    { ...base, featureId: "invented-feature" },
  ];
  for (const commitment of invalid) assert.throws(() => validateExtraction({ commitments: [commitment] }, sources, ACCOUNT.id, FEATURE_IDS));
  assert.throws(() => validateExtraction({ commitments: [base] }, sources.map((source) => ({ ...source, accountId: "other" })), ACCOUNT.id, FEATURE_IDS));
});

test("duplicate features, IDs, extra model fields and bad intent are rejected", () => {
  for (const commitments of [[base, base], [base, { ...base, id: "another" }], [{ ...base, sendEmail: true }], [{ ...base, intent: "definitely" }]]) {
    assert.throws(() => validateExtraction({ commitments }, sources, ACCOUNT.id, FEATURE_IDS));
  }
});

test("draft correction is grounded, non-sending, and does not invent a date", () => {
  const draft = draftUpdate(reconcile(base, facts, ACCOUNT.id, AS_OF));
  assert.match(draft, /not yet available/);
  assert.match(draft, /Nothing has been sent/);
  assert.match(draft, /does not create a new delivery date/);
  assert.doesNotMatch(draft, /tomorrow|next week|2026-09-15/);
  assert.doesNotMatch(draft, /earlier status|should not have described|previously told/);
});

test("scenario mutations cannot contaminate other reference runs", () => {
  createScenario("enabled").sources[0].text = "changed";
  assert.match(createScenario("blocked").sources[0].text, /weekly customer sync/);
  assert.match(createScenario("blocked").sources[2].text, /enabled=false/);
});
