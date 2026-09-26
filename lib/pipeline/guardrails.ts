import { z } from "zod";
import type { AnalyzedCommitment, Claim, Evidence, ReconciledCommitment, Source } from "../schema";

const citationSchema = z.object({ sourceId: z.string().min(1).max(80), quote: z.string().min(12).max(800) }).strict();
const claimSchema = z.object({ text: z.string().min(8).max(500), citations: z.array(citationSchema).min(1).max(4) }).strict();
const briefSchema = z.object({
  commitmentId: z.string().min(1).max(40),
  explanation: z.array(claimSchema).min(1).max(5),
  customerUpdate: z.array(claimSchema).min(1).max(5),
  ownerNudge: z.array(claimSchema).min(1).max(3),
}).strict();

function formatProblem(error: z.ZodError) {
  const issue = error.issues[0];
  const path = issue.path.filter((part) => typeof part === "string").join(".") || "brief";
  if (issue.code === "unrecognized_keys") return `adds fields the format does not allow (${issue.keys.join(", ").slice(0, 60)})`;
  if (issue.code === "too_small" && issue.path.at(-1) === "citations") return "has a claim without citations";
  if (issue.code === "too_small" && issue.path.at(-1) === "quote") return "cites a quote shorter than 12 characters";
  if (issue.code === "too_small" || issue.code === "too_big") return `has ${issue.code === "too_big" ? "too many or too long" : "too few or too short"} entries in ${path}`;
  return `does not match the brief format at ${path}`;
}
export const narrativeOutputSchema = z.object({ briefs: z.array(z.unknown()).max(20) }).strict();

export type Brief = z.infer<typeof briefSchema>;
type Section = "explanation" | "customerUpdate" | "ownerNudge";

const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_INDEX = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const MONTH_DAY = new RegExp(String.raw`\b(${MONTH})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`, "gi");
const DAY_MONTH = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH})\b`, "gi");
const NUMERIC_DATE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
const RELATIVE_TIME = /\b(?:today|tonight|tomorrow|yesterday|(?:next|this|coming)\s+(?:week|month|quarter|sprint|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|end\s+of\s+(?:the\s+)?(?:day|week|month|quarter|year)|eod|eow|eom|eoq|asap|soon|shortly|(?:within|in)\s+(?:a\s+few|a|an|one|two|three|\d+)\s+(?:hours?|days?|weeks?|months?)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|q[1-4])\b/gi;
const NEW_PROMISE = /\b(?:guarantee[sd]?|(?:we|i)\s+promise|(?:we|i)\s+(?:can\s+)?commit|will\s+(?:be\s+)?(?:delivered|deliver|shipped|ship|enabled|enable|released|release|launched|launch|fixed|fix|resolved|resolve|available|live|ready|done|completed?|rolled\s+out|roll\s+out)|(?:we'll|we\s+will)\s+have\s+(?:it|this|that))\b/i;
const DELIVERY_CLAIM = /\b(?:(?:has|have)\s+been\s+(?:delivered|shipped|rolled\s+out)|(?:is|are)\s+(?:now\s+)?(?:live|delivered)\b|successfully\s+(?:delivered|shipped)|(?:fully|now)\s+delivered|delivery\s+(?:is\s+)?(?:complete|confirmed|verified)|verified\s+(?:as\s+)?delivered|you\s+can\s+now\s+use|ready\s+for\s+you\s+to\s+use)/i;
function enabledClaim(accountName: string) {
  const name = accountName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(String.raw`\b(?:(?:has|have)\s+been\s+(?:enabled|turned\s+on|activated)|(?:is|are)\s+(?:now\s+)?(?:enabled|available|turned\s+on|activated)\s+(?:for|in|to)\s+(?:you|your|this\s+customer${name ? `|${name}` : ""}))`, "i");
}
const LINK_OR_CONTACT = /https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const PLACEHOLDER = /\[[A-Z][^\]]{0,40}\]|\{\{|<[a-z]+>/;

function norm(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ");
}

function inQuotes(token: string, quotes: string) {
  return quotes.includes(norm(token));
}

function monthDayInQuotes(month: string, day: string, quotes: string) {
  const index = MONTH_INDEX.indexOf(month.slice(0, 3).toLowerCase()) + 1;
  const iso = `-${String(index).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return quotes.includes(iso);
}

