/** A provider failure whose message is safe to show; other errors are reported generically. */
export class EvidenceError extends Error {
  constructor(message: string, public providerId: string) { super(message); }
}
