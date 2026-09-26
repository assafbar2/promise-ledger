import type { Commitment, ProposedFact, Source } from "../schema";
import { BYO_LIMITS } from "./limits";
import { factObservedAt, type ByoExtraction } from "./extraction";

// Groups: 1 owner, 2 what was promised, 3 date.
const COMMITMENT = /^([A-Z][\p{L}.'-]*(?:\s+[A-Z][\p{L}.'-]*){0,3}):\s*(?:I|We)\s+(?:will|'ll|commit\s+to|promise\s+to|am\s+committing\s+to)\s+(.+?)\s+by\s+(\d{4}-\d{2}-\d{2})\b/u;
// Group 1: the idea.
const TENTATIVE = /\b(?:an?|the)\s+([\p{L}\p{N} -]{3,50}?)\s+(?:would|could|might)\s+be\b.*\bno\s+commitment\b/iu;
const FEATURE = /\bfeature\s*[=:]\s*([a-z0-9][a-z0-9_-]{1,39})\b/i;
const FLAG = (name: string) => new RegExp(String.raw`\b${name}\s*[=:]\s*(true|false|yes|no|on|off|unknown)\b`, "i");

function flag(value: string | undefined) {
  if (!value) return null;
  const lower = value.toLowerCase();
  return lower === "true" || lower === "yes" || lower === "on" ? true : lower === "false" || lower === "no" || lower === "off" ? false : null;
}

function slugify(text: string) {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, "").trim().split(/[\s-]+/).filter(Boolean).slice(0, 4).join("-").slice(0, 40);
}

function titleOf(what: string) {
  const cleaned = what
    .replace(/^(?:make|deliver|ship|enable|provide|launch|roll\s+out|turn\s+on|have)\s+/i, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+(?:available\s+)?(?:to|for|in)\s+[A-Z][\p{L}\p{N}&.' -]*$/u, "")
    .replace(/\s+available$/i, "")
    .trim();
  return (cleaned.charAt(0).toUpperCase() + cleaned.slice(1)).slice(0, 140);
}

function matchFeature(title: string, known: string[]) {
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return known.find((slug) => slug.split("-").every((part) => words.some((word) => word === part || (part.length >= 4 && word.startsWith(part))))) ?? null;
}

function csvFacts(source: Source): { featureId: string; line: string; built: boolean | null; enabled: boolean | null; verified: boolean | null }[] {
  const lines = source.text.split("\n");
  const header = lines.findIndex((line) => /(^|,)\s*feature\s*(,|$)/i.test(line) && /(built|enabled|verified)/i.test(line));
  if (header === -1) return [];
  const columns = lines[header].split(",").map((column) => column.trim().toLowerCase());
  const at = (name: string) => columns.indexOf(name);
  return lines.slice(header + 1).filter((line) => line.trim()).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    return { featureId: slugify(cells[at("feature")] ?? ""), line, built: flag(cells[at("built")]), enabled: flag(cells[at("enabled")]), verified: flag(cells[at("verified")]) };
  }).filter((row) => row.featureId.length >= 2);
}

/**
 * Reference-mode extractor, no AI: finds `feature=… built=… enabled=… verified=…` lines, CSV rows
 * with those columns, "Name: I will … by YYYY-MM-DD" promises and explicitly uncommitted ideas.
 * It misses anything phrased differently; live Nemotron extraction reads free-form text.
 */
export function patternExtract(sources: Source[]): ByoExtraction {
  const facts: ProposedFact[] = [];
  const addFact = (source: Source, featureId: string, quote: string, values: Pick<ProposedFact, "built" | "enabled" | "verified">) => {
    if (facts.length >= BYO_LIMITS.maxFacts || quote.length < 12 || !source.text.includes(quote)) return;
    const existing = facts.findIndex((fact) => fact.featureId === featureId);
    const date = quote.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
    const evidence = [{ sourceId: source.id, quote }];
    const fact: ProposedFact = { id: "", featureId, ...values, observedAt: factObservedAt(date, evidence, [source]), evidence };
    if (existing === -1) facts.push(fact);
    else if (fact.observedAt >= facts[existing].observedAt) facts[existing] = fact;
  };
  for (const source of sources) {
    for (const row of csvFacts(source)) addFact(source, row.featureId, row.line, row);
    for (const line of source.text.split("\n")) {
      const feature = line.match(FEATURE)?.[1];
      if (!feature || ![FLAG("built"), FLAG("enabled"), FLAG("verified")].some((pattern) => pattern.test(line))) continue;
      addFact(source, slugify(feature.replace(/_/g, "-")), line.trim(), { built: flag(line.match(FLAG("built"))?.[1]), enabled: flag(line.match(FLAG("enabled"))?.[1]), verified: flag(line.match(FLAG("verified"))?.[1]) });
    }
  }
  facts.forEach((fact, index) => { fact.id = `F-${index + 1}`; });
  const known = facts.map((fact) => fact.featureId);
  const commitments: Commitment[] = [];
  for (const source of sources) {
    for (const rawLine of source.text.split("\n")) {
      const line = rawLine.trim();
      if (commitments.length >= BYO_LIMITS.maxCommitments || line.length < 12) continue;
      const promise = line.match(COMMITMENT);
      const idea = promise ? null : line.match(TENTATIVE);
      const what = promise?.[2] ?? idea?.[1];
      if (!what) continue;
      const title = titleOf(what);
      const featureId = matchFeature(title, known) ?? slugify(title);
      if (featureId.length < 2 || commitments.some((commitment) => commitment.featureId === featureId)) continue;
      commitments.push({
        id: `C-${commitments.length + 1}`,
        featureId,
        title: title.length >= 3 ? title : featureId,
        owner: promise ? promise[1] : null,
        dueDate: promise ? promise[3] : null,
        intent: promise ? "committed" : "tentative",
        evidence: [{ sourceId: source.id, quote: line }],
      });
    }
  }
  return { commitments, facts, dropped: [] };
}
