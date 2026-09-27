import type { Evidence, Source } from "../schema";
import { resolveQuote } from "./guardrails";

const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
const SOURCE_FIRST = new RegExp(String.raw`\{\s*"sourceId"\s*:\s*${STRING}\s*,\s*"quote"\s*:\s*${STRING}\s*\}`, "g");
const QUOTE_FIRST = new RegExp(String.raw`\{\s*"quote"\s*:\s*${STRING}\s*,\s*"sourceId"\s*:\s*${STRING}\s*\}`, "g");

function decode(raw: string) {
  try { return JSON.parse(`"${raw}"`) as string; } catch { return null; }
}

export type ScannedQuote = Evidence & { matched: boolean };

/**
 * Finds complete {sourceId, quote} objects in partial streamed JSON so citations can be shown as
 * the model writes them. Each is checked for exact presence in its source. This is a live preview;
 * final acceptance still comes from full-output validation.
 */
export function createQuoteScanner(sources: Source[], accountId: string) {
  const seen = new Set<string>();
  return (content: string): ScannedQuote[] => {
    const found: ScannedQuote[] = [];
    const visit = (sourceId: string | null, quote: string | null) => {
      if (sourceId === null || quote === null) return;
      const key = `${sourceId}\u0000${quote}`;
      if (seen.has(key)) return;
      seen.add(key);
      const source = sources.find((candidate) => candidate.id === sourceId && candidate.accountId === accountId);
      found.push({ sourceId, quote, matched: Boolean(source && quote.length >= 12 && resolveQuote(source, quote)) });
    };
    for (const match of content.matchAll(SOURCE_FIRST)) visit(decode(match[1]), decode(match[2]));
    for (const match of content.matchAll(QUOTE_FIRST)) visit(decode(match[2]), decode(match[1]));
    return found;
  };
}
