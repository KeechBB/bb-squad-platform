import { prisma } from "@/lib/prisma";
import { buildPlayerKvStats, type PlayerKvRound } from "@/lib/kvStats";
import {
  loadRpLadder,
  rpRankFromScore,
  withTrainMatchTimes,
  type RpPlayerMatch,
} from "@/lib/trainRp";
import { sortRpMatchesOldestFirst } from "@/lib/rpMatchSort";
import { loadPublicRpLadder } from "@/lib/publicRp";
import { pickMvps } from "@/lib/homeMvp";
import { formatTierArrow } from "@/lib/homeTierBoardUi";
import {
  BP_LEVELS,
  BP_REWARDS,
  BP_SEASON,
} from "@/lib/battlePass";
import {
  battlePassLeaderboard,
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";

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
  | "rp_rank"
  | "bp"
  | "bp_level"
  | "bp_reward"
  | "win"
  | "loss"
  | "record";

export type CareerTone =
  | "up"
  | "down"
  | "almost"
  | "warn"
  | "mvp"
  | "best"
  | "good"
  | "note"
  | "rp"
  | "bp"
  | "bp_level"
  | "bp_reward"
  | "win"
  | "loss"
  | "record";

export type CareerEvent = {
  id: string;
  kind: CareerEventKind;
  tone: CareerTone;
  title: string;
  body?: string;
  at: string; // ISO date or sortable ymd
  atLabel: string;
};

export type PlayerCareerFeed = {
  nick: string;
  events: CareerEvent[];
  updatedAt: string;
  /** Окно ленты (дней) */
  windowDays: number;
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

function todayYmdMsk(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function sortKeyFromLabel(dateLabel: string, fallbackDay = 0): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateLabel.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateLabel)) return dateLabel.slice(0, 10);
  if (fallbackDay > 0) {
    const ty = todayYmdMsk();
    return `${ty.slice(0, 8)}${String(fallbackDay).padStart(2, "0")}`;
  }
  return "1970-01-01";
}

function roundScore(r: PlayerKvRound): number {
  const kd = r.deaths > 0 ? r.kills / r.deaths : r.kills;
  return r.dmg * 0.4 + r.kills * 40 + r.res * 25 + kd * 30;
}

function mvpTitle(type: string, label: string): string {
  const t = type.toLowerCase();
  if (t.includes("medic") || label.toLowerCase().includes("medic"))
    return "Медаль MVP · Медик";
  if (t.includes("killer") || label.toLowerCase().includes("killer"))
    return "Медаль MVP · Киллер";
  if (t.includes("damage") || label.toLowerCase().includes("war"))
    return "Медаль MVP · War";
  if (t.includes("anti")) return "Anti-MVP";
  return label || "Медаль MVP";
}

function buildRpRankEvents(
  matches: RpPlayerMatch[],
  startRp: number,
  step: number,
  radiant3Max: number,
  opts?: { idPrefix?: string; venue?: string; cutoff?: string }
): CareerEvent[] {
  const idPrefix = opts?.idPrefix || "rp";
  const venue = opts?.venue || "тренировка";
  const cutoff = opts?.cutoff;
  const ordered = sortRpMatchesOldestFirst(matches);
  let rp = startRp;
  let prev = rpRankFromScore(rp, step, radiant3Max);
  const out: CareerEvent[] = [];
  for (const m of ordered) {
    rp += Number(m.net) || 0;
    const next = rpRankFromScore(rp, step, radiant3Max);
    const at = String(m.date || "").slice(0, 10) || "1970-01-01";
    if (next.label !== prev.label) {
      if (!cutoff || at >= cutoff) {
        out.push({
          id: `${idPrefix}-${m.id}-${next.rankKey}`,
          kind: "rp_rank",
          tone: "rp",
          title: `Новый ранг RP · ${next.label}`,
          body: `Было ${prev.label} · сейчас ${Math.round(rp)} RP · ${m.map || venue} · ${venue}`,
          at,
          atLabel: ymdLabel(at),
        });
      }
      prev = next;
    }
  }
  return out;
}

