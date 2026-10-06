/** Staging password gate — DISABLED on purpose (emergency).
 *  Was leaking onto bb-squad.ru and locking the whole clan out.
 *  Re-enable later only behind staging host + STAGING_GATE_ENABLED=1.
 */
export const STAGING_GATE_COOKIE = "bb_stg_gate";

export function stagingGateEnabled(): boolean {
  return false;
}

/** Host must be staging.* — bb-squad.ru must never show the draft password wall. */
export function isStagingRequestHost(hostHeader: string | null | undefined): boolean {
  const host = String(hostHeader || "")
    .split(":")[0]
    .trim()
    .toLowerCase();
  if (!host) return false;
  return host === "staging.bb-squad.ru" || host.startsWith("staging.");
}

export function stagingGatePassword(): string {
  return (process.env.STAGING_GATE_PASSWORD || "").trim();
}

export function stagingGateSecret(): string {
  return (
    (process.env.STAGING_GATE_SECRET || "").trim() ||
    (process.env.NEXTAUTH_SECRET || "").trim() ||
    "bb-staging-gate-dev"
  );
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return b64url(sig);
}

/** Cookie value valid ~30 days */
export async function createStagingGateToken(
  secret: string,
  ttlSec = 60 * 60 * 24 * 30,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = b64urlJson({ exp, v: 1 });
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyStagingGateToken(
  token: string | undefined | null,
  secret: string,
): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (!payload || !sig) return false;
  const expect = await hmacSign(secret, payload);
  if (expect.length !== sig.length) return false;
  let ok = 0;
  for (let i = 0; i < expect.length; i++) {
    ok |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (ok !== 0) return false;
  try {
    const pad =
      payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const data = JSON.parse(json) as { exp?: number };
    if (!data.exp || data.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// silence unused in case tree-shake
void fromB64url;
