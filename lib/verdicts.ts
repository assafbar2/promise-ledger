import type { Verdict } from "./schema";

export const VERDICTS: Record<Verdict, { label: string; className: string }> = {
  blocked: { label: "Delivery gap", className: "danger" },
  overdue: { label: "Overdue", className: "warning" },
  verify: { label: "Needs verification", className: "warning" },
  "on-track": { label: "In progress", className: "neutral" },
  verified: { label: "Verified delivered", className: "success" },
  discussed: { label: "Not a promise", className: "muted" },
  unknown: { label: "Evidence needed", className: "warning" },
};
