import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ACCOUNT, AS_OF } from "../lib/fixtures";
import { extractionCases } from "./extraction-cases";
import { heldOutCases } from "./held-out-cases";
import type { ExtractionCase } from "./types";

export const datasetHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const developmentCases: ExtractionCase[] = extractionCases.map((sample) => ({ id: `dev-${sample.id}`, category: sample.id, expected: sample.expected ? [{ featureId: "audit-export", ...sample.expected, intent: sample.expected.intent as "committed" | "tentative" }] : [], sources: [{ id: "EVAL-01", accountId: ACCOUNT.id, kind: "Meeting", title: sample.id, author: "Synthetic development evaluation", observedAt: AS_OF, text: sample.text }] }));

/** Throws unless the held-out cases still match the fingerprint frozen before the first live run. */
export async function frozenHeldOutCases() {
  const manifest = JSON.parse(await readFile(new URL("./held-out-manifest.json", import.meta.url), "utf8"));
  if (manifest.sha256 !== datasetHash(heldOutCases)) throw new Error("Held-out dataset changed after freezing. Version and review it before running inference.");
  return heldOutCases;
}
