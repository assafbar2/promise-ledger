export type ParsedEmail = { subject: string | null; from: string | null; date: string | null; body: string };

function splitHeaders(raw: string) {
  const text = raw.replace(/\r\n?/g, "\n");
  const end = text.indexOf("\n\n");
  const head = end === -1 ? text : text.slice(0, end);
  const body = end === -1 ? "" : text.slice(end + 2);
  const headers = new Map<string, string>();
  for (const line of head.replace(/\n[ \t]+/g, " ").split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const name = line.slice(0, colon).trim().toLowerCase();
      if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
    }
  }
  return { headers, body };
}

function bytesToText(bytes: Uint8Array, charset: string) {
  try { return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}

function decodeQuotedPrintable(text: string, charset: string) {
  const joined = text.replace(/=\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < joined.length; index++) {
    const hex = joined.slice(index + 1, index + 3);
    if (joined[index] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); index += 2; }
    else bytes.push(...new TextEncoder().encode(joined[index]));
  }
  return bytesToText(Uint8Array.from(bytes), charset);
}

function decodeBase64(text: string, charset: string) {
  try {
    const binary = atob(text.replace(/[^A-Za-z0-9+/=]/g, ""));
    return bytesToText(Uint8Array.from(binary, (char) => char.charCodeAt(0)), charset);
  } catch { return ""; }
}

// RFC 2047 encoded words in headers, e.g. =?utf-8?Q?Caf=C3=A9?=
function decodeHeader(value: string) {
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, charset: string, encoding: string, data: string) =>
    encoding.toLowerCase() === "b" ? decodeBase64(data, charset) : decodeQuotedPrintable(data.replace(/_/g, " "), charset));
}

function param(header: string, name: string) {
  return header.match(new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, "i"))?.[1]?.trim() ?? "";
}

function stripHtml(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

type Part = { type: string; text: string };

function collectParts(headers: Map<string, string>, body: string, depth: number): Part[] {
  const contentType = headers.get("content-type") ?? "text/plain";
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type.startsWith("multipart/") && depth < 4) {
    const boundary = param(contentType, "boundary");
    if (!boundary) return [];
    const parts: Part[] = [];
    for (const chunk of body.split(`--${boundary}`).slice(1)) {
      if (chunk.startsWith("--")) break;
      const section = splitHeaders(chunk.replace(/^\n/, ""));
      parts.push(...collectParts(section.headers, section.body, depth + 1));
    }
    return parts;
  }
  if (type !== "text/plain" && type !== "text/html") return [];
  if (/attachment/i.test(headers.get("content-disposition") ?? "")) return [];
  const charset = param(contentType, "charset");
  const encoding = (headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const text = encoding === "base64" ? decodeBase64(body, charset) : encoding === "quoted-printable" ? decodeQuotedPrintable(body, charset) : body;
  return [{ type, text }];
}

/**
 * Minimal RFC 5322/MIME reader for .eml files: Subject, From and Date headers plus the first
 * plain-text body (or stripped HTML when no plain part exists). Attachments are ignored and no
 * remote content is ever loaded.
 */
export function parseEml(raw: string): ParsedEmail {
  const { headers, body } = splitHeaders(raw);
  const parts = collectParts(headers, body, 0);
  const plain = parts.find((part) => part.type === "text/plain");
  const html = parts.find((part) => part.type === "text/html");
  const text = plain ? plain.text : html ? stripHtml(html.text) : "";
  const header = (name: string) => { const value = headers.get(name); return value ? decodeHeader(value) : null; };
  const date = header("date");
  const parsedDate = date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null;
  return { subject: header("subject"), from: header("from"), date: parsedDate, body: text.trim() };
}

export function emailAsText(email: ParsedEmail) {
  return [email.from && `From: ${email.from}`, email.subject && `Subject: ${email.subject}`, email.date && `Date: ${email.date}`, "", email.body].filter((line) => line !== null).join("\n").trim();
}
