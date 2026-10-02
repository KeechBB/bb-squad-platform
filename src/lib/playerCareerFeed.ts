import { prisma } from "@/lib/prisma";
import { buildPlayerKvStats, type PlayerKvRound } from "@/lib/kvStats";
import {
  loadRpLedger,
  rpRankFromScore,
  type RpPlayerMatch,
} from "@/lib/trainRp";
import { formatTierArrow } from "@/lib/homeTierBoard";

export type CareerEventKind =
  | "tier_up"
  | "tier_down"
  | "tier_cand_up"
  | "tier_cand_down"
  | "mvp"
  | "best"
  | "good"
  | "note"
  | "rp_rank";

export type CareerEvent = {
  id: string;
  kind: CareerEventKind;
  tone: "up" | "down" | "almost" | "warn" | "mvp" | "best" | "good" | "note" | "rp";
  title: string;
  body?: string;
  at: string; // ISO date or sortable ymd
  atLabel: string;
};

export type PlayerCareerFeed = {
  nick: string;
  events: CareerEvent[];
  updatedAt: string;
};

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://keechbb.github.io/blackberry-kv",
  "https://kv.bb-squad.ru",
].filter(Boolean) as string[];

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function nickEq(a: string, b: string) {
  return nickKey(a) === nickKey(b);
}

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadKvJson(path: string) {
  for (const base of KV_BASES) {
    try {
      return await fetchJson(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
    } catch {
      /* next */
    }
  }
  return null;
}

function ymdLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function sortKeyFromLabel(dateLabel: string, fallbackDay = 0): string {
  // dd.mm.yyyy
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateLabel.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateLabel)) return dateLabel.slice(0, 10);
  if (fallbackDay > 0) return `2026-09-${String(fallbackDay).padStart(2, "0")}`;
  return "1970-01-01";
}

function roundScore(r: PlayerKvRound): number {
  const kd = r.deaths > 0 ? r.kills / r.deaths : r.kills;
  return r.dmg * 0.4 + r.kills * 40 + r.res * 25 + kd * 30;
}

function mvpTitle(type: string, label: string): string {
  const t = type.toLowerCase();
  if (t.includes("medic") || label.toLowerCase().includes("medic")) return "Медаль MVP · Медик";
  if (t.includes("killer") || label.toLowerCase().includes("killer")) return "Медаль MVP · Киллер";
  if (t.includes("damage") || label.toLowerCase().includes("war")) return "Медаль MVP · War";
  if (t.includes("anti")) return "Anti-MVP";
  return label || "Медаль MVP";
}

function buildRpRankEvents(
  matches: RpPlayerMatch[],
  startRp: number,
  step: number,
  radiant3Max: number
): CareerEvent[] {
  // при одной дате сохраняем порядок ledger (как заливали: Gorodok→Mutaha→Fallujah)
  const ordered = [...matches].sort((a, b) => {
    const da = String(a.date || "");
    const db = String(b.date || "");
    if (da !== db) return da.localeCompare(db);
    return 0;
  });
  let rp = startRp;
  let prev = rpRankFromScore(rp, step, radiant3Max);
  const out: CareerEvent[] = [];
  for (const m of ordered) {
    rp += Number(m.net) || 0;
    const next = rpRankFromScore(rp, step, radiant3Max);
    if (next.label !== prev.label) {
      out.push({
        id: `rp-${m.id}-${next.rankKey}`,
        kind: "rp_rank",
        tone: "rp",
        title: `Новый ранг RP · ${next.label}`,
        body: `Было ${prev.label} · сейчас ${Math.round(rp)} RP · ${m.map || "тренировка"}`,
        at: String(m.date || "").slice(0, 10) || "1970-01-01",
        atLabel: ymdLabel(String(m.date || "").slice(0, 10)),
      });
      prev = next;
    }
  }
  return out;
}

