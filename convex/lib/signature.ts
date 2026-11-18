// HMAC-SHA256 signing shared by both directions of the n8n integration.
//
// Signed message: `${timestamp}.${method}.${path}.${body}`
// Headers:        X-LendLoop-Timestamp (unix seconds), X-LendLoop-Signature (hex)
//
// Binding method and path stops a valid signature for one endpoint being
// replayed against another; the timestamp window limits replay in time.

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function signedMessage(timestamp: string, method: string, path: string, body: string) {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Constant-time comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  nowMs = Date.now(),
) {
  const timestamp = Math.floor(nowMs / 1000).toString();
  const signature = await hmacHex(secret, signedMessage(timestamp, method, path, body));
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifyRequest(
  secret: string | undefined,
  args: {
    method: string;
    path: string;
    body: string;
    timestamp: string | null;
    signature: string | null;
    nowMs?: number;
  },
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: "server secret not configured" };
  if (!args.timestamp || !args.signature) return { ok: false, reason: "missing signature headers" };
  if (!/^\d+$/.test(args.timestamp)) return { ok: false, reason: "bad timestamp" };
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(args.timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp outside allowed window" };
  }
  const expected = await hmacHex(
    secret,
    signedMessage(args.timestamp, args.method, args.path, args.body),
  );
  return safeEqual(expected, args.signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
