import { promises as fs } from "node:fs";
import { prisma } from "@/lib/prisma";
import { readSnapshot, snapshotFile, writeSnapshot } from "@/lib/diskSnapshot";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { loadUserPublicAttendanceStats } from "@/lib/publicAttendance";
import {
  buildPlayerPublicCombatStats,
  publicMvpCountsForNick,
} from "@/lib/publicCombat";
import { loadPublicRpOneFromDb } from "@/lib/rpDbRead";
import { lookupPlayerTrainPwr } from "@/lib/homeTrainPwr";
import { loadPlayerProfileHeavy } from "@/lib/playerProfileHeavy";
import { loadReadyHistories } from "@/lib/profileMatchLines";
import { buildPlayerCwAttendance } from "@/lib/homeCwPwr";
import { takeStaleNicks } from "@/lib/profileViewQueue";
import {
  collisionBySiteNick,
  publicRpLookupNick,
} from "@/lib/nickCollisions";

export type ProfileViewPayload = {
  trainPwr: unknown;
  publicSummary: { rp: unknown; combat: unknown };
  training: unknown;
  publicAtt: unknown;
  cwAtt: unknown;
  stats: unknown;
  histories: unknown;
};

function fileFor(nick: string): string {
  const key = nick
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "_")
    .slice(0, 80);
  return `profiles/lines/${key || "unknown"}.json`;
}

function emptyLane() {
  return {
    sessions: [] as unknown[],
    presentDays: [] as string[],
    lateDays: [] as string[],
    reserveDays: [] as string[],
    dayOffDays: [] as string[],
    visitBounds: {} as Record<string, { joinHm: string; leaveHm: string | null }>,
    minutes30d: 0,
    sessions30d: 0,
    openNow: false,
  };
}

function emptyPayload(): ProfileViewPayload {
  return {
    trainPwr: null,
    publicSummary: { rp: null, combat: null },
    training: { tr1: emptyLane(), tr2: emptyLane() },
    publicAtt: {
      sessions: [],
      presentDays: [],
      lateDays: [],
      visitBounds: {},
      minutes30d: 0,
      sessions30d: 0,
      openNow: false,
    },
    cwAtt: { byDay: {} },
    stats: {
      kvStats: null,
      kvError: null,
      trainCombat: null,
      publicCombat: null,
    },
    histories: {
      trainHistory: [],
      publicHistory: [],
      cwHistory: [],
      trainTotal: 0,
      publicTotal: 0,
      cwTotal: 0,
    },
  };
}

/** Пустые поля файла не оставляем null — иначе карточки висят на «Загрузка…». */
function present(data: ProfileViewPayload): ProfileViewPayload {
  const base = emptyPayload();
  return {
    trainPwr: data.trainPwr ?? null,
    publicSummary: data.publicSummary ?? base.publicSummary,
    training: data.training ?? base.training,
    publicAtt: data.publicAtt ?? base.publicAtt,
    cwAtt: data.cwAtt ?? base.cwAtt,
    stats: data.stats ?? base.stats,
    histories: data.histories ?? base.histories,
  };
}

export async function buildProfileViewPayload(
  userId: string,
  nick: string
): Promise<ProfileViewPayload> {
  const publicNick = publicRpLookupNick(
    nick,
    collisionBySiteNick(nick)?.steamId
  );
  const [trainPwr, rp, combat, training, publicAtt, cwAtt, heavy] =
    await Promise.all([
      lookupPlayerTrainPwr(nick).catch(() => null),
      loadPublicRpOneFromDb(publicNick).catch(() => null),
      buildPlayerPublicCombatStats(nick).catch(() => null),
      loadUserTrainingStats(userId),
      loadUserPublicAttendanceStats(userId).catch(() => null),
      buildPlayerCwAttendance(nick).catch(() => ({ byDay: {} })),
      loadPlayerProfileHeavy(nick).catch(() => null),
    ]);

  const base = emptyPayload();
  return {
    trainPwr,
    publicSummary: { rp, combat },
    training: training ?? base.training,
    publicAtt: publicAtt ?? base.publicAtt,
    cwAtt: cwAtt ?? base.cwAtt,
    stats: heavy
      ? {
          kvStats: heavy.kvStats,
          kvError: heavy.kvError,
          trainCombat: heavy.trainCombat,
          publicCombat: heavy.publicCombat,
        }
      : base.stats,
    histories: heavy
      ? {
          trainHistory: heavy.trainHistory,
          publicHistory: heavy.publicHistory,
          cwHistory: heavy.cwHistory,
          trainTotal: heavy.trainHistory.length,
          publicTotal: heavy.publicHistory.length,
          cwTotal: heavy.cwHistory.length,
        }
      : base.histories,
  };
}

