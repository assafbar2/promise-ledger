import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Ignored by git (`/outputs/`): every run's working copy, including blocked and partial runs. */
export const SCRATCH_DIRECTORY = "outputs/evaluation";
export const COMMITTED_DIRECTORY = "docs/evaluation";
export const REFERENCE_REPORT = `${COMMITTED_DIRECTORY}/reference-report.json`;

async function writeAtomically(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, contents);
  await rename(`${path}.tmp`, path);
}

const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function withoutTimestamp(report: unknown) {
  if (!report || typeof report !== "object") return report;
  const rest: Record<string, unknown> = { ...(report as Record<string, unknown>) };
  delete rest.generatedAt;
  return rest;
}

/**
 * Always writes the fresh deterministic report to the ignored scratch directory. The committed
 * reference report is rewritten only when something other than its timestamp changed, so a
 * clean checkout stays clean.
 */
export async function writeReferenceReport(report: { generatedAt: string } & Record<string, unknown>, root = ".") {
  const scratchPath = join(root, SCRATCH_DIRECTORY, "reference-report.json");
  const committedPath = join(root, REFERENCE_REPORT);
  await writeAtomically(scratchPath, serialize(report));
  let committed: unknown = null;
  try { committed = JSON.parse(await readFile(committedPath, "utf8")); } catch { committed = null; }
  const changed = JSON.stringify(withoutTimestamp(committed)) !== JSON.stringify(withoutTimestamp(report));
  if (changed) await writeAtomically(committedPath, serialize(report));
  return { scratchPath, committedPath, committedUpdated: changed };
}

export type LiveReportStatus = "blocked" | "partial" | "complete";

/**
 * Live evaluation reports. Checkpoints and blocked or partial runs stay in the ignored scratch
 * directory under a timestamped run folder. Only a complete run (every planned case executed) is
 * copied to `docs/evaluation/runs/<run>/` and becomes `<prefix><suite>-latest.json`; `scratch`
 * runs are never promoted.
 */
export function liveReportWriter(options: { startedAt: string; prefix?: string; root?: string; scratch?: boolean }) {
  const root = options.root ?? ".";
  const prefix = options.prefix ?? "";
  const run = options.startedAt.replace(/[:.]/g, "-");
  const scratchPath = (suite: string) => join(root, SCRATCH_DIRECTORY, "runs", run, `${prefix}${suite}.json`);
  return {
    run,
    scratchPath,
    async checkpoint(suite: string, serialized: string) {
      await writeAtomically(scratchPath(suite), serialized);
    },
    async finish(suite: string, serialized: string, status: LiveReportStatus) {
      await writeAtomically(scratchPath(suite), serialized);
      if (status !== "complete" || options.scratch) return { promoted: false as const, path: scratchPath(suite), latestPath: null };
      const path = join(root, COMMITTED_DIRECTORY, "runs", run, `${prefix}${suite}.json`);
      const latestPath = join(root, COMMITTED_DIRECTORY, `${prefix}${suite}-latest.json`);
      await writeAtomically(path, serialized);
      await writeAtomically(latestPath, serialized);
      return { promoted: true as const, path, latestPath };
    },
  };
}

export function reportStatus(metrics: { executedCases: number; notRun: number }): LiveReportStatus {
  return metrics.executedCases === 0 ? "blocked" : metrics.notRun > 0 ? "partial" : "complete";
}

export function redact(serialized: string, secrets: readonly string[]) {
  let result = serialized;
  for (const secret of secrets.filter((value) => value.length > 0)) result = result.split(secret).join("[REDACTED]");
  return result;
}
