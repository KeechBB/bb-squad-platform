/**
 * Постматчевая сверка: angel BB / Алан / ALPHA ·8062 строго по Steam.
 *
 * Usage:
 *   npx tsx scripts/verify_angel_steam_split.ts
 *   npx tsx scripts/verify_angel_steam_split.ts --since 2026-11-25
 *   npx tsx scripts/verify_angel_steam_split.ts --match 25-mutaha
 *   npx tsx scripts/verify_angel_steam_split.ts --fix
 *   npx tsx scripts/verify_angel_steam_split.ts --json
 *
 * Exit 0 = OK, 1 = FAIL (для cron / post-match).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ALL_ANGEL_STEAM_IDS,
  ALAN_ANGEL_STEAM_ID,
  ALPHA_ANGEL_STEAM_ID,
  ANGEL_COLLISIONS,
  BB_ANGEL_STEAM_ID,
  angelSteamOwnsMatch,
  collisionBySteamId,
  loadSteamAngelSpawnMs,
  resolveFactionAngel,
} from "@/lib/nickCollisions";
import {
  buildPlayerTrainCombatStats,
  buildPlayerTrainMatchHistory,
} from "@/lib/homeTrainPwr";
import { buildPlayerPublicMatchHistory } from "@/lib/publicMatchHistory";
import { buildPlayerPublicCombatStats } from "@/lib/publicCombat";
import { forceRebuildProfileLines } from "@/lib/profileMatchLines";
import { rebuildProfileViewFile } from "@/lib/profileViewSnapshot";
import { invalidateProfileView } from "@/lib/profileViewCache";
import { prisma } from "@/lib/prisma";

type Check = {
  ok: boolean;
  area: string;
  who: string;
  detail: string;
};

type AngelWho = {
  label: string;
  steamId: string;
  siteNick: string;
};

const WHO: AngelWho[] = [
  {
    label: "BB-Sanya",
    steamId: BB_ANGEL_STEAM_ID,
    siteNick: ANGEL_COLLISIONS[0]!.siteNick,
  },
  {
    label: "Alan",
    steamId: ALAN_ANGEL_STEAM_ID,
    siteNick: ANGEL_COLLISIONS[1]!.siteNick,
  },
  {
    label: "ALPHA-8062",
    steamId: ALPHA_ANGEL_STEAM_ID,
    siteNick: ANGEL_COLLISIONS[2]!.siteNick,
  },
];

function argVal(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return null;
  return String(process.argv[i + 1] || "").trim() || null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function kvCombatPath(matchId: string): string {
  return path.join(
    process.cwd(),
    "data",
    "kv-cache",
    "data",
    "training",
    "combat",
    `${matchId}.json`
  );
}

function kvPlayersPath(matchId: string): string {
  return path.join(
    process.cwd(),
    "data",
    "kv-cache",
    "data",
    "training",
    "players",
    `${matchId}.json`
  );
}

function trainMonthPaths(): string[] {
  const dir = path.join(
    process.cwd(),
    "data",
    "kv-cache",
    "data",
    "training"
  );
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .map((f) => path.join(dir, f))
    .sort();
}

type MonthMatch = {
  id: string;
  day: number;
  month: number;
  year: number;
  timeMsk: string;
  map: string;
  ymd: string;
};

function loadRecentTrainMatches(sinceYmd: string | null): MonthMatch[] {
  const out: MonthMatch[] = [];
  for (const p of trainMonthPaths()) {
    let data: { matches?: Array<Record<string, unknown>> };
    try {
      data = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    const [yearS, monS] = path.basename(p, ".json").split("-");
    const year = Number(yearS);
    const month = Number(monS);
    for (const m of data.matches || []) {
      const id = String(m.id || "").trim();
      if (!id) continue;
      const day = Number(m.day) || 0;
      const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (sinceYmd && ymd < sinceYmd) continue;
      if (!fs.existsSync(kvPlayersPath(id))) continue;
      const players = JSON.parse(fs.readFileSync(kvPlayersPath(id), "utf8")) as {
        teamA?: Array<{ nick?: string }>;
        teamB?: Array<{ nick?: string }>;
        players?: Array<{ nick?: string }>;
      };
      const list = [
        ...(players.players || []),
        ...(players.teamA || []),
        ...(players.teamB || []),
      ];
      const hasAngel = list.some((r) =>
        String(r?.nick || "")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "")
          .includes("angel")
      );
      if (!hasAngel) continue;
      out.push({
        id,
        day,
        month,
        year,
        timeMsk: String(m.timeMsk || "").slice(0, 5),
        map: String(m.map || ""),
        ymd,
      });
    }
  }
  return out.sort((a, b) =>
    `${a.ymd}T${a.timeMsk}`.localeCompare(`${b.ymd}T${b.timeMsk}`)
  );
}

function readCombatCard(matchId: string): {
  steamSplit?: boolean;
  players?: Record<
    string,
    {
      kills?: unknown[];
      deaths?: unknown[];
      noks?: unknown[];
      revives?: unknown[];
      teamkills?: unknown[];
    }
  >;
} | null {
  const p = kvCombatPath(matchId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function cardStats(
  card: NonNullable<ReturnType<typeof readCombatCard>>,
  steamId: string
) {
  const row = card.players?.[`angel#${steamId}`];
  if (!row) return null;
  return {
    kills: (row.kills || []).length,
    deaths: (row.deaths || []).length,
    noks: (row.noks || []).length,
    res: (row.revives || []).length,
    teamkills: (row.teamkills || []).length,
  };
}

function rebuildCombat(matchId: string): boolean {
  const r = spawnSync(
    "python3",
    ["scripts/train_combat_card.py", "--id", matchId, "--rebuild"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 }
  );
  return r.status === 0;
}

function add(
  checks: Check[],
  ok: boolean,
  area: string,
  who: string,
  detail: string
) {
  checks.push({ ok, area, who, detail });
}

async function verifyMatch(
  m: MonthMatch,
  spawns: Map<string, number[]>,
  checks: Check[],
  doFix: boolean
) {
  const present = WHO.filter((w) =>
    angelSteamOwnsMatch(spawns.get(w.steamId) || [], m.ymd, m.timeMsk)
  );
  if (!present.length) return;

  add(
    checks,
    true,
    "presence",
    present.map((p) => p.label).join("+"),
    `${m.id} ${m.ymd} ${m.timeMsk} ${m.map}`
  );

  if (doFix) rebuildCombat(m.id);
  let card = readCombatCard(m.id);
  if (!card?.steamSplit || !card.players) {
    if (doFix && rebuildCombat(m.id)) card = readCombatCard(m.id);
  }
  if (!card?.players) {
    add(checks, false, "combat-card", "—", `${m.id}: нет combat JSON`);
    return;
  }

  const plain = card.players["angel"];
  const steamKeys = Object.keys(card.players).filter((k) =>
    k.startsWith("angel#")
  );
  if (plain && steamKeys.length >= 2) {
    add(
      checks,
      false,
      "combat-card",
      "merge",
      `${m.id}: есть plain angel при ${steamKeys.length} steam-ключах`
    );
  } else {
    add(
      checks,
      true,
      "combat-card",
      "keys",
      `${m.id}: ${steamKeys.join(",") || "no-steam-keys"} steamSplit=${Boolean(card.steamSplit)}`
    );
  }

  for (const w of present) {
    const st = cardStats(card, w.steamId);
    if (!st) {
      add(
        checks,
        false,
        "combat-card",
        w.label,
        `${m.id}: нет angel#${w.steamId}`
      );
      continue;
    }
    add(
      checks,
      true,
      "combat-card",
      w.label,
      `${m.id}: k=${st.kills} d=${st.deaths} nok=${st.noks} res=${st.res} tk=${st.teamkills}`
    );
  }

  // На одной катке два angel — стата не должна быть копией scoreboard друг друга.
  if (present.length >= 2) {
    const a = cardStats(card, present[0]!.steamId);
    const b = cardStats(card, present[1]!.steamId);
    if (a && b) {
      const same =
        a.kills === b.kills &&
        a.deaths === b.deaths &&
        a.noks === b.noks &&
        a.res === b.res &&
        a.kills + a.deaths + a.noks + a.res > 0;
      add(
        checks,
        !same,
        "combat-distinct",
        `${present[0]!.label}/${present[1]!.label}`,
        same
          ? `${m.id}: одинаковая combat-стата — подозрение на склейку`
          : `${m.id}: статы разные OK`
      );
    }
  }
}

async function verifyHistories(
  sinceYmd: string | null,
  matchFilter: string | null,
  checks: Check[]
) {
  for (const w of WHO) {
    const hist = await buildPlayerTrainMatchHistory(w.siteNick, {
      steamId: w.steamId,
    });
    const filtered = hist.filter((r) => {
      const parts = String(r.dateLabel || "").split(".");
      if (parts.length !== 3) return true;
      const ymd = `${parts[2]}-${parts[1]}-${parts[0]}`;
      if (sinceYmd && ymd < sinceYmd) return false;
      if (matchFilter && r.matchId !== matchFilter) return false;
      return true;
    });
    add(
      checks,
      true,
      "train-history",
      w.label,
      `rows=${filtered.length} (filter since/match)`
    );

    for (const row of filtered) {
      const card = readCombatCard(row.matchId);
      const st = card ? cardStats(card, w.steamId) : null;
      if (!st) continue;
      const ok =
        row.kills === st.kills &&
        row.deaths === st.deaths &&
        row.nok === st.noks &&
        row.res === st.res;
      add(
        checks,
        ok,
        "train-history-vs-combat",
        w.label,
        ok
          ? `${row.matchId}: history=combat k${row.kills}/d${row.deaths}`
          : `${row.matchId}: history k${row.kills}/d${row.deaths}/nok${row.nok}/res${row.res} ≠ combat k${st.kills}/d${st.deaths}/nok${st.noks}/res${st.res}`
      );
    }

    const combat = await buildPlayerTrainCombatStats(w.siteNick, {
      steamId: w.steamId,
    });
    add(
      checks,
      Boolean(combat),
      "train-combat-tab",
      w.label,
      combat
        ? `matches=${combat.matches} k=${combat.kills} d=${combat.deaths} kd=${combat.kd}`
        : "нет trainCombat"
    );

    try {
      const pubHist = await buildPlayerPublicMatchHistory(w.siteNick, {
        steamId: w.steamId,
      });
      const pub = await buildPlayerPublicCombatStats(w.siteNick, {
        steamId: w.steamId,
      });
      add(
        checks,
        true,
        "public-tabs",
        w.label,
        `hist=${pubHist.length} combatMatches=${pub?.matches ?? 0} rp=${pub?.rp ?? "—"}`
      );
    } catch (e) {
      add(
        checks,
        false,
        "public-tabs",
        w.label,
        `error ${e instanceof Error ? e.message : e}`
      );
    }
  }
}

async function verifyFactionAndGrowth(checks: Check[]) {
  for (const w of WHO) {
    const fa = resolveFactionAngel({
      nick: w.siteNick,
      steamId: w.steamId,
    });
    const okSteam = fa?.steamId === w.steamId;
    add(
      checks,
      okSteam,
      "faction-resolve",
      w.label,
      okSteam
        ? `resolve → ${fa?.siteNick} / ${fa?.steamId}`
        : `resolve mismatch ${fa?.steamId || "null"}`
    );

    // Без steam не угадываем BB по steamName «angel».
    if (w.steamId === BB_ANGEL_STEAM_ID) {
      const byNameOnly = resolveFactionAngel({
        nick: "someone",
        steamName: "angel",
        steamId: null,
      });
      add(
        checks,
        byNameOnly == null,
        "faction-resolve",
        "steamName-guard",
        byNameOnly
          ? `steamName angel ошибочно → ${byNameOnly.steamId}`
          : "steamName angel не угадывает BB OK"
      );
    }

    const user = await prisma.user.findFirst({
      where: { steamId: w.steamId },
      select: { id: true, nick: true, steamId: true },
    });
    if (!user) {
      add(checks, false, "account", w.label, "нет User в БД");
      continue;
    }
    add(
      checks,
      user.steamId === w.steamId,
      "account",
      w.label,
      `user=${user.nick} steam=${user.steamId}`
    );

    // Развитие: строка только своего userId (не чужой angel).
    try {
      const { factionGrowthBoard } = await import("@/lib/factionBoard");
      const fm = await prisma.factionMember.findFirst({
        where: { userId: user.id },
        select: { factionId: true },
      });
      if (fm) {
        const rows = await factionGrowthBoard(fm.factionId);
        const mine = rows.filter((r) => r.userId === user.id);
        const foreign = rows.filter(
          (r) =>
            r.userId !== user.id &&
            String(r.nick || "")
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, "") === "angel"
        );
        add(
          checks,
          mine.length <= 1,
          "growth-tab",
          w.label,
          `ownRows=${mine.length} nick=${mine[0]?.nick || "—"}`
        );
        if (w.steamId === BB_ANGEL_STEAM_ID) {
          add(
            checks,
            true,
            "growth-tab",
            w.label,
            `other plain-angel rows in faction board=${foreign.length} (информативно)`
          );
        }
      } else {
        add(
          checks,
          true,
          "growth-tab",
          w.label,
          "не во фракции — skip"
        );
      }
    } catch (e) {
      add(
        checks,
        false,
        "growth-tab",
        w.label,
        `error ${e instanceof Error ? e.message : e}`
      );
    }
  }

  // BB и ALPHA — разные Steam в коллизиях.
  add(
    checks,
    BB_ANGEL_STEAM_ID !== ALPHA_ANGEL_STEAM_ID &&
      ALL_ANGEL_STEAM_IDS.length === 3,
    "collisions",
    "canon",
    `steams=${ALL_ANGEL_STEAM_IDS.join(",")}`
  );
  add(
    checks,
    collisionBySteamId(ALPHA_ANGEL_STEAM_ID)?.siteNick === "angel ·8062",
    "collisions",
    "ALPHA",
    collisionBySteamId(ALPHA_ANGEL_STEAM_ID)?.siteNick || "missing"
  );
}

async function maybeRebuildProfiles(doFix: boolean) {
  if (!doFix) return;
  for (const w of WHO) {
    const u = await prisma.user.findFirst({
      where: { steamId: w.steamId },
      select: { id: true, nick: true },
    });
    if (!u?.nick) continue;
    invalidateProfileView(u.nick);
    for (const kind of ["train", "public", "cw"] as const) {
      await forceRebuildProfileLines(u.nick, kind, w.steamId);
    }
    await rebuildProfileViewFile(u.id, u.nick);
  }
}

async function main() {
  const since =
    argVal("--since") ||
    (() => {
      // по умолчанию — последние 3 дня МСК
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const now = new Date();
      const parts = fmt.formatToParts(now);
      const y = Number(parts.find((p) => p.type === "year")?.value);
      const m = Number(parts.find((p) => p.type === "month")?.value);
      const d = Number(parts.find((p) => p.type === "day")?.value);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - 2);
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    })();
  const matchFilter = argVal("--match");
  const doFix = hasFlag("--fix");
  const asJson = hasFlag("--json");

  const checks: Check[] = [];
  const spawns = new Map<string, number[]>();
  for (const w of WHO) {
    spawns.set(w.steamId, await loadSteamAngelSpawnMs(w.steamId, "TR"));
  }

  let matches = matchFilter
    ? loadRecentTrainMatches(null).filter((m) => m.id === matchFilter)
    : loadRecentTrainMatches(since);
  if (matchFilter && !matches.length) {
    add(checks, false, "match", "—", `матч ${matchFilter} не найден в training/*.json`);
  }

  for (const m of matches) {
    await verifyMatch(m, spawns, checks, doFix);
  }

  await verifyHistories(since, matchFilter, checks);
  await verifyFactionAndGrowth(checks);
  await maybeRebuildProfiles(doFix);

  const failed = checks.filter((c) => !c.ok);
  const report = {
    ok: failed.length === 0,
    since,
    matchFilter,
    fix: doFix,
    checkedMatches: matches.map((m) => m.id),
    total: checks.length,
    failed: failed.length,
    checks,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `angel-steam-verify since=${since} matches=${matches.length} checks=${checks.length} failed=${failed.length}`
    );
    for (const c of checks) {
      const mark = c.ok ? "OK " : "FAIL";
      console.log(`${mark} [${c.area}] ${c.who}: ${c.detail}`);
    }
    if (failed.length) {
      console.log("\nFAILED:");
      for (const c of failed) {
        console.log(` - [${c.area}] ${c.who}: ${c.detail}`);
      }
    } else {
      console.log("\nALL OK — BB / Alan / ALPHA разделены по Steam");
    }
  }

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