export async function buildPlayerCareerFeed(nick: string): Promise<PlayerCareerFeed> {
  const want = String(nick || "").trim();
  if (!want) {
    return { nick: "", events: [], updatedAt: new Date().toISOString() };
  }

  const events: CareerEvent[] = [];
  const key = nickKey(want);

  const [kv, board, rpLedger, tierLogs] = await Promise.all([
    buildPlayerKvStats(want).catch(() => null),
    loadKvJson("data/tier-board.json"),
    loadRpLedger().catch(() => null),
    prisma.tierChangeLog
      .findMany({
        where: { nick: { equals: want, mode: "insensitive" } },
        orderBy: { changedAt: "desc" },
        take: 20,
      })
      .catch(() => [] as Awaited<ReturnType<typeof prisma.tierChangeLog.findMany>>),
  ]);

  // 1) Tier transfers from DB
  for (const row of tierLogs) {
    const dir = row.toTier < row.fromTier ? "up" : "down";
    const at = row.changedAt.toISOString().slice(0, 10);
    events.push({
      id: `tierlog-${row.id}`,
      kind: dir === "up" ? "tier_up" : "tier_down",
      tone: dir === "up" ? "up" : "down",
      title: `Перевод · ${formatTierArrow(row.fromTier, row.toTier)}`,
      body: row.note || undefined,
      at,
      atLabel: ymdLabel(at),
    });
  }

  // Tier board transfers + candidates for this nick
  for (const t of board?.transfers || []) {
    if (!nickEq(String(t.nick || ""), want)) continue;
    const dir = t.dir === "down" || Number(t.toTier) > Number(t.fromTier) ? "down" : "up";
    const at = String(t.at || "").slice(0, 10);
    events.push({
      id: `tb-tr-${t.nick}-${at}-${t.fromTier}-${t.toTier}`,
      kind: dir === "up" ? "tier_up" : "tier_down",
      tone: dir === "up" ? "up" : "down",
      title: `Перевод · ${formatTierArrow(Number(t.fromTier), Number(t.toTier))}`,
      body: t.note ? String(t.note) : undefined,
      at: at || "1970-01-01",
      atLabel: ymdLabel(at || "1970-01-01"),
    });
  }
  for (const c of board?.candidates || []) {
    if (!nickEq(String(c.nick || ""), want)) continue;
    const dir = c.dir === "down" ? "down" : "up";
    const almost = c.band === "almost" || c.band === "warn";
    events.push({
      id: `tb-cand-${c.nick}-${c.toTier}-${c.band}`,
      kind: dir === "up" ? "tier_cand_up" : "tier_cand_down",
      tone: almost ? (dir === "up" ? "almost" : "warn") : dir === "up" ? "almost" : "warn",
      title:
        dir === "up"
          ? `Кандидат ↑ · ${formatTierArrow(Number(c.fromTier), Number(c.toTier))}`
          : `Кандидат ↓ · ${formatTierArrow(Number(c.fromTier), Number(c.toTier))}`,
      body: c.note
        ? String(c.note)
        : `Fit ${Number(c.fit || 0).toFixed(1)}%${c.role ? ` · ${c.role}` : ""}`,
      at: String(c.since || board?.updatedAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      atLabel: ymdLabel(
        String(c.since || board?.updatedAt || "").slice(0, 10) ||
          new Date().toISOString().slice(0, 10)
      ),
    });
  }

  // 2) MVP medals
  if (kv?.awards?.length) {
    for (const a of kv.awards) {
      if (String(a.type || "").toLowerCase().includes("anti")) continue; // glory only
      const at = sortKeyFromLabel(a.dateLabel, a.day);
      events.push({
        id: `mvp-${a.matchId}-${a.round}-${a.type}`,
        kind: "mvp",
        tone: "mvp",
        title: mvpTitle(a.type, a.label),
        body: `vs ${a.opp} · ${a.round?.toUpperCase() || "раунд"} · ${a.dateLabel}`,
        at,
        atLabel: a.dateLabel || ymdLabel(at),
      });
    }
  }

  // 3–5) Best / good / note from CW rounds
  if (kv?.recent?.length) {
    const rounds = [...kv.recent];
    const byDmg = [...rounds].sort((a, b) => b.dmg - a.dmg);
    const byKd = [...rounds].sort((a, b) => {
      const ka = a.deaths > 0 ? a.kills / a.deaths : a.kills;
      const kb = b.deaths > 0 ? b.kills / b.deaths : b.kills;
      return kb - ka;
    });
    const byRes = [...rounds].sort((a, b) => b.res - a.res);

    const pushBest = (r: PlayerKvRound | undefined, kind: string, text: string) => {
      if (!r) return;
      const at = `2026-09-${String(r.day).padStart(2, "0")}`;
      events.push({
        id: `best-${kind}-${r.matchId}-${r.round}`,
        kind: "best",
        tone: "best",
        title: `Лучший показатель · ${kind}`,
        body: text,
        at,
        atLabel: `${String(r.day).padStart(2, "0")}.09.2026`,
      });
    };

    if (byDmg[0] && byDmg[0].dmg >= 400) {
      const r = byDmg[0];
      pushBest(
        r,
        "dmg",
        `${r.dmg} dmg · ${r.map} vs ${r.opp} · ${r.round.toUpperCase()}`
      );
    }
    if (byKd[0]) {
      const r = byKd[0];
      const kd = r.deaths > 0 ? r.kills / r.deaths : r.kills;
      if (kd >= 2 && r.kills >= 5) {
        pushBest(
          r,
          "KD",
          `KD ${kd.toFixed(2)} (${r.kills}/${r.deaths}) · ${r.map} vs ${r.opp}`
        );
      }
    }
    if (byRes[0] && byRes[0].res >= 8) {
      const r = byRes[0];
      pushBest(r, "ресы", `${r.res} ресов · ${r.map} vs ${r.opp} · ${r.round.toUpperCase()}`);
    }

    const good = [...rounds]
      .filter((r) => roundScore(r) >= 280 && (r.kills >= 6 || r.dmg >= 500 || r.res >= 8))
      .sort((a, b) => roundScore(b) - roundScore(a))
      .slice(0, 5);
    for (const r of good) {
      const kd = r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : String(r.kills);
      const at = `2026-09-${String(r.day).padStart(2, "0")}`;
      events.push({
        id: `good-${r.matchId}-${r.round}`,
        kind: "good",
        tone: "good",
        title: "Хорошая игра",
        body: `${r.map} vs ${r.opp} · ${r.round.toUpperCase()} · ${r.kills}/${r.deaths} KD ${kd} · ${r.dmg} dmg${r.res ? ` · ${r.res} res` : ""}`,
        at,
        atLabel: `${String(r.day).padStart(2, "0")}.09.2026`,
      });
    }

    // brief notes: last 4 distinct matches
    const seen = new Set<string>();
    for (const r of rounds) {
      if (seen.has(r.matchId)) continue;
      seen.add(r.matchId);
      if (seen.size > 4) break;
      const siblings = rounds.filter((x) => x.matchId === r.matchId);
      const kills = siblings.reduce((s, x) => s + x.kills, 0);
      const dmg = siblings.reduce((s, x) => s + x.dmg, 0);
      const res = siblings.reduce((s, x) => s + x.res, 0);
      const st =
        r.status === "win" ? "победа" : r.status === "lose" ? "поражение" : r.status || "матч";
      const at = `2026-09-${String(r.day).padStart(2, "0")}`;
      events.push({
        id: `note-${r.matchId}`,
        kind: "note",
        tone: "note",
        title: `${r.map} · vs ${r.opp}`,
        body: `${st} · ${siblings.length} раунд(а) · ${kills} frags · ${dmg} dmg${res ? ` · ${res} res` : ""} · ${r.stack}`,
        at,
        atLabel: `${String(r.day).padStart(2, "0")}.09.2026`,
      });
    }
  }

  // 7) RP rank ups
  if (rpLedger) {
    const player =
      rpLedger.players[key] ||
      Object.values(rpLedger.players).find((p) => nickKey(p.nick) === key);
    if (player?.matches?.length) {
      events.push(
        ...buildRpRankEvents(
          player.matches,
          Number(rpLedger.startRp) || 0,
          Number(rpLedger.step) || 150,
          Number(rpLedger.radiant3Max) || 4500
        )
      );
    }
  }

  // Dedupe by id, sort by date desc, cap
  const uniq = new Map<string, CareerEvent>();
  for (const e of events) {
    if (!uniq.has(e.id)) uniq.set(e.id, e);
  }
  const sorted = [...uniq.values()].sort((a, b) => {
    if (a.at !== b.at) return b.at.localeCompare(a.at);
    return a.title.localeCompare(b.title);
  });

  return {
    nick: want,
    events: sorted.slice(0, 24),
    updatedAt: new Date().toISOString(),
  };
}

export function emptyPlayerCareerFeed(nick = ""): PlayerCareerFeed {
  return { nick, events: [], updatedAt: new Date().toISOString() };
}