/** Снимок профиля хранил нули MVP. На чтении подставляем живой подсчёт паблика. */
async function withLivePublicMvp(
  name: string,
  data: ProfileViewPayload
): Promise<ProfileViewPayload> {
  const mvp = await publicMvpCountsForNick(name).catch(() => null);
  if (!mvp) return data;
  const paint = (combat: unknown) => {
    if (!combat || typeof combat !== "object") return combat;
    return {
      ...(combat as Record<string, unknown>),
      mvpKiller: mvp.killer,
      mvpMedic: mvp.medic,
      mvpArmor: mvp.armor,
    };
  };
  if (data.publicSummary && typeof data.publicSummary === "object") {
    const summary = data.publicSummary as { combat?: unknown };
    data.publicSummary = { ...summary, combat: paint(summary.combat) };
  }
  if (data.stats && typeof data.stats === "object") {
    const stats = data.stats as { publicCombat?: unknown };
    data.stats = { ...stats, publicCombat: paint(stats.publicCombat) };
  }
  return data;
}

/**
 * Шапка профиля берёт живое RP из базы. История — уже записанные строки.
 * Пустой ответ не затирает снимок: пересборка идёт в фоне и не держит экран.
 */
async function withLivePublicRp(
  name: string,
  data: ProfileViewPayload
): Promise<ProfileViewPayload> {
  const ready = await loadReadyHistories(name).catch(() => null);
  const readyRows =
    (ready?.trainHistory?.length || 0) +
    (ready?.publicHistory?.length || 0) +
    (ready?.cwHistory?.length || 0);
  if (ready && readyRows > 0) {
    const prev =
      data.histories && typeof data.histories === "object"
        ? (data.histories as Record<string, unknown>)
        : {};
    data.histories = {
      ...prev,
      trainHistory: ready.trainHistory,
      publicHistory: ready.publicHistory,
      cwHistory: ready.cwHistory,
      trainTotal: ready.trainTotal,
      publicTotal: ready.publicTotal,
      cwTotal: ready.cwTotal,
    };
  }
  const rp = await loadPublicRpOneFromDb(name).catch(() => null);
  if (rp && Number.isFinite(Number(rp.rp))) {
    const official = Math.round(Number(rp.rp));
    const combat = data.publicSummary?.combat;
    const prevRp =
      data.publicSummary?.rp && typeof data.publicSummary.rp === "object"
        ? (data.publicSummary.rp as Record<string, unknown>)
        : {};
    data.publicSummary = {
      rp: {
        ...prevRp,
        nick: rp.nick,
        rp: rp.rp,
        rankLabel: rp.rankLabel,
        rankKey: rp.rankKey,
        predatorPlace: rp.predatorPlace,
      },
      combat: combat
        ? {
            ...combat,
            rp: official,
            rankLabel: rp.rankLabel,
            rankKey: rp.rankKey,
            predatorPlace: rp.predatorPlace ?? null,
          }
        : combat ?? null,
    };
    const stats = data.stats as {
      publicCombat?: {
        rp?: number | null;
        rankLabel?: string | null;
        rankKey?: string | null;
        predatorPlace?: number | null;
      } | null;
    } | null;
    if (stats?.publicCombat) {
      data.stats = {
        ...stats,
        publicCombat: {
          ...stats.publicCombat,
          rp: official,
          rankLabel: rp.rankLabel,
          rankKey: rp.rankKey,
          predatorPlace: rp.predatorPlace ?? null,
        },
      };
    }
    const hist = data.histories as { publicHistory?: unknown[] } | null;
    const rows = hist?.publicHistory;
    const newest = rows?.[0];
    if (rows && newest && typeof newest === "object") {
      const first = { ...(newest as Record<string, unknown>) };
      const shown =
        first.rpAfter == null || !Number.isFinite(Number(first.rpAfter))
          ? null
          : Math.round(Number(first.rpAfter));
      // Align header RP only when history is already near it — otherwise a
      // stale top match looks like a random +1000 spike.
      if (shown == null || Math.abs(shown - official) <= 5) {
        first.rpAfter = official;
        first.pwrAfter = official;
      }
      first.rankLabel = rp.rankLabel;
      first.rankKey = rp.rankKey;
      data.histories = { ...hist, publicHistory: [first, ...rows.slice(1)] };
    }
  }
  data.histories = await fillPublicTicketScores(data.histories);
  return data;
}