/** Returns the first rule a claim breaks, or null. Pure and deterministic. */
export function claimViolation(claim: Claim, section: Section, commitment: ReconciledCommitment, accountName = "Northstar"): string | null {
  const text = claim.text;
  const quotes = norm(claim.citations.map((citation) => citation.quote).join("\n"));
  for (const match of text.matchAll(ISO_DATE)) if (!inQuotes(match[0], quotes)) return `introduces the date "${match[0]}", which its citations do not contain`;
  for (const match of text.matchAll(MONTH_DAY)) if (!inQuotes(match[0], quotes) && !monthDayInQuotes(match[1], match[2], quotes)) return `introduces the date "${match[0]}", which its citations do not contain`;
  for (const match of text.matchAll(DAY_MONTH)) if (!inQuotes(match[0], quotes) && !monthDayInQuotes(match[2], match[1], quotes)) return `introduces the date "${match[0]}", which its citations do not contain`;
  for (const match of text.matchAll(NUMERIC_DATE)) if (!inQuotes(match[0], quotes)) return `introduces the date "${match[0]}", which its citations do not contain`;
  for (const match of text.matchAll(RELATIVE_TIME)) if (!inQuotes(match[0], quotes)) return `introduces the timeframe "${match[0]}", which its citations do not contain`;
  if (section === "customerUpdate") {
    const promise = text.match(NEW_PROMISE);
    if (promise) return `makes a new promise ("${promise[0]}")`;
  }
  if (commitment.verdict !== "verified") {
    const claimMatch = text.match(DELIVERY_CLAIM);
    if (claimMatch) return `claims delivery ("${claimMatch[0]}") although the verdict is not verified`;
  }
  if (commitment.fact?.enabled !== true) {
    const enabled = text.match(enabledClaim(accountName));
    if (enabled) return `claims customer access ("${enabled[0]}") although it is not enabled`;
  }
  if (LINK_OR_CONTACT.test(text)) return "adds a link or contact address";
  if (PLACEHOLDER.test(text)) return "contains a template placeholder";
  return null;
}

export type BriefDecision = { commitmentId: string; brief: Brief | null; reason: string | null; citations: number };

/**
 * Validates model-written briefs against the deterministic results. The model cannot change a
 * verdict (the output has no verdict field, and delivery or access claims that contradict it are
 * rejected); every claim must cite exact quotes from the evidence supplied for that commitment;
 * new dates, timeframes and promises are rejected. A failing brief falls back to the template.
 */
export function validateBriefs(input: unknown, commitments: ReconciledCommitment[], allowedSources: Map<string, Source[]>, accountName = "Northstar"): BriefDecision[] {
  const { briefs } = narrativeOutputSchema.parse(input);
  const decisions = new Map<string, BriefDecision>();
  for (const raw of briefs) {
    const commitmentId = typeof raw === "object" && raw !== null && "commitmentId" in raw && typeof raw.commitmentId === "string" ? raw.commitmentId : null;
    const commitment = commitments.find((candidate) => candidate.id === commitmentId);
    if (!commitmentId || !commitment || decisions.has(commitmentId)) continue;
    const reject = (reason: string, citations = 0) => decisions.set(commitmentId, { commitmentId, brief: null, reason, citations });
    const parsed = briefSchema.safeParse(raw);
    if (!parsed.success) { reject(formatProblem(parsed.error)); continue; }
    const sources = allowedSources.get(commitmentId) ?? [];
    let reason: string | null = null;
    let citations = 0;
    for (const section of ["explanation", "customerUpdate", "ownerNudge"] as const) {
      for (const claim of parsed.data[section]) {
        for (const citation of claim.citations) {
          const source = sources.find((candidate) => candidate.id === citation.sourceId);
          if (source?.text.includes(citation.quote)) { citations++; continue; }
          const actual = sources.find((candidate) => candidate.text.includes(citation.quote));
          const named = citation.sourceId.slice(0, 40);
          reason ??= actual ? `attributes a quote to ${named} that actually comes from ${actual.id}`
            : source ? `cites a quote that is not exact text from ${named}`
              : `cites ${named}, which is not part of this commitment's evidence`;
        }
        reason ??= claimViolation(claim, section, commitment, accountName);
      }
    }
    if (reason) reject(reason, citations);
    else decisions.set(commitmentId, { commitmentId, brief: parsed.data, reason: null, citations });
  }
  return commitments.map((commitment) => decisions.get(commitment.id) ?? { commitmentId: commitment.id, brief: null, reason: "was not returned by the model", citations: 0 });
}

export function citedEvidence(commitment: AnalyzedCommitment | ReconciledCommitment): Evidence[] {
  return [...commitment.evidence, ...(commitment.fact?.evidence ?? [])];
}
