import { writeFile, mkdir } from "node:fs/promises";
import { ACCOUNT, AS_OF, createScenario, referenceCommitments } from "../lib/fixtures.ts";
import { reconcile } from "../lib/reconcile.ts";
import { extractWithNebius } from "../lib/nebius.ts";
import { extractionCases } from "../evals/extraction-cases.ts";

const live = process.argv.includes("--live");
const cases: { id: string; passed: boolean; expected: unknown; actual: unknown }[] = [];
const providers: { model: string; runId: string; usage: unknown }[] = [];
if (live) {
  if (!process.env.NEBIUS_API_KEY || !process.env.NEBIUS_MODEL) throw new Error("Live evaluation requires NEBIUS_API_KEY and NEBIUS_MODEL. No scores were generated.");
  for (const sample of extractionCases) {
    const result = await extractWithNebius([{ id: "EVAL-01", accountId: ACCOUNT.id, kind: "Meeting", title: sample.id, author: "Synthetic evaluation", observedAt: AS_OF, text: sample.text }]);
    const prediction = result.commitments.find((commitment) => commitment.featureId === "audit-export");
    const actual = prediction ? { intent: prediction.intent, owner: prediction.owner, dueDate: prediction.dueDate } : null;
    cases.push({ id: sample.id, passed: JSON.stringify(actual) === JSON.stringify(sample.expected), expected: sample.expected, actual });
    providers.push({ model: result.model, runId: result.runId, usage: result.usage });
  }
} else {
  const expected = { blocked: ["blocked", "on-track", "verified", "overdue", "verify", "discussed"], enabled: ["verified", "on-track", "verified", "overdue", "verify", "discussed"], stale: ["unknown", "on-track", "verified", "overdue", "verify", "discussed"] };
  for (const scenario of ["blocked", "enabled", "stale"] as const) {
    const { facts } = createScenario(scenario);
    for (const [index, commitment] of referenceCommitments.entries()) {
      const actual = reconcile(commitment, facts, ACCOUNT.id, AS_OF).verdict;
      cases.push({ id: `${scenario}/${commitment.id}`, passed: actual === expected[scenario][index], expected: expected[scenario][index], actual });
    }
  }
}
const report = { generatedAt: new Date().toISOString(), evaluation: live ? "live-nebius-development-set" : "deterministic-reconciliation-fixtures", liveInferenceTested: live, limitation: live ? "Eight development examples, not independent held-out evidence or production accuracy." : "This measures rule correctness on synthetic fixtures, not model extraction quality.", passed: cases.filter((sample) => sample.passed).length, total: cases.length, providers, cases };
await mkdir("docs/evaluation", { recursive: true });
await writeFile(`docs/evaluation/${live ? "live" : "reference"}-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.evaluation}: ${report.passed}/${report.total} cases passed. ${report.limitation}`);
if (report.passed !== report.total) process.exitCode = 1;