/** Счёт катки уже лежит в RpScoredMatch. Снимок профиля его часто не содержит. */
async function fillPublicTicketScores(histories: unknown): Promise<unknown> {
  if (!histories || typeof histories !== "object") return histories;
  const bag = histories as { publicHistory?: unknown[] };
  const rows = bag.publicHistory;
  if (!Array.isArray(rows) || rows.length === 0) return histories;
  const need: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as {
      matchId?: string;
      ticketsA?: number | null;
      ticketsB?: number | null;
    };
    if (item.ticketsA != null && item.ticketsB != null) continue;
    const id = String(item.matchId || "").trim();
    if (id) need.push(id);
  }
  if (!need.length) return histories;
  const found = await prisma.rpScoredMatch
    .findMany({
      where: { scope: "PUBLIC", matchKey: { in: need.slice(0, 800) } },
      select: { matchKey: true, rawJson: true },
    })
    .catch(() => []);
  const byId = new Map<string, { a: number; b: number }>();
  for (const row of found) {
    const raw = row.rawJson as { score1?: unknown; score2?: unknown } | null;
    const a = Number(raw?.score1);
    const b = Number(raw?.score2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    byId.set(row.matchKey, { a, b });
  }
  if (!byId.size) return histories;
  return {
    ...bag,
    publicHistory: rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const item = row as {
        matchId?: string;
        ticketsA?: number | null;
        ticketsB?: number | null;
      };
      if (item.ticketsA != null && item.ticketsB != null) return row;
      const hit = byId.get(String(item.matchId || ""));
      if (!hit) return row;
      return { ...item, ticketsA: hit.a, ticketsB: hit.b };
    }),
  };
}

function trainingPresentCount(training: unknown): number {
  if (!training || typeof training !== "object") return 0;
  const t = training as {
    presentDays?: unknown[];
    tr1?: { presentDays?: unknown[] };
    tr2?: { presentDays?: unknown[] };
  };
  return (
    (t.presentDays?.length || 0) +
    (t.tr1?.presentDays?.length || 0) +
    (t.tr2?.presentDays?.length || 0)
  );
}

/**
 * Календарь КВ: если в снимке поле уже есть (даже пустой byDay) — отдаём сразу.
 * Иначе каждый заход читает все month JSON + players/*.json. Живой пересчёт
 * (актуальный клан) — в фоне через очередь снимка.
 */
async function withLiveCwAtt(
  nick: string,
  data: ProfileViewPayload
): Promise<ProfileViewPayload> {
  if (data.cwAtt && typeof data.cwAtt === "object") {
    void import("@/lib/profileViewQueue")
      .then((m) => m.markProfileViewStale(nick))
      .catch(() => undefined);
    return data;
  }
  const cwAtt = await buildPlayerCwAttendance(nick).catch(() => null);
  if (cwAtt) data.cwAtt = cwAtt;
  return data;
}

/**
 * Если кэш профиля стёрт — календарь не должен навсегда стать «не был».
 * Подтягиваем посещаемость из БД и ставим полный пересчёт файла в фон.
 */
async function withLiveTrainingIfEmpty(
  nick: string,
  data: ProfileViewPayload
): Promise<ProfileViewPayload> {
  if (trainingPresentCount(data.training) > 0) return data;
  // Паблик-календарь уже в снимке — тренировки пустые легитимно, не долбим БД.
  const pub = data.publicAtt as { presentDays?: unknown[] } | null;
  if ((pub?.presentDays?.length || 0) > 0) return data;
  const user = await prisma.user.findFirst({
    where: {
      nick: { equals: nick, mode: "insensitive" },
      profileComplete: true,
    },
    select: { id: true, nick: true },
  });
  if (!user?.nick) return data;
  const [training, publicAtt] = await Promise.all([
    loadUserTrainingStats(user.id).catch(() => null),
    loadUserPublicAttendanceStats(user.id).catch(() => null),
  ]);
  if (training) data.training = training;
  if (publicAtt) data.publicAtt = publicAtt;
  // Полный файл только если в БД реально есть посещения — иначе крутим пустой rebuild.
  if (trainingPresentCount(training) > 0) {
    void rebuildProfileViewFile(user.id, user.nick).catch(() => undefined);
  }
  return data;
}

/**
 * Сломанный warm (tsx без Next cache) писал trainCombat:null.
 * matches:0 у паблик-онли игрока — валидно; не гоняем heavy (~9с) на каждый заход.
 */