function pubRoundScore(m: {
  kills: number;
  deaths: number;
  res: number;
  net?: number;
}): number {
  const kd = m.deaths > 0 ? m.kills / m.deaths : m.kills;
  return m.kills * 40 + m.res * 25 + kd * 30 + Math.max(0, Number(m.net) || 0) * 0.3;
}

const WINDOW_DAYS = 7;

export async function buildPlayerCareerFeed(nick: string): Promise<PlayerCareerFeed> {
  const want = String(nick || "").trim();
  if (!want) {
    return {
      nick: "",
      events: [],
      updatedAt: new Date().toISOString(),
      windowDays: WINDOW_DAYS,
    };
  }

  const events: CareerEvent[] = [];
  const key = nickKey(want);
  const today = todayYmdMsk();
  const cutoff = addDaysYmd(today, -(WINDOW_DAYS - 1));

  const [kv, board, rpLedger, pubLedger, tierLogs, bpState] = await Promise.all([
    buildPlayerKvStats(want).catch(() => null),
    loadKvJson<TierBoardJson>("data/tier-board.json"),
    loadRpLadder().catch(() => null),
    loadPublicRpLadder().catch(() => null),
    prisma.tierChangeLog
      .findMany({
        where: {
          nick: { equals: want, mode: "insensitive" },
          changedAt: { gte: new Date(`${cutoff}T00:00:00.000Z`) },
        },
        orderBy: { changedAt: "desc" },
        take: 30,
      })
      .catch(() => [] as Awaited<ReturnType<typeof prisma.tierChangeLog.findMany>>),
    loadBattlePassState().catch(() => null),
  ]);

  const inWindow = (at: string) => {
    const d = String(at || "").slice(0, 10);
    return d >= cutoff && d <= today;
  };

  // ——— Battle Pass ———
  if (bpState?.enabled) {
    const prog = progressForNick(bpState, want);
    const lb = battlePassLeaderboard(bpState);
    const place = lb.findIndex((r) => nickEq(r.nick, want)) + 1;
    const lvlMeta = BP_LEVELS.find((l) => l.level === prog.currentLevel);
    const bpAt = String(bpState.updatedAt || today).slice(0, 10) || today;

    events.push({
      id: `bp-status-${prog.currentLevel}-${prog.current}`,
      kind: "bp",
      tone: "bp",
      title: prog.completedAt
        ? `Battle Pass · сезон закрыт (ур. ${prog.currentLevel})`
        : `Battle Pass · ур. ${prog.currentLevel}${lvlMeta ? ` · ${lvlMeta.title}` : ""}`,
      body: [
        BP_SEASON.subtitle,
        prog.completedAt
          ? "Все 20 уровней пройдены"
          : `${prog.current}/${prog.target} ${lvlMeta?.unit || ""} · ${lvlMeta?.task || "задание"}`,
        place > 0 ? `место в топе #${place}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      at: bpAt,
      atLabel: ymdLabel(bpAt),
    });

    if (!prog.completedAt && prog.currentLevel > 1) {
      const prev = BP_LEVELS.find((l) => l.level === prog.currentLevel - 1);
      events.push({
        id: `bp-level-${prog.currentLevel}`,
        kind: "bp_level",
        tone: "bp_level",
        title: `Battle Pass · открыт ур. ${prog.currentLevel}`,
        body: prev
          ? `После «${prev.title}» · сейчас: ${lvlMeta?.task || "—"}`
          : lvlMeta?.task || undefined,
        at: bpAt,
        atLabel: ymdLabel(bpAt),
      });
    }

    for (const reward of BP_REWARDS) {
      if (!(prog.completedAt || prog.currentLevel >= reward.level)) continue;
      events.push({
        id: `bp-reward-${reward.id}`,
        kind: "bp_reward",
        tone: "bp_reward",
        title: `Награда BP · ${reward.name}`,
        body: `ур. ${reward.level} · ${reward.short} · ${reward.preview}`,
        at: bpAt,
        atLabel: ymdLabel(bpAt),
      });
    }
  }

  // 1) Tier transfers from DB (already filtered by cutoff in query)
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

  for (const t of board?.transfers || []) {
    if (!nickEq(String(t.nick || ""), want)) continue;
    const at = String(t.at || "").slice(0, 10);
    if (!inWindow(at)) continue;
    const dir = t.dir === "down" || Number(t.toTier) > Number(t.fromTier) ? "down" : "up";
    events.push({
      id: `tb-tr-${t.nick}-${at}-${t.fromTier}-${t.toTier}`,
      kind: dir === "up" ? "tier_up" : "tier_down",
      tone: dir === "up" ? "up" : "down",
      title: `Перевод · ${formatTierArrow(Number(t.fromTier), Number(t.toTier))}`,
      body: t.note ? String(t.note) : undefined,
      at: at || cutoff,
      atLabel: ymdLabel(at || cutoff),
    });
  }
  for (const c of board?.candidates || []) {
    if (!nickEq(String(c.nick || ""), want)) continue;
    const at =
      String(c.since || board?.updatedAt || "").slice(0, 10) || today;
    // кандидаты актуальны — показываем в окне всегда как статус
    const dir = c.dir === "down" ? "down" : "up";
    const almost = c.band === "almost" || c.band === "warn";
    events.push({
      id: `tb-cand-${c.nick}-${c.toTier}-${c.band}`,
      kind: dir === "up" ? "tier_cand_up" : "tier_cand_down",
      tone: almost
        ? dir === "up"
          ? "almost"
          : "warn"
        : dir === "up"
          ? "almost"
          : "warn",
      title:
        dir === "up"
          ? `Кандидат ↑ · ${formatTierArrow(Number(c.fromTier), Number(c.toTier))}`
          : `Кандидат ↓ · ${formatTierArrow(Number(c.fromTier), Number(c.toTier))}`,
      body: c.note
        ? String(c.note)
        : `Fit ${Number(c.fit || 0).toFixed(1)}%${c.role ? ` · ${c.role}` : ""}`,
      at,
      atLabel: ymdLabel(at),
    });
  }

  // Даты КВ по медалям
  const cwDateByMatch = new Map<string, string>();
  if (kv?.awards?.length) {
    for (const a of kv.awards) {
      const at = sortKeyFromLabel(a.dateLabel, a.day);
      const prev = cwDateByMatch.get(a.matchId);
      if (!prev || at > prev) cwDateByMatch.set(a.matchId, at);
    }
  }

  // 2) MVP medals (window)
  if (kv?.awards?.length) {
    for (const a of kv.awards) {
      if (String(a.type || "").toLowerCase().includes("anti")) continue;
      const at = sortKeyFromLabel(a.dateLabel, a.day);
      if (!inWindow(at)) continue;
      events.push({
        id: `mvp-${a.matchId}-${a.round}-${a.type}`,
        kind: "mvp",
        tone: "mvp",
        title: mvpTitle(a.type, a.label),
        body: `КВ · vs ${a.opp} · ${a.round?.toUpperCase() || "раунд"} · ${a.dateLabel}`,
        at,
        atLabel: a.dateLabel || ymdLabel(at),
      });
    }
  }

  // 3) CW rounds in window
  if (kv?.recent?.length) {
    const dated = kv.recent
      .map((r) => {
        const at = cwDateByMatch.get(r.matchId) || "";
        return { r, at };
      })
      .filter((x) => x.at && inWindow(x.at));

    const byDmg = [...dated].sort((a, b) => b.r.dmg - a.r.dmg);
    const byKd = [...dated].sort((a, b) => {
      const ka = a.r.deaths > 0 ? a.r.kills / a.r.deaths : a.r.kills;
      const kb = b.r.deaths > 0 ? b.r.kills / b.r.deaths : b.r.kills;
      return kb - ka;
    });
    const byRes = [...dated].sort((a, b) => b.r.res - a.r.res);

    if (byDmg[0] && byDmg[0].r.dmg >= 400) {
      const { r, at } = byDmg[0];
      events.push({
        id: `best-dmg-${r.matchId}-${r.round}`,
        kind: "record",
        tone: "record",
        title: "Рекорд · урон (КВ, 7 дн.)",
        body: `${r.dmg} dmg · ${r.map} vs ${r.opp} · ${r.round.toUpperCase()}`,
        at,
        atLabel: ymdLabel(at),
      });
    }
    if (byKd[0]) {
      const { r, at } = byKd[0];
      const kd = r.deaths > 0 ? r.kills / r.deaths : r.kills;
      if (kd >= 2 && r.kills >= 5) {
        events.push({
          id: `best-kd-${r.matchId}-${r.round}`,
          kind: "record",
          tone: "record",
          title: "Рекорд · KD (КВ, 7 дн.)",
          body: `KD ${kd.toFixed(2)} (${r.kills}/${r.deaths}) · ${r.map} vs ${r.opp}`,
          at,
          atLabel: ymdLabel(at),
        });
      }
    }
    if (byRes[0] && byRes[0].r.res >= 8) {
      const { r, at } = byRes[0];
      events.push({
        id: `best-res-${r.matchId}-${r.round}`,
        kind: "record",
        tone: "record",
        title: "Рекорд · ресы (КВ, 7 дн.)",
        body: `${r.res} ресов · ${r.map} vs ${r.opp} · ${r.round.toUpperCase()}`,
        at,
        atLabel: ymdLabel(at),
      });
    }

    for (const { r, at } of dated) {
      const score = roundScore(r);
      if (score >= 280 && (r.kills >= 6 || r.dmg >= 500 || r.res >= 8)) {
        const kd = r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : String(r.kills);
        events.push({
          id: `good-${r.matchId}-${r.round}`,
          kind: "good",
          tone: "good",
          title: "Хорошая игра · КВ",
          body: `${r.map} vs ${r.opp} · ${r.round.toUpperCase()} · ${r.kills}/${r.deaths} KD ${kd} · ${r.dmg} dmg${r.res ? ` · ${r.res} res` : ""}`,
          at,
          atLabel: ymdLabel(at),
        });
      }
    }

    const seen = new Set<string>();
    for (const { r, at } of dated) {
      if (seen.has(r.matchId)) continue;
      seen.add(r.matchId);
      const siblings = dated.filter((x) => x.r.matchId === r.matchId).map((x) => x.r);
      const kills = siblings.reduce((s, x) => s + x.kills, 0);
      const dmg = siblings.reduce((s, x) => s + x.dmg, 0);
      const res = siblings.reduce((s, x) => s + x.res, 0);
      const st =
        r.status === "win"
          ? "победа"
          : r.status === "lose"
            ? "поражение"
            : r.status || "матч";
      const tone: CareerTone =
        r.status === "win" ? "win" : r.status === "lose" ? "loss" : "note";
      events.push({
        id: `note-${r.matchId}`,
        kind: r.status === "win" ? "win" : r.status === "lose" ? "loss" : "note",
        tone,
        title: `КВ · ${r.map} · vs ${r.opp}`,
        body: `${st} · ${siblings.length} раунд(а) · ${kills} frags · ${dmg} dmg${res ? ` · ${res} res` : ""} · ${r.stack}`,
        at,
        atLabel: ymdLabel(at),
      });
    }
  }

  // 7) RP rank ups + train activity (7 days)
  if (rpLedger) {
    const player =
      rpLedger.players[key] ||
      Object.values(rpLedger.players).find((p) => nickKey(p.nick) === key);
    if (player?.matches?.length) {
      const asRpMatches = await withTrainMatchTimes(
        player.matches.map((m) => ({
          id: m.id,
          map: m.map,
          date: m.date,
          net: m.net,
          kills: [] as RpPlayerMatch["kills"],
          deaths: [] as RpPlayerMatch["deaths"],
        }))
      );
      events.push(
        ...buildRpRankEvents(
          asRpMatches,
          Number(rpLedger.startRp) || 0,
          Number(rpLedger.step) || 150,
          Number(rpLedger.radiant3Max) || 4950,
          { idPrefix: "rp-train", venue: "тренировка", cutoff }
        )
      );

      const recent = asRpMatches.filter((m) =>
        inWindow(String(m.date || "").slice(0, 10))
      );
      const byNet = [...recent].sort(
        (a, b) => (Number(b.net) || 0) - (Number(a.net) || 0)
      );
      if (byNet[0] && Number(byNet[0].net) >= 80) {
        const m = byNet[0];
        const at = String(m.date || "").slice(0, 10);
        events.push({
          id: `train-record-net-${m.id}`,
          kind: "record",
          tone: "record",
          title: "Рекорд · RP за тренировку (7 дн.)",
          body: `${Number(m.net) > 0 ? "+" : ""}${Math.round(Number(m.net))} RP · ${m.map || "TR"}`,
          at,
          atLabel: ymdLabel(at),
        });
      }
      for (const m of recent.slice(0, 12)) {
        const at = String(m.date || "").slice(0, 10);
        const net = Number(m.net) || 0;
        events.push({
          id: `train-note-${m.id}`,
          kind: net >= 40 ? "good" : "note",
          tone: net >= 40 ? "good" : "note",
          title: `Тренировка · ${m.map || "карта"}`,
          body: `${net >= 0 ? "+" : ""}${Math.round(net)} RP`,
          at,
          atLabel: ymdLabel(at),
        });
      }
    }
  }

  // 8) Паблик PB1
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
          Number(pubLedger.radiant3Max) || 4950,
          { idPrefix: "rp-pub", venue: "паблик PB1", cutoff }
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
      const snaps: PubSnap[] = pubPlayer.matches
        .map((m) => ({
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
        }))
        .filter((m) => inWindow(m.date));

      const byKd = [...snaps].sort((a, b) => {
        const ka = a.deaths > 0 ? a.kills / a.deaths : a.kills;
        const kb = b.deaths > 0 ? b.kills / b.deaths : b.kills;
        return kb - ka;
      });
      const byRes = [...snaps].sort((a, b) => b.res - a.res);
      const byNet = [...snaps].sort((a, b) => b.net - a.net);

      if (byKd[0]) {
        const r = byKd[0];
        const kd = r.deaths > 0 ? r.kills / r.deaths : r.kills;
        if (kd >= 2 && r.kills >= 5) {
          events.push({
            id: `pub-record-kd-${r.id}`,
            kind: "record",
            tone: "record",
            title: "Рекорд · KD (PB1, 7 дн.)",
            body: `KD ${kd.toFixed(2)} (${r.kills}/${r.deaths}) · ${r.map}`,
            at: r.date,
            atLabel: ymdLabel(r.date),
          });
        }
      }
      if (byRes[0] && byRes[0].res >= 5) {
        const r = byRes[0];
        events.push({
          id: `pub-record-res-${r.id}`,
          kind: "record",
          tone: "record",
          title: "Рекорд · ресы (PB1, 7 дн.)",
          body: `${r.res} ресов · ${r.map}`,
          at: r.date,
          atLabel: ymdLabel(r.date),
        });
      }
      if (byNet[0] && byNet[0].net >= 80) {
        const r = byNet[0];
        events.push({
          id: `pub-record-net-${r.id}`,
          kind: "record",
          tone: "record",
          title: "Рекорд · RP за катку (PB1, 7 дн.)",
          body: `${r.net > 0 ? "+" : ""}${Math.round(r.net)} RP · ${r.map}`,
          at: r.date,
          atLabel: ymdLabel(r.date),
        });
      }

      for (const r of snaps) {
        if (pubRoundScore(r) >= 220 && (r.kills >= 5 || r.res >= 4 || r.net >= 60)) {
          const kd =
            r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : String(r.kills);
          const st =
            r.won === true ? "победа" : r.won === false ? "поражение" : "катка";
          events.push({
            id: `pub-good-${r.id}`,
            kind: "good",
            tone: "good",
            title: "Хорошая игра · PB1",
            body: `${r.map} · ${st} · ${r.kills}/${r.deaths} KD ${kd}${r.res ? ` · ${r.res} res` : ""} · ${r.net >= 0 ? "+" : ""}${Math.round(r.net)} RP`,
            at: r.date,
            atLabel: ymdLabel(r.date),
          });
        }
      }

      for (const r of snaps) {
        const st =
          r.won === true ? "победа" : r.won === false ? "поражение" : "катка";
        const tone: CareerTone =
          r.won === true ? "win" : r.won === false ? "loss" : "note";
        events.push({
          id: `pub-note-${r.id}`,
          kind: r.won === true ? "win" : r.won === false ? "loss" : "note",
          tone,
          title: `PB1 · ${r.map}`,
          body: `${st} · ${r.kills} килов · ${r.deaths} смертей${r.res ? ` · ${r.res} res` : ""}${r.nok ? ` · ${r.nok} ноков` : ""} · ${r.net >= 0 ? "+" : ""}${Math.round(r.net)} RP`,
          at: r.date,
          atLabel: ymdLabel(r.date),
        });
      }

      // серия побед / поражений в окне
      const ordered = [...snaps].sort(
        (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
      );
      let streak = 0;
      let streakKind: "win" | "loss" | null = null;
      let streakEnd = "";
      for (const r of ordered) {
        if (r.won === true) {
          if (streakKind === "win") streak += 1;
          else {
            streakKind = "win";
            streak = 1;
          }
          streakEnd = r.date;
        } else if (r.won === false) {
          if (streakKind === "loss") streak += 1;
          else {
            streakKind = "loss";
            streak = 1;
          }
          streakEnd = r.date;
        } else {
          streak = 0;
          streakKind = null;
        }
      }
      if (streak >= 3 && streakKind) {
        events.push({
          id: `pub-streak-${streakKind}-${streak}`,
          kind: streakKind === "win" ? "win" : "loss",
          tone: streakKind === "win" ? "win" : "loss",
          title:
            streakKind === "win"
              ? `Серия побед · ${streak} катки (PB1)`
              : `Серия поражений · ${streak} катки (PB1)`,
          body: `За последние ${WINDOW_DAYS} дней · на ${ymdLabel(streakEnd)}`,
          at: streakEnd || today,
          atLabel: ymdLabel(streakEnd || today),
        });
      }
    }

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
      const n = String(p.nick || "").trim();
      if (!n) continue;
      for (const m of p.matches || []) {
        if (!m?.id) continue;
        const at = String(m.date || "").slice(0, 10);
        if (!inWindow(at)) continue;
        if (!byMatch.has(m.id)) {
          byMatch.set(m.id, {
            date: at,
            map: m.map || "PB1",
            rows: [],
          });
        }
        byMatch.get(m.id)!.rows.push({
          nick: n,
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
      const at = pack.date || cutoff;
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
    }
  }

  // Dedupe, keep window (+ BP/candidates always), sort, cap
  const uniq = new Map<string, CareerEvent>();
  for (const e of events) {
    const keep =
      e.kind === "bp" ||
      e.kind === "bp_level" ||
      e.kind === "bp_reward" ||
      e.kind === "tier_cand_up" ||
      e.kind === "tier_cand_down" ||
      inWindow(e.at);
    if (!keep) continue;
    if (!uniq.has(e.id)) uniq.set(e.id, e);
  }

  const priority = (e: CareerEvent) => {
    switch (e.kind) {
      case "bp":
        return 0;
      case "bp_level":
      case "bp_reward":
        return 1;
      case "tier_up":
      case "tier_down":
        return 2;
      case "tier_cand_up":
      case "tier_cand_down":
        return 3;
      case "record":
      case "best":
        return 4;
      case "mvp":
        return 5;
      case "rp_rank":
        return 6;
      case "win":
      case "loss":
        return 7;
      case "good":
        return 8;
      default:
        return 9;
    }
  };

  const sorted = [...uniq.values()].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    // BP status всегда сверху
    if (pa !== pb && (pa <= 1 || pb <= 1)) return pa - pb;
    if (a.at !== b.at) return b.at.localeCompare(a.at);
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title, "ru");
  });

  return {
    nick: want,
    events: sorted.slice(0, 48),
    updatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
  };
}

export function emptyPlayerCareerFeed(nick = ""): PlayerCareerFeed {
  return {
    nick,
    events: [],
    updatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
  };
}
