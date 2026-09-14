import type { Commitment, ProductFact, Scenario, Source } from "./schema";

export const AS_OF = "2026-09-13T17:00:00Z";
export const ACCOUNT = { id: "northstar", name: "Northstar", category: "Enterprise workspace", initials: "N" };

const meetingText = `Northstar · weekly customer sync · 2026-09-08
Maya Chen: I will make audit log export available to Northstar by 2026-09-14.
Theo Park: I commit to EU data residency for Northstar by 2026-09-18.
Maya Chen: I will deliver the weekly usage report to Northstar by 2026-09-11.
Customer: A custom dashboard would be interesting. Can we explore that next quarter? No commitment or date agreed.
Jon Bell: I will make SCIM provisioning available to Northstar by 2026-09-16.`;

const baseSources: Source[] = [
  { id: "SRC-01", accountId: ACCOUNT.id, kind: "Meeting", title: "Weekly customer sync", author: "CS + Northstar", observedAt: "2026-09-08T16:00:00Z", text: meetingText },
  { id: "SRC-02", accountId: ACCOUNT.id, kind: "Engineering", title: "ENG-428 · Audit export", author: "Maya Chen", observedAt: "2026-09-13T09:00:00Z", text: "ENG-428 audit log export: implementation complete; built=true. Build 2.14 passed internal CI. Northstar entitlement and customer acceptance are not covered by this ticket." },
  { id: "SRC-03", accountId: ACCOUNT.id, kind: "Availability", title: "Northstar entitlement snapshot", author: "Product telemetry · synthetic", observedAt: "2026-09-13T16:45:00Z", text: "account=northstar; feature=audit-export; built=true; enabled=false; verified=false. The customer-specific audit_export entitlement is disabled." },
  { id: "SRC-04", accountId: ACCOUNT.id, kind: "Support", title: "SUP-819 · Export button missing", author: "Alex Rivera · Northstar", observedAt: "2026-09-13T15:00:00Z", text: "The audit export button is still missing in our Northstar workspace. We cannot export logs for the security review. Please do not mark this delivered." },
  { id: "SRC-05", accountId: ACCOUNT.id, kind: "Availability", title: "Other feature availability", author: "Release service · synthetic", observedAt: "2026-09-13T16:30:00Z", text: "account=northstar; feature=eu-residency; built=false; enabled=false; verified=false.\naccount=northstar; feature=usage-report; built=false; enabled=false; verified=false.\naccount=northstar; feature=scim; built=true; enabled=true; verified=unknown. Northstar has not completed an acceptance test." },
  { id: "SRC-06", accountId: ACCOUNT.id, kind: "Support", title: "SAML acceptance confirmation", author: "Jon Bell + Alex Rivera", observedAt: "2026-09-13T11:00:00Z", text: "Jon Bell: I committed to SAML SSO for Northstar by 2026-09-10. Alex Rivera confirms the Northstar acceptance test passed. account=northstar; feature=saml; built=true; enabled=true; verified=true." },
];

export const referenceCommitments: Commitment[] = [
  { id: "PL-101", featureId: "audit-export", title: "Audit log export", owner: "Maya Chen", dueDate: "2026-09-14", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Maya Chen: I will make audit log export available to Northstar by 2026-09-14." }] },
  { id: "PL-102", featureId: "eu-residency", title: "EU data residency", owner: "Theo Park", dueDate: "2026-09-18", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Theo Park: I commit to EU data residency for Northstar by 2026-09-18." }] },
  { id: "PL-103", featureId: "saml", title: "SAML single sign-on", owner: "Jon Bell", dueDate: "2026-09-10", intent: "committed", evidence: [{ sourceId: "SRC-06", quote: "Jon Bell: I committed to SAML SSO for Northstar by 2026-09-10." }] },
  { id: "PL-104", featureId: "usage-report", title: "Weekly usage report", owner: "Maya Chen", dueDate: "2026-09-11", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Maya Chen: I will deliver the weekly usage report to Northstar by 2026-09-11." }] },
  { id: "PL-105", featureId: "scim", title: "SCIM provisioning", owner: "Jon Bell", dueDate: "2026-09-16", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Jon Bell: I will make SCIM provisioning available to Northstar by 2026-09-16." }] },
  { id: "PL-106", featureId: "dashboard", title: "Custom dashboard", owner: null, dueDate: null, intent: "tentative", evidence: [{ sourceId: "SRC-01", quote: "Customer: A custom dashboard would be interesting. Can we explore that next quarter? No commitment or date agreed." }] },
];

export const FEATURE_IDS = referenceCommitments.map((commitment) => commitment.featureId);

export function createScenario(scenario: Scenario) {
  const sources = structuredClone(baseSources);
  const snapshot = sources.find((source) => source.id === "SRC-03")!;
  if (scenario === "enabled") {
    snapshot.text = "account=northstar; feature=audit-export; built=true; enabled=true; verified=true. Northstar exported an audit log successfully in the acceptance test at 16:50 UTC.";
    snapshot.observedAt = "2026-09-13T16:55:00Z";
  }
  if (scenario === "stale") snapshot.observedAt = "2026-09-07T16:45:00Z";
  const facts: ProductFact[] = [
    { featureId: "audit-export", accountId: ACCOUNT.id, built: true, enabled: scenario === "enabled", verified: scenario === "enabled", observedAt: snapshot.observedAt, evidence: [{ sourceId: "SRC-02", quote: sources[1].text }, { sourceId: snapshot.id, quote: snapshot.text }] },
    ...["eu-residency", "usage-report", "scim"].map((featureId): ProductFact => ({
      featureId, accountId: ACCOUNT.id, built: featureId === "scim", enabled: featureId === "scim", verified: featureId === "scim" ? null : false,
      observedAt: sources[4].observedAt, evidence: [{ sourceId: "SRC-05", quote: sources[4].text.split("\n").find((line) => line.includes(`feature=${featureId};`))! }],
    })),
    { featureId: "saml", accountId: ACCOUNT.id, built: true, enabled: true, verified: true, observedAt: sources[5].observedAt, evidence: [{ sourceId: "SRC-06", quote: sources[5].text }] },
  ];
  return { sources, facts };
}
