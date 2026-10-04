import { prisma } from "@/lib/prisma";
import { buildPlayerKvStats, type PlayerKvRound } from "@/lib/kvStats";
import {
  loadRpLadder,
  rpRankFromScore,
  type RpPlayerMatch,
} from "@/lib/trainRp";
import { loadPublicRpLadder, loadPublicRpLedger } from "@/lib/publicRp";
import { pickMvps } from "@/lib/homeMvp";
import { formatTierArrow } from "@/lib/homeTierBoard";

function countStat(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (Array.isArray(v)) return v.length;
  return 0;
}

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

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function nickEq(a: string, b: string) {
  return nickKey(a) === nickKey(b);
}

type TierBoardJson = {
  updatedAt?: string;
  transfers?: {
    nick?: string;
    dir?: string;
    fromTier?: number;
    toTier?: number;
    at?: string;
    note?: string;
  }[];
  candidates?: {
    nick?: string;
    dir?: string;
    fromTier?: number;
    toTier?: number;
    band?: string;
    fit?: number;
    role?: string;
    since?: string;
    note?: string;
  }[];
};

async function loadKvJson<T>(path: string): Promise<T | null> {
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  return loadKvJsonCached<T>(path.replace(/^\//, ""));
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
  radiant3Max: number,
  opts?: { idPrefix?: string; venue?: string }
): CareerEvent[] {
  const idPrefix = opts?.idPrefix || "rp";
  const venue = opts?.venue || "тренировка";
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
        id: `${idPrefix}-${m.id}-${next.rankKey}`,
        kind: "rp_rank",
        tone: "rp",
        title: `Новый ранг RP · ${next.label}`,
        body: `Было ${prev.label} · сейчас ${Math.round(rp)} RP · ${m.map || venue} · ${venue}`,
        at: String(m.date || "").slice(0, 10) || "1970-01-01",
        atLabel: ymdLabel(String(m.date || "").slice(0, 10)),
      });
      prev = next;
    }
  }
  return out;
}

function pubRoundScore(m: {
  kills: number;
  deaths: number;
  dmg: number;
  res: number;
}): number {
  const kd = m.deaths > 0 ? m.kills / m.deaths : m.kills;
  return m.dmg * 0.05 + m.kills * 40 + m.res * 25 + kd * 30;
}

