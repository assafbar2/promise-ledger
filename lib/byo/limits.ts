/**
 * Caps for user-supplied evidence. Text size is measured as the UTF-8 bytes of each text once
 * JSON-encoded, which is how it reaches the model, so quotes, backslashes and non-ASCII text
 * count at their true cost. With these caps the triage and extraction inputs stay under their
 * 16,000-byte step caps (checked in tests), so a BYO run's worst case is the same per-run
 * ceiling as the synthetic pack (see docs/COST_POLICY.md).
 */
export const BYO_LIMITS = {
  maxSources: 8,
  maxSourceBytes: 6000,
  maxTotalBytes: 10000,
  maxTitleChars: 100,
  maxWorkspaceNameChars: 60,
  /** Raw file size before parsing; an .eml with headers may shrink a lot once parsed. */
  maxFileBytes: 200_000,
  maxCommitments: 12,
  maxFacts: 12,
  /** How long a live extraction's confirmation stays valid for its one decide step. */
  continuationTtlSeconds: 30 * 60,
} as const;

export const BYO_FILE_EXTENSIONS = [".txt", ".md", ".csv", ".eml"] as const;
export const BYO_SOURCE_TYPES = ["meeting", "ticket", "chat", "telemetry", "email", "notes"] as const;
export type ByoSourceType = (typeof BYO_SOURCE_TYPES)[number];
export const BYO_SOURCE_TYPE_LABEL: Record<ByoSourceType, string> = { meeting: "Meeting notes", ticket: "Support ticket", chat: "Chat thread", telemetry: "Telemetry lines", email: "Email", notes: "Other notes" };

const encoder = new TextEncoder();

export function encodedBytes(text: string) {
  return encoder.encode(JSON.stringify(text)).length - 2;
}