async function withLiveCombatIfEmpty(
  nick: string,
  data: ProfileViewPayload
): Promise<ProfileViewPayload> {
  const stats =
    data.stats && typeof data.stats === "object"
      ? (data.stats as { trainCombat?: unknown | null })
      : null;
  // null/undefined = битый warm; объект (в т.ч. matches:0) = снимок ок.
  if (stats && stats.trainCombat != null) return data;

  const heavy = await loadPlayerProfileHeavy(nick).catch(() => null);
  if (!heavy) return data;

  const prev =
    data.stats && typeof data.stats === "object"
      ? (data.stats as Record<string, unknown>)
      : {};
  data.stats = {
    ...prev,
    kvStats: heavy.kvStats ?? prev.kvStats ?? null,
    kvError: heavy.kvError ?? prev.kvError ?? null,
    // Пишем даже matches:0 — иначе следующий заход снова дернёт heavy.
    trainCombat: heavy.trainCombat ?? { matches: 0 },
    publicCombat: heavy.publicCombat ?? prev.publicCombat ?? null,
  };
  if (heavy.trainHistory.length > 0) {
    const histPrev =
      data.histories && typeof data.histories === "object"
        ? (data.histories as Record<string, unknown>)
        : {};
    data.histories = {
      ...histPrev,
      trainHistory: heavy.trainHistory,
      trainTotal: heavy.trainTotal || heavy.trainHistory.length,
      publicHistory: histPrev.publicHistory ?? heavy.publicHistory,
      cwHistory: histPrev.cwHistory ?? heavy.cwHistory,
      publicTotal: histPrev.publicTotal ?? heavy.publicTotal,
      cwTotal: histPrev.cwTotal ?? heavy.cwTotal,
    };
  }

  void import("@/lib/profileViewQueue")
    .then((m) => m.markProfileViewStale(nick))
    .catch(() => undefined);
  return data;
}

/**
 * Готовый файл для календаря и статы. RP паблика и его история — из лестницы.
 */
export async function readStoredProfileView(
  nick: string
): Promise<ProfileViewPayload> {
  const name = (nick || "").trim();
  if (!name) return emptyPayload();
  const hit = await readSnapshot<ProfileViewPayload>(fileFor(name));
  if (hit?.data && typeof hit.data === "object") {
    const data = present(hit.data);
    return withLivePublicMvp(
      name,
      await withLivePublicRp(
        name,
        await withLiveCwAtt(
          name,
          await withLiveCombatIfEmpty(
            name,
            await withLiveTrainingIfEmpty(name, data)
          )
        )
      )
    );
  }
  const histories = await loadReadyHistories(name).catch(() => null);
  const base = emptyPayload();
  if (histories) base.histories = histories;
  // Нет файла — сразу восстановим посещаемость из БД; полный файл — в фон/cron.
  void import("@/lib/profileViewQueue")
    .then((m) => m.markProfileViewStale(name))
    .catch(() => undefined);
  return withLivePublicMvp(
    name,
    await withLivePublicRp(
      name,
      await withLiveCwAtt(
        name,
        await withLiveCombatIfEmpty(
          name,
          await withLiveTrainingIfEmpty(name, base)
        )
      )
    )
  );
}

/** Совместимость: старые вызовы больше не пересчитывают профиль. */
export async function loadProfileViewSnapshot(
  _userId: string,
  nick: string
): Promise<ProfileViewPayload> {
  return readStoredProfileView(nick);
}

export async function rebuildProfileViewFile(
  userId: string,
  nick: string
): Promise<ProfileViewPayload> {
  const data = await buildProfileViewPayload(userId, nick);
  await writeSnapshot(fileFor(nick), data);
  return data;
}

/** Следующие N профилей: сначала очередь (выходной), потом самые старые файлы. */
export async function warmNextProfileViews(limit = 3): Promise<string[]> {
  const cap = Math.max(1, Math.min(8, limit));
  const done: string[] = [];

  for (const nick of await takeStaleNicks(cap)) {
    const user = await prisma.user.findFirst({
      where: {
        nick: { equals: nick, mode: "insensitive" },
        profileComplete: true,
      },
      select: { id: true, nick: true },
    });
    if (!user?.nick) continue;
    await rebuildProfileViewFile(user.id, user.nick);
    done.push(user.nick);
  }

  const room = cap - done.length;
  if (room <= 0) return done;

  const users = await prisma.user.findMany({
    where: { profileComplete: true, NOT: { nick: "" } },
    select: { id: true, nick: true },
  });
  const ranked: { id: string; nick: string; mtime: number }[] = [];
  for (const user of users) {
    const nick = (user.nick || "").trim();
    if (!nick) continue;
    if (done.some((d) => d.toLowerCase() === nick.toLowerCase())) continue;
    let mtime = 0;
    try {
      mtime = (await fs.stat(snapshotFile(fileFor(nick)))).mtimeMs;
    } catch {
      mtime = 0;
    }
    ranked.push({ id: user.id, nick, mtime });
  }
  ranked.sort((a, b) => a.mtime - b.mtime);
  for (const row of ranked.slice(0, room)) {
    await rebuildProfileViewFile(row.id, row.nick);
    done.push(row.nick);
  }
  return done;
}

/** Прогрев с главной выключен: пересчёт только в отдельном процессе cron. */
export function kickProfileWarm(_nicks: string[]) {
  return;
}
