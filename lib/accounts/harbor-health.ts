import { AS_OF } from "../fixtures";
import { buildPack } from "./build";

const meeting = `Harbor Health · quarterly business review · 2026-09-02
Priya Nair: I will make FHIR patient-record export available to Harbor Health by 2026-09-12.
Daniel Osei: I commit to the HIPAA access audit trail for Harbor Health by 2026-09-09.
Priya Nair: I will deliver Epic single sign-on to Harbor Health by 2026-09-08.
Lena Ortiz: I will deliver the uptime SLA dashboard to Harbor Health by 2026-09-25.
Customer: Custom consent forms could help our clinics. Could we explore that later this year? No commitment or date agreed.`;

const availability = `account=harbor-health; feature=hipaa-audit-trail; built=false; enabled=false; verified=false.
account=harbor-health; feature=epic-sso; built=true; enabled=true; verified=true. Harbor Health clinicians signed in through Epic during the acceptance test.
account=harbor-health; feature=sla-dashboard; built=false; enabled=false; verified=false.`;

const verifiedExport = "account=harbor-health; feature=fhir-export; built=true; enabled=true; verified=true. Harbor Health exported a test patient bundle in the acceptance run.";

export const harborHealth = buildPack({
  id: "harbor-health",
  name: "Harbor Health",
  initials: "H",
  industry: "Healthcare network",
  situation: "The export looked delivered, but its only proof is five days old. Old telemetry cannot prove today's access.",
  headlineFeatureId: "fhir-export",
  defaultScenario: "stale",
  asOf: AS_OF,
  sources: [
    { id: "SRC-01", kind: "Meeting", title: "Quarterly business review", author: "CS + Harbor Health", observedAt: "2026-09-02T15:00:00Z", text: meeting },
    { id: "SRC-02", kind: "Engineering", title: "ENG-771 · FHIR bulk export", author: "Priya Nair", observedAt: "2026-09-11T10:00:00Z", text: "ENG-771 FHIR patient-record export: shipped to production in release 5.3; built=true. The Harbor Health tenant rollout is tracked separately." },
    { id: "SRC-03", kind: "Availability", title: "Harbor Health entitlement snapshot", author: "Product telemetry · synthetic", observedAt: "2026-09-08T14:00:00Z", text: verifiedExport },
    { id: "SRC-04", kind: "Support", title: "SUP-2207 · Audit trail still missing", author: "Compliance team · Harbor Health", observedAt: "2026-09-12T13:30:00Z", text: "The HIPAA access audit trail is still not visible for our tenant. Our external auditor needs it, so please share a realistic date rather than a hopeful one." },
    { id: "SRC-05", kind: "Availability", title: "Other feature availability", author: "Release service · synthetic", observedAt: "2026-09-13T16:00:00Z", text: availability },
  ],
  headline: {
    sourceId: "SRC-03",
    supportingSourceId: "SRC-02",
    scenarios: {
      blocked: { text: "account=harbor-health; feature=fhir-export; built=true; enabled=false; verified=false. The Harbor Health tenant flag fhir_bulk_export is off.", observedAt: "2026-09-13T16:40:00Z", built: true, enabled: false, verified: false },
      enabled: { text: verifiedExport, observedAt: "2026-09-13T16:40:00Z", built: true, enabled: true, verified: true },
      stale: { text: verifiedExport, observedAt: "2026-09-08T14:00:00Z", built: true, enabled: true, verified: true },
    },
  },
  facts: [
    { featureId: "hipaa-audit-trail", sourceId: "SRC-05", quote: "account=harbor-health; feature=hipaa-audit-trail; built=false; enabled=false; verified=false.", built: false, enabled: false, verified: false },
    { featureId: "epic-sso", sourceId: "SRC-05", quote: "account=harbor-health; feature=epic-sso; built=true; enabled=true; verified=true. Harbor Health clinicians signed in through Epic during the acceptance test.", built: true, enabled: true, verified: true },
    { featureId: "sla-dashboard", sourceId: "SRC-05", quote: "account=harbor-health; feature=sla-dashboard; built=false; enabled=false; verified=false.", built: false, enabled: false, verified: false },
  ],
  referenceCommitments: [
    { id: "PL-201", featureId: "fhir-export", title: "FHIR patient-record export", owner: "Priya Nair", dueDate: "2026-09-12", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Priya Nair: I will make FHIR patient-record export available to Harbor Health by 2026-09-12." }] },
    { id: "PL-202", featureId: "hipaa-audit-trail", title: "HIPAA access audit trail", owner: "Daniel Osei", dueDate: "2026-09-09", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Daniel Osei: I commit to the HIPAA access audit trail for Harbor Health by 2026-09-09." }] },
    { id: "PL-203", featureId: "epic-sso", title: "Epic single sign-on", owner: "Priya Nair", dueDate: "2026-09-08", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Priya Nair: I will deliver Epic single sign-on to Harbor Health by 2026-09-08." }] },
    { id: "PL-204", featureId: "sla-dashboard", title: "Uptime SLA dashboard", owner: "Lena Ortiz", dueDate: "2026-09-25", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Lena Ortiz: I will deliver the uptime SLA dashboard to Harbor Health by 2026-09-25." }] },
    { id: "PL-205", featureId: "consent-forms", title: "Custom consent forms", owner: null, dueDate: null, intent: "tentative", evidence: [{ sourceId: "SRC-01", quote: "Customer: Custom consent forms could help our clinics. Could we explore that later this year? No commitment or date agreed." }] },
  ],
});
