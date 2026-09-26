// Zero-width, bidi-override and other invisible format characters can hide instructions from a
// human reviewer while a model still reads them (for example "Trojan Source" reordering).
const INVISIBLE = /[\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]/g;
// C0/C1 control characters except tab and newline.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Normalizes pasted or uploaded text into plain, visible text. The result is what gets quoted. */
export function sanitizeText(text: string) {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function sanitizeLabel(text: string, maxChars: number) {
  return sanitizeText(text).replace(/\s+/g, " ").slice(0, maxChars).trim();
}