export async function buildPlayerCareerFeed(nick: string): Promise<PlayerCareerFeed> {
  const want = String(nick || "").trim();
  if (!want) {
    return { nick: "", events: [], updatedAt: new Date().toISOString() };
  }

  const events: CareerEvent[] = [];
  const key = nickKey(want);

  const [kv, board, rpLedger, pubLedger, tierLogs] = await Promise.all([
    buildPlayerKvStats(want).catch(() => null),
    loadKvJson<TierBoardJson>("data/tier-board.json"),
    loadRpLadder().catch(() => null),
    loadPublicRpLadder()
      .then((d) => d || loadPublicRpLedger())
      .catch(() => null),
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

  // 7) RP rank ups — тренировки (slim ladder: net per match is enough)
  if (rpLedger) {
    const player =
      rpLedger.players[key] ||
      Object.values(rpLedger.players).find((p) => nickKey(p.nick) === key);
    if (player?.matches?.length) {
      const asRpMatches = player.matches.map((m) => ({
        id: m.id,
        map: m.map,
        date: m.date,
        net: m.net,
        kills: [] as RpPlayerMatch["kills"],
        deaths: [] as RpPlayerMatch["deaths"],
      }));
      events.push(
        ...buildRpRankEvents(
          asRpMatches,
          Number(rpLedger.startRp) || 0,
          Number(rpLedger.step) || 150,
          Number(rpLedger.radiant3Max) || 4500,
          { idPrefix: "rp-train", venue: "тренировка" }
        )
      );
    }
  }

  // 8) Паблик PB1 — ранги RP, MVP, лучшие/хорошие катки, заметки
  if (pubLedger?.players) {
    const pubPlayer =
      pubLedger.players[key] ||
      Object.values(pubLedger.players).find((p) => nickKey(p.nick) === key);

    if (pubPlayer?.matches?.length) {
      events.push(
        ...buildRpRankEvents(
          pubPlayer.matches,
          Number(pubLedger.startRp) || 1000,
          Number(pubLedger.step) || 150,
          Number(pubLedger.radiant3Max) || 4500,
          { idPrefix: "rp-pub", venue: "паблик PB1" }
        )
      );

      type PubSnap = {
        id: string;
        map: string;
        date: string;
        kills: number;
        deaths: number;
        res: number;
        nok: number;
        dmg: number;
        won: boolean | null;
        net: number;
      };
      const snaps: PubSnap[] = pubPlayer.matches.map((m) => ({
        id: m.id,
        map: m.map || "PB1",
        date: String(m.date || "").slice(0, 10),
        kills: countStat(m.kills),
        deaths: countStat(m.deaths),
        res: countStat(m.revives),
        nok: countStat(m.noks),
        dmg: Math.round(Number(m.dmg) || 0),
        won: m.won ?? null,
        net: Number(m.net) || 0,
      }));

      const byDmg = [...snaps].sort((a, b) => b.dmg - a.dmg);
      const byKd = [...snaps].sort((a, b) => {
        const ka = a.deaths > 0 ? a.kills / a.deaths : a.kills;
        const kb = b.deaths > 0 ? b.kills / b.deaths : b.kills;
        return kb - ka;
      });
      const byRes = [...snaps].sort((a, b) => b.res - a.res);
      const byNet = [...snaps].sort((a, b) => b.net - a.net);

      if (byDmg[0] && byDmg[0].dmg >= 800) {
        const r = byDmg[0];
        events.push({
          id: `pub-best-dmg-${r.id}`,
          kind: "best",
          tone: "best",
          title: "Лучший показатель · урон (PB1)",
          body: `${r.dmg} dmg · ${r.map} · ${r.kills} килов`,
          at: r.date || "1970-01-01",
          atLabel: ymdLabel(r.date || "1970-01-01"),
        });
      }
      if (byKd[0]) {
        const r = byKd[0];
        const kd = r.deaths > 0 ? r.kills / r.deaths : r.kills;
        if (kd >= 2 && r.kills >= 5) {
          events.push({
            id: `pub-best-kd-${r.id}`,
            kind: "best",
            tone: "best",
            title: "Лучший показатель · KD (PB1)",
            body: `KD ${kd.toFixed(2)} (${r.kills}/${r.deaths}) · ${r.map}`,
            at: r.date || "1970-01-01",
            atLabel: ymdLabel(r.date || "1970-01-01"),
          });
        }
      }
      if (byRes[0] && byRes[0].res >= 5) {
        const r = byRes[0];
        events.push({
          id: `pub-best-res-${r.id}`,
          kind: "best",
          tone: "best",
          title: "Лучший показатель · ресы (PB1)",
          body: `${r.res} ресов · ${r.map}`,
          at: r.date || "1970-01-01",
          atLabel: ymdLabel(r.date || "1970-01-01"),
        });
      }
      if (byNet[0] && byNet[0].net >= 80) {
        const r = byNet[0];
        events.push({
          id: `pub-best-net-${r.id}`,
          kind: "best",
          tone: "best",
          title: "Лучший показатель · RP за катку",
          body: `${r.net > 0 ? "+" : ""}${Math.round(r.net)} RP · ${r.map}`,
          at: r.date || "1970-01-01",
          atLabel: ymdLabel(r.date || "1970-01-01"),
        });
      }

      const good = [...snaps]
        .filter(
          (r) =>
            pubRoundScore(r) >= 220 &&
            (r.kills >= 5 || r.dmg >= 1000 || r.res >= 4 || r.net >= 60)
        )
        .sort((a, b) => pubRoundScore(b) - pubRoundScore(a))
        .slice(0, 6);
      for (const r of good) {
        const kd =
          r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : String(r.kills);
        const st =
          r.won === true ? "победа" : r.won === false ? "поражение" : "катка";
        events.push({
          id: `pub-good-${r.id}`,
          kind: "good",
          tone: "good",
          title: "Хорошая игра · PB1",
          body: `${r.map} · ${st} · ${r.kills}/${r.deaths} KD ${kd} · ${r.dmg} dmg${r.res ? ` · ${r.res} res` : ""} · ${r.net >= 0 ? "+" : ""}${Math.round(r.net)} RP`,
          at: r.date || "1970-01-01",
          atLabel: ymdLabel(r.date || "1970-01-01"),
        });
      }

      // заметки по последним каткам
      const recentNotes = [...snaps]
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
        .slice(0, 6);
      for (const r of recentNotes) {
        const st =
          r.won === true ? "победа" : r.won === false ? "поражение" : "катка";
        events.push({
          id: `pub-note-${r.id}`,
          kind: "note",
          tone: "note",
          title: `${r.map} · PB1`,
          body: `${st} · ${r.kills} килов · ${r.deaths} смертей · ${r.dmg} dmg${r.res ? ` · ${r.res} res` : ""} · ${r.net >= 0 ? "+" : ""}${Math.round(r.net)} RP`,
          at: r.date || "1970-01-01",
          atLabel: ymdLabel(r.date || "1970-01-01"),
        });
      }
    }

    // MVP по каждой катке паблика (из статы всех игроков матча)
    const byMatch = new Map<
      string,
      {
        date: string;
        map: string;
        rows: {
          nick: string;
          res: number;
          nok: number;
          kills: number;
          deaths: number;
          dmg: number;
        }[];
      }
    >();
    for (const p of Object.values(pubLedger.players)) {
      const nick = String(p.nick || "").trim();
      if (!nick) continue;
      for (const m of p.matches || []) {
        if (!m?.id) continue;
        if (!byMatch.has(m.id)) {
          byMatch.set(m.id, {
            date: String(m.date || "").slice(0, 10),
            map: m.map || "PB1",
            rows: [],
          });
        }
        byMatch.get(m.id)!.rows.push({
          nick,
          res: countStat(m.revives),
          nok: countStat(m.noks),
          kills: countStat(m.kills),
          deaths: countStat(m.deaths),
          dmg: Math.round(Number(m.dmg) || 0),
        });
      }
    }
    for (const [mid, pack] of byMatch) {
      const mvp = pickMvps(pack.rows);
      const at = pack.date || "1970-01-01";
      const bump = (list: string[] | undefined, type: string, label: string) => {
        for (const n of list || []) {
          if (!nickEq(n, want)) continue;
          if (type === "anti") continue;
          events.push({
            id: `pub-mvp-${mid}-${type}`,
            kind: "mvp",
            tone: "mvp",
            title: mvpTitle(type, label),
            body: `PB1 · ${pack.map} · ${ymdLabel(at)}`,
            at,
            atLabel: ymdLabel(at),
          });
        }
      };
      bump(mvp.medic, "medic", "MVP Medic");
      bump(mvp.killer, "killer", "MVP Killer");
      bump(mvp.damage, "damage", "MVP War-Score");
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
    events: sorted.slice(0, 36),
    updatedAt: new Date().toISOString(),
  };
}

export function emptyPlayerCareerFeed(nick = ""): PlayerCareerFeed {
  return { nick, events: [], updatedAt: new Date().toISOString() };
}
