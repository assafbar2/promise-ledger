import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { liveReportWriter, writeReferenceReport } from "../lib/evaluation-reports.ts";

const run = promisify(execFile);
const tsx = import.meta.resolve("tsx");
const script = (name: string) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "promise-ledger-eval-"));
  await mkdir(join(root, "docs/evaluation"), { recursive: true });
  return root;
}

/** Runs a script with no provider credentials in `cwd`; resolves even on a non-zero exit. */
async function runScript(name: string, cwd: string, args: string[] = []) {
  try {
    const { stdout } = await run(process.execPath, ["--import", tsx, script(name), ...args], { cwd, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test" } });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code: number; stdout: string };
    return { code: failed.code, stdout: failed.stdout };
  }
}

test("the committed reference report is only rewritten when results change", async () => {
  const root = await sandbox();
  try {
    const committed = `${JSON.stringify({ generatedAt: "2026-09-19T00:00:00.000Z", passed: 18, total: 18 }, null, 2)}\n`;
    await writeFile(join(root, "docs/evaluation/reference-report.json"), committed);
    const same = await writeReferenceReport({ generatedAt: "2026-09-27T00:00:00.000Z", passed: 18, total: 18 }, root);
    assert.equal(same.committedUpdated, false);
    assert.equal(await readFile(join(root, "docs/evaluation/reference-report.json"), "utf8"), committed);
    assert.match(await readFile(join(root, "outputs/evaluation/reference-report.json"), "utf8"), /2026-09-27/);
    const changed = await writeReferenceReport({ generatedAt: "2026-09-27T00:00:00.000Z", passed: 17, total: 18 }, root);
    assert.equal(changed.committedUpdated, true);
    assert.match(await readFile(join(root, "docs/evaluation/reference-report.json"), "utf8"), /"passed": 17/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("npm run eval leaves the repository's committed reference report byte-for-byte unchanged", async () => {
  const root = await sandbox();
  try {
    const committed = await readFile(new URL("../docs/evaluation/reference-report.json", import.meta.url), "utf8");
    await writeFile(join(root, "docs/evaluation/reference-report.json"), committed);
    const { code, stdout } = await runScript("evaluate.ts", root);
    assert.equal(code, 0);
    assert.match(stdout, /left unchanged/);
    assert.equal(await readFile(join(root, "docs/evaluation/reference-report.json"), "utf8"), committed);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blocked, partial and scratch live runs never replace the latest reports", async () => {
  const root = await sandbox();
  try {
    const latest = join(root, "docs/evaluation/development-latest.json");
    await writeFile(latest, "real september 19 report\n");
    const writer = liveReportWriter({ startedAt: "2026-09-27T01:02:03.456Z", root });
    await writer.checkpoint("development", "checkpoint\n");
    assert.equal((await writer.finish("development", "blocked\n", "blocked")).promoted, false);
    assert.equal((await writer.finish("development", "partial\n", "partial")).promoted, false);
    assert.equal(await readFile(latest, "utf8"), "real september 19 report\n");
    assert.equal(await readFile(join(root, "outputs/evaluation/runs/2026-09-27T01-02-03-456Z/development.json"), "utf8"), "partial\n");
    await assert.rejects(readdir(join(root, "docs/evaluation/runs")));
    const scratch = liveReportWriter({ startedAt: "2026-09-27T01:02:04.000Z", root, scratch: true });
    assert.equal((await scratch.finish("development", "complete\n", "complete")).promoted, false);
    assert.equal(await readFile(latest, "utf8"), "real september 19 report\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only a complete executed run is copied into docs and becomes the latest report", async () => {
  const root = await sandbox();
  try {
    const writer = liveReportWriter({ startedAt: "2026-09-27T01:02:03.456Z", root, prefix: "pipeline-" });
    const saved = await writer.finish("held-out", "complete\n", "complete");
    assert.equal(saved.promoted, true);
    assert.equal(await readFile(join(root, "docs/evaluation/runs/2026-09-27T01-02-03-456Z/pipeline-held-out.json"), "utf8"), "complete\n");
    assert.equal(await readFile(join(root, "docs/evaluation/pipeline-held-out-latest.json"), "utf8"), "complete\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [name, prefix] of [["evaluate-live.ts", ""], ["evaluate-pipeline.ts", "pipeline-"]] as const) {
  test(`${name} without a key writes blocked reports to ignored outputs and keeps the latest reports`, async () => {
    const root = await sandbox();
    try {
      const pointers = ["development", "held-out"].map((suite) => join(root, `docs/evaluation/${prefix}${suite}-latest.json`));
      for (const pointer of pointers) await writeFile(pointer, "executed run\n");
      const { code, stdout } = await runScript(name, root);
      assert.equal(code, 2);
      assert.match(stdout, /No live model score is available/);
      for (const pointer of pointers) assert.equal(await readFile(pointer, "utf8"), "executed run\n");
      assert.deepEqual((await readdir(join(root, "docs/evaluation"))).sort(), pointers.map((pointer) => pointer.split("/").at(-1)).sort());
      const [runFolder] = await readdir(join(root, "outputs/evaluation/runs"));
      for (const suite of ["development", "held-out"]) {
        const report = JSON.parse(await readFile(join(root, "outputs/evaluation/runs", runFolder, `${prefix}${suite}.json`), "utf8"));
        assert.equal(report.status, "blocked");
        assert.equal(report.liveInferenceAttempted, false);
        assert.ok(report.cases.every((sample: { status: string }) => sample.status === "not_run"));
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
