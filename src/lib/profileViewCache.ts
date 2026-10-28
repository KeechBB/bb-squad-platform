/**
 * Client-side shared cache for /api/profile/view-data.
 * One network round-trip for all slots; sessionStorage for instant repaint.
 */
"use client";

export type ProfileViewBundle = {
  trainPwr?: unknown;
  publicSummary?: unknown;
  training?: unknown;
  publicAtt?: unknown;
  cwAtt?: unknown;
  stats?: unknown;
  histories?: unknown;
};

const SS_KEY = "bb_profile_view_v6";
const inflight = new Map<string, Promise<ProfileViewBundle | null>>();
const mem = new Map<string, { at: number; data: ProfileViewBundle }>();
const MEM_TTL_MS = 90_000;

function nickKey(nick: string) {
  return String(nick || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

type SsEnvelope = { at: number; data: ProfileViewBundle };

function readSs(nick: string): ProfileViewBundle | null {
  try {
    const raw = sessionStorage.getItem(`${SS_KEY}:${nickKey(nick)}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SsEnvelope | ProfileViewBundle;
    if (
      parsed &&
      typeof parsed === "object" &&
      "at" in parsed &&
      "data" in parsed
    ) {
      if (Date.now() - Number(parsed.at) > MEM_TTL_MS) return null;
      return parsed.data;
    }
    // legacy bare bundle — drop (could mark «не был» after midnight)
    return null;
  } catch {
    return null;
  }
}

function writeSs(nick: string, data: ProfileViewBundle) {
  try {
    const env: SsEnvelope = { at: Date.now(), data };
    sessionStorage.setItem(`${SS_KEY}:${nickKey(nick)}`, JSON.stringify(env));
  } catch {
    /* quota */
  }
}

/** Sync peek — for useState initializer (instant paint from last visit). */
export function peekProfileView(nick: string): ProfileViewBundle | null {
  const k = nickKey(nick);
  if (!k) return null;
  const hit = mem.get(k);
  if (hit && Date.now() - hit.at < MEM_TTL_MS) return hit.data;
  if (typeof window === "undefined") return null;
  return readSs(nick);
}

/** Single shared fetch of part=all; coalesces parallel slot mounts. */
export function loadProfileView(
  nick: string,
  opts?: { force?: boolean }
): Promise<ProfileViewBundle | null> {
  const k = nickKey(nick);
  if (!k) return Promise.resolve(null);

  if (!opts?.force) {
    const hit = mem.get(k);
    if (hit && Date.now() - hit.at < MEM_TTL_MS) {
      return Promise.resolve(hit.data);
    }
    const pending = inflight.get(k);
    if (pending) return pending;
  }

  const job = (async (): Promise<ProfileViewBundle | null> => {
    try {
      const res = await fetch(
        `/api/profile/view-data?part=all&nick=${encodeURIComponent(nick)}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return peekProfileView(nick);
      const data = (await res.json()) as ProfileViewBundle;
      mem.set(k, { at: Date.now(), data });
      writeSs(nick, data);
      return data;
    } catch {
      return peekProfileView(nick);
    } finally {
      inflight.delete(k);
    }
  })();

  inflight.set(k, job);
  return job;
}

/** Kick off without awaiting — call as soon as nick is known. */
export function prefetchProfileView(nick: string) {
  if (!nickKey(nick)) return;
  void loadProfileView(nick);
}

/** Сброс кэша после выходного/резерва — календарь подтянет свежие дни. */
export function invalidateProfileView(nick: string) {
  const k = nickKey(nick);
  if (!k) return;
  mem.delete(k);
  inflight.delete(k);
  try {
    sessionStorage.removeItem(`${SS_KEY}:${k}`);
  } catch {
    /* ignore */
  }
}
