const PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:(?:the|your|previous|prior|above|earlier|system)\s+){1,3}(?:instructions?|prompts?|rules?|messages?)/i,
  /\b(?:note|message|instructions?)\s+(?:to|for)\s+(?:any|the)\s+(?:ai|assistant|model|llm|agent)\b/i,
  /\byou\s+are\s+now\b|\bact\s+as\s+(?:an?\s+)?(?:system|admin|developer)\b/i,
  /\b(?:system|developer)\s+prompt\b|<\/?\s*(?:system|assistant|instructions?)\s*>/i,
  /\bmark\s+(?:this|it|\w+(?:\s+\w+){0,3})\s+as\s+(?:verified|delivered|done|complete)/i,
  /\b(?:reveal|print|show|leak)\s+(?:your|the)\s+(?:system\s+prompt|instructions|api\s+key|secrets?)/i,
];

/**
 * Deterministic flag for text that addresses an AI system. It never blocks or rewrites evidence:
 * sources stay data either way, and the flag is shown to the reviewer next to the source.
 */
export function detectInjection(text: string): string | null {
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/\s+/g, " ").slice(0, 80);
  }
  return null;
}
