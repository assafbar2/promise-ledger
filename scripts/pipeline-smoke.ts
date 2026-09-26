import { writeFile } from "node:fs/promises";
import { runPipeline } from "../lib/pipeline/run.ts";
import type { Scenario } from "../lib/schema.ts";

// One live pipeline run (up to three Nemotron calls), no retries. Consumes real credit.
const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=") as [string, string]));
const scenario = (args.get("scenario") ?? "blocked") as Scenario;
if (!args.has("confirm")) {
  console.error("This makes up to three real, billed Nebius calls. Re-run with --confirm.");
  process.exit(2);
}
if (!["blocked", "enabled", "stale"].includes(scenario)) throw new Error("Unknown scenario.");

const raw: { model: string; status: number; body: string }[] = [];
const recording: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const model = String(JSON.parse(String(init?.body)).model);
  const [forCaller, forLog] = response.body ? response.body.tee() : [null, null];
  if (forLog) {
    const entry = { model, status: response.status, body: "" };
    raw.push(entry);
    void (async () => {
      const reader = forLog.getReader();
      const decoder = new TextDecoder();
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; entry.body += decoder.decode(value, { stream: true }); } } catch { entry.body += "\n[stream aborted]"; }
    })();
  }
  return new Response(forCaller, { status: response.status, headers: response.headers });
};

const started = Date.now();
try {
  const analysis = await runPipeline({ mode: "live", scenario, fetcher: recording, emit: (event) => {
    if (event.type === "step" && event.step.status !== "running") console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${event.step.label}: ${event.step.status} · ${event.step.reportedModel ?? event.step.model ?? event.step.engine} · ${event.step.latencyMs ?? "-"} ms · ${event.step.usage ? `${event.step.usage.promptTokens} in / ${event.step.usage.completionTokens} out${event.step.usage.reasoningTokens !== null ? ` (${event.step.usage.reasoningTokens} reasoning)` : ""}` : "no usage"} · cost ${event.step.costUsd ?? "-"}\n    ${event.step.detail}`);
    if (event.type === "check") console.log(`    ${event.check.ok ? "✓" : "✕"} ${event.check.label}`);
  } });
  console.log(`\nTotal ${analysis.elapsedMs} ms · usage ${JSON.stringify(analysis.usage)} · estimated cost $${analysis.pipeline.costUsd} of $${analysis.pipeline.budgetUsd} budget`);
  for (const commitment of analysis.commitments) console.log(`\n${commitment.id} ${commitment.verdict} · ${commitment.narrative?.origin ?? "none"}${commitment.narrative?.fallbackReason ? ` (${commitment.narrative.fallbackReason})` : ""}\n  ${commitment.narrative?.customerUpdate.map((claim) => claim.text).join(" ") ?? ""}`);
} catch (error) {
  console.error(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const path = args.get("raw");
  if (path) await writeFile(path, JSON.stringify(raw, null, 2));
}
