"use client";

import type { RpPlayer } from "@/lib/trainRp";

export type RpLedgerKind = "public" | "train";

type Entry = {
  at: number;
  player: RpPlayer | null;
  pending?: Promise<RpPlayer | null>;
};

const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, Entry>();

function key(kind: RpLedgerKind, nick: string) {
  return `${kind}:${String(nick || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")}`;
}

function apiPath(kind: RpLedgerKind, nick: string) {
  const q = encodeURIComponent(nick);
  return kind === "public"
    ? `/api/public/rp-player?nick=${q}`
    : `/api/train/rp-player?nick=${q}`;
}

/** Синхронный hit — для мгновенного открытия модалки. */
export function peekRpPlayer(
  kind: RpLedgerKind,
  nick: string
): RpPlayer | null | undefined {
  const clean = String(nick || "").trim();
  if (!clean) return undefined;
  const k = key(kind, clean);
  const hit = store.get(k);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(k);
    return undefined;
  }
  // пока идёт первый fetch — hit.player может быть null без «готового» ответа
  if (hit.pending && hit.at === 0) return undefined;
  if (hit.pending && hit.player == null) return undefined;
  return hit.player;
}

/** Загрузка с дедупом inflight + RAM-кэш на вкладку. */
export function loadRpPlayer(
  kind: RpLedgerKind,
  nick: string
): Promise<RpPlayer | null> {
  const clean = String(nick || "").trim();
  if (!clean) return Promise.resolve(null);
  const k = key(kind, clean);
  const now = Date.now();
  const hit = store.get(k);
  if (hit && now - hit.at < TTL_MS) {
    if (hit.pending) return hit.pending;
    return Promise.resolve(hit.player);
  }
  if (hit?.pending) return hit.pending;

  const pending = (async () => {
    const res = await fetch(apiPath(kind, clean), {
      // позволяем браузеру уважать Cache-Control API (5 мин)
      credentials: "same-origin",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error || res.statusText || "HTTP error"
      );
    }
    const j = (await res.json()) as { player: RpPlayer | null };
    const player = j.player ?? null;
    store.set(k, { at: Date.now(), player });
    return player;
  })().catch((err: unknown) => {
    const cur = store.get(k);
    if (cur?.pending === pending) store.delete(k);
    throw err;
  });

  store.set(k, { at: now, player: hit?.player ?? null, pending });
  return pending.then((player) => {
    store.set(k, { at: Date.now(), player });
    return player;
  });
}

/** Фоновый прогрев — ошибки глотаем. */
export function prefetchRpPlayer(kind: RpLedgerKind, nick: string) {
  const clean = String(nick || "").trim();
  if (!clean) return;
  const existing = peekRpPlayer(kind, clean);
  if (existing !== undefined) return;
  void loadRpPlayer(kind, clean).catch(() => {
    /* ignore */
  });
}

/** Прогрев списка (TOP рейтинга) с паузой между запросами. */
export function prefetchRpPlayerList(
  kind: RpLedgerKind,
  nicks: string[],
  limit = 25
) {
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const n of nicks) {
    const t = String(n || "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(t);
    if (uniq.length >= limit) break;
  }
  let i = 0;
  const tick = () => {
    if (i >= uniq.length) return;
    prefetchRpPlayer(kind, uniq[i++]);
    if (i < uniq.length) {
      setTimeout(tick, 120);
    }
  };
  const w = typeof window !== "undefined" ? window : null;
  if (w && "requestIdleCallback" in w) {
    (
      w as Window & {
        requestIdleCallback: (
          cb: () => void,
          opts?: { timeout: number }
        ) => number;
      }
    ).requestIdleCallback(() => tick(), { timeout: 2000 });
  } else {
    setTimeout(tick, 400);
  }
}
