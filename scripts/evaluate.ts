import { writeFile, mkdir } from "node:fs/promises";
import { ACCOUNT, AS_OF, createScenario, referenceCommitments } from "../lib/fixtures.ts";
import { reconcile } from "../lib/reconcile.ts";

if (process.argv.includes("--live")) throw new Error("Use npm run eval:live for recorded development and held-out model evaluation.");
const cases: { id: string; passed: boolean; expected: unknown; actual: unknown }[] = [];
const expected = { blocked: ["blocked", "on-track", "verified", "overdue", "verify", "discussed"], enabled: ["verified", "on-track", "verified", "overdue", "verify", "discussed"], stale: ["unknown", "on-track", "verified", "overdue", "verify", "discussed"] };
for (const scenario of ["blocked", "enabled", "stale"] as const) {
  const { facts } = createScenario(scenario);
  for (const [index, commitment] of referenceCommitments.entries()) {
    const actual = reconcile(commitment, facts, ACCOUNT.id, AS_OF).verdict;
    cases.push({ id: `${scenario}/${commitment.id}`, passed: actual === expected[scenario][index], expected: expected[scenario][index], actual });
  }
}
const report = { generatedAt: new Date().toISOString(), evaluation: "deterministic-reconciliation-fixtures", liveInferenceTested: false, limitation: "This measures rule correctness on synthetic fixtures, not model extraction quality.", passed: cases.filter((sample) => sample.passed).length, total: cases.length, providers: [], cases };
await mkdir("docs/evaluation", { recursive: true });
await writeFile("docs/evaluation/reference-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.evaluation}: ${report.passed}/${report.total} cases passed. ${report.limitation}`);
if (report.passed !== report.total) process.exitCode = 1;
