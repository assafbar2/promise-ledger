import type { PipelineCheck, StepSummary } from "../schema";

/**
 * Signed proof that a live bring-your-own extraction already consumed its one live run. The
 * decide step (rules plus the Ultra narrative) presents it instead of reserving a second run.
 * It binds the exact sources and workspace name, carries the extraction's settled cost so the
 * whole run stays inside one per-run budget, expires, and is single-use (claimed server-side).
 */
export type ContinuationPayload = {
  v: 1;
  runId: string;
  exp: number;
  digest: string;
  model: string | null;
  costUsd: number;
  reservedUsd: number;
  steps: StepSummary[];
  checks: PipelineCheck[];
};

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function continuationSecret(env: Record<string, string | undefined>) {
  const key = (env.NEBIUS_API_KEY ?? "").trim();
  return key ? `promise-ledger-byo-continuation:v1:${key}` : null;
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

export async function signContinuation(payload: ContinuationPayload, secret: string) {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${base64url(await hmac(secret, body))}`;
}

export async function verifyContinuation(token: string, secret: string, nowMs = Date.now()): Promise<ContinuationPayload | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const expected = await hmac(secret, body);
    const supplied = fromBase64url(signature);
    if (supplied.length !== expected.length) return null;
    let difference = 0;
    for (let index = 0; index < expected.length; index++) difference |= supplied[index] ^ expected[index];
    if (difference !== 0) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as ContinuationPayload;
    if (payload.v !== 1 || typeof payload.exp !== "number" || payload.exp * 1000 < nowMs) return null;
    return payload;
  } catch { return null; }
}

/** Keeps the token compact: step details are display text and are trimmed. */
export function compactSteps(steps: StepSummary[]) {
  return steps.map((step) => ({ ...step, detail: step.detail.slice(0, 360) }));
}
