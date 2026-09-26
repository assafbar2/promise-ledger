import { AS_OF } from "../fixtures";
import { buildPack } from "./build";

const meeting = `Ridgeway Freight · onboarding steering call · 2026-09-09
Sam Okafor: I will deliver carrier webhook retries to Ridgeway Freight by 2026-09-12.
Grace Liu: I commit to raising the Ridgeway Freight API rate limit to 2,000 requests per minute by 2026-09-15.
Sam Okafor: I will make customs document OCR available to Ridgeway Freight by 2026-09-19.
Grace Liu: I will deliver driver app offline mode to Ridgeway Freight by 2026-10-01.
Customer: An AI route optimizer would be exciting. Maybe we can scope it next year? No commitment or date agreed.`;

const slack = `#ridgeway-shared · Slack thread · 2026-09-13
Marta Silva (Ridgeway): Webhook retries look great. Three carriers replayed failed events overnight.
Grace Liu: The 2,000 requests per minute limit is switched on for Ridgeway. Can you confirm your batch job no longer gets 429 errors?
Marta Silva (Ridgeway): We haven't rerun the batch job yet.`;

const rateLimits = `account=ridgeway-freight; feature=rate-limit; built=true; enabled=true; verified=unknown. Gateway quota set to 2000 rpm; no customer load test recorded.
account=ridgeway-freight; feature=driver-offline; built=false; enabled=false; verified=false.`;

const verifiedWebhooks = "account=ridgeway-freight; feature=carrier-webhooks; built=true; enabled=true; verified=true. Ridgeway replayed 312 failed carrier events successfully during acceptance.";

export const ridgewayFreight = buildPack({
  id: "ridgeway-freight",
  name: "Ridgeway Freight",
  initials: "R",
  industry: "Logistics platform",
  situation: "A rate-limit increase is switched on but untested, and an engineering ticket is the only word on OCR. Enabled is not accepted.",
  headlineFeatureId: "carrier-webhooks",
  defaultScenario: "enabled",
  asOf: AS_OF,
  sources: [
    { id: "SRC-01", kind: "Meeting", title: "Onboarding steering call", author: "CS + Ridgeway Freight", observedAt: "2026-09-09T17:00:00Z", text: meeting },
    { id: "SRC-02", kind: "Support", title: "#ridgeway-shared Slack thread", author: "Marta Silva + Grace Liu", observedAt: "2026-09-13T10:20:00Z", text: slack },
    { id: "SRC-03", kind: "Availability", title: "Webhook delivery snapshot", author: "Event gateway · synthetic", observedAt: "2026-09-13T16:10:00Z", text: verifiedWebhooks },
    { id: "SRC-04", kind: "Availability", title: "Gateway configuration", author: "Platform service · synthetic", observedAt: "2026-09-13T15:30:00Z", text: rateLimits },
    { id: "SRC-05", kind: "Engineering", title: "ENG-3302 · Customs OCR", author: "Sam Okafor", observedAt: "2026-09-12T11:00:00Z", text: "ENG-3302 customs document OCR: 91% field accuracy on the Ridgeway sample set; still in QA. No customer rollout has started." },
  ],
  headline: {
    sourceId: "SRC-03",
    scenarios: {
      blocked: { text: "account=ridgeway-freight; feature=carrier-webhooks; built=true; enabled=false; verified=false. Webhook retries are disabled for the Ridgeway tenant.", observedAt: "2026-09-13T16:10:00Z", built: true, enabled: false, verified: false },
      enabled: { text: verifiedWebhooks, observedAt: "2026-09-13T16:10:00Z", built: true, enabled: true, verified: true },
      stale: { text: verifiedWebhooks, observedAt: "2026-09-06T16:10:00Z", built: true, enabled: true, verified: true },
    },
  },
  facts: [
    { featureId: "rate-limit", sourceId: "SRC-04", quote: "account=ridgeway-freight; feature=rate-limit; built=true; enabled=true; verified=unknown. Gateway quota set to 2000 rpm; no customer load test recorded.", built: true, enabled: true, verified: null },
    { featureId: "driver-offline", sourceId: "SRC-04", quote: "account=ridgeway-freight; feature=driver-offline; built=false; enabled=false; verified=false.", built: false, enabled: false, verified: false },
  ],
  referenceCommitments: [
    { id: "PL-301", featureId: "carrier-webhooks", title: "Carrier webhook retries", owner: "Sam Okafor", dueDate: "2026-09-12", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Sam Okafor: I will deliver carrier webhook retries to Ridgeway Freight by 2026-09-12." }] },
    { id: "PL-302", featureId: "rate-limit", title: "API rate limit at 2,000 requests/min", owner: "Grace Liu", dueDate: "2026-09-15", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Grace Liu: I commit to raising the Ridgeway Freight API rate limit to 2,000 requests per minute by 2026-09-15." }] },
    { id: "PL-303", featureId: "customs-ocr", title: "Customs document OCR", owner: "Sam Okafor", dueDate: "2026-09-19", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Sam Okafor: I will make customs document OCR available to Ridgeway Freight by 2026-09-19." }] },
    { id: "PL-304", featureId: "driver-offline", title: "Driver app offline mode", owner: "Grace Liu", dueDate: "2026-10-01", intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Grace Liu: I will deliver driver app offline mode to Ridgeway Freight by 2026-10-01." }] },
    { id: "PL-305", featureId: "route-optimizer", title: "AI route optimizer", owner: null, dueDate: null, intent: "tentative", evidence: [{ sourceId: "SRC-01", quote: "Customer: An AI route optimizer would be exciting. Maybe we can scope it next year? No commitment or date agreed." }] },
  ],
});
