import type { Source } from "../schema";
import { BYO_LIMITS, BYO_SOURCE_TYPE_LABEL, encodedBytes } from "./limits";
import { sanitizeLabel, sanitizeText } from "./sanitize";
import type { ByoSourceInput } from "./schema";

export class ByoInputError extends Error {}

export const BYO_ACCOUNT = "byo";
export const DEFAULT_WORKSPACE_NAME = "Your customer";

export function workspaceName(value: string | undefined) {
  return sanitizeLabel(value ?? "", BYO_LIMITS.maxWorkspaceNameChars).replace(/[^\p{L}\p{N} .,&'()/-]/gu, "").trim() || DEFAULT_WORKSPACE_NAME;
}

export function normalizeByoSource(input: ByoSourceInput): ByoSourceInput {
  return { ...input, title: sanitizeLabel(input.title, BYO_LIMITS.maxTitleChars) || input.id, text: sanitizeText(input.text), observedAt: new Date(input.observedAt).toISOString() };
}

export function byoUsage(inputs: Pick<ByoSourceInput, "text">[]) {
  const perSource = inputs.map((input) => encodedBytes(input.text));
  return { sources: inputs.length, totalBytes: perSource.reduce((total, bytes) => total + bytes, 0), perSource };
}

/** Enforces the BYO caps on already-normalized sources. Messages are safe to show the user. */
export function checkByoSources(inputs: ByoSourceInput[]) {
  if (inputs.length === 0) throw new ByoInputError("Add at least one source.");
  if (inputs.length > BYO_LIMITS.maxSources) throw new ByoInputError(`Use at most ${BYO_LIMITS.maxSources} sources.`);
  const ids = new Set<string>();
  for (const input of inputs) {
    if (ids.has(input.id)) throw new ByoInputError(`Source ${input.id} appears twice.`);
    ids.add(input.id);
    if (!input.text) throw new ByoInputError(`${input.id} is empty after removing hidden characters.`);
    if (encodedBytes(input.text) > BYO_LIMITS.maxSourceBytes) throw new ByoInputError(`${input.id} is longer than ${BYO_LIMITS.maxSourceBytes.toLocaleString("en-US")} bytes.`);
  }
  const { totalBytes } = byoUsage(inputs);
  if (totalBytes > BYO_LIMITS.maxTotalBytes) throw new ByoInputError(`Your sources total ${totalBytes.toLocaleString("en-US")} bytes; the limit is ${BYO_LIMITS.maxTotalBytes.toLocaleString("en-US")}.`);
}

export function toSource(input: ByoSourceInput, fetchedAt: string): Source {
  return { id: input.id, accountId: BYO_ACCOUNT, kind: "UserSupplied", title: input.title, author: `${BYO_SOURCE_TYPE_LABEL[input.type]} · supplied by you`, observedAt: input.observedAt, text: input.text, provenance: { fetchedAt, recorded: false } };
}

/** Stable digest of exactly what was extracted from, binding a decide step to its extraction. */
export async function sourcesDigest(inputs: ByoSourceInput[], name: string) {
  const canonical = JSON.stringify({ name, sources: inputs.map(({ id, type, title, observedAt, text }) => [id, type, title, observedAt, text]) });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
