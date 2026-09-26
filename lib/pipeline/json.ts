/**
 * JSON mode is proven only on Super. Nano and Ultra output is parsed leniently (code fences or
 * prose around one object are tolerated) and then validated as strictly as extraction output.
 */
export function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("No JSON object in model output.");
}
