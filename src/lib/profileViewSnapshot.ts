import { promises as fs } from "node:fs";
import { prisma } from "@/lib/prisma";
import { readSnapshot, snapshotFile, writeSnapshot } from "@/lib/diskSnapshot";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { loadUserPublicAttendanceStats } from "@/lib/publicAttendance";
import { buildPlayerPublicCombatStats } from "@/lib/publicCombat";
import { lookupPlayerPublicRp } from "@/lib/publicRp";
import { lookupPlayerTrainPwr } from "@/lib/homeTrainPwr";
import { loadPlayerProfileHeavy } from "@/lib/playerProfileHeavy";
import { ensureProfileLines, loadReadyHistories } from "@/lib/profileMatchLines";
import { buildPlayerCwAttendance } from "@/lib/homeCwPwr";
import { takeStaleNicks } from "@/lib/profileViewQueue";

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
  const [trainPwr, rp, combat, training, publicAtt, cwAtt, heavy] =
    await Promise.all([
      lookupPlayerTrainPwr(nick).catch(() => null),
      lookupPlayerPublicRp(nick).catch(() => null),
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

function storedHistoryCount(hist: unknown): number {
  if (!hist || typeof hist !== "object") return 0;
  const row = hist as {
    trainHistory?: unknown[];
    publicHistory?: unknown[];
    cwHistory?: unknown[];
  };
  return (
    (row.trainHistory?.length || 0) +
    (row.publicHistory?.length || 0) +
    (row.cwHistory?.length || 0)
  );
}

/**
 * История паблика и число RP в шапке профиля берутся из лестницы.
 * Файл профиля может быть старше пересчёта RP — его катки паблика не показываем.
 * Если лестница новее сохранённых строк, строки этого игрока пересобираются один раз.
 */
async function withLivePublicRp(
  name: string,
  data: ProfileViewPayload
): Promise<ProfileViewPayload> {
  await Promise.all(
    (["public", "train", "cw"] as const).map((kind) =>
      ensureProfileLines(name, kind).catch(() => undefined)
    )
  );
  const ready = await loadReadyHistories(name).catch(() => null);
  const prev =
    data.histories && typeof data.histories === "object"
      ? (data.histories as Record<string, unknown>)
      : {};
  if (ready) {
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
  const rp = await lookupPlayerPublicRp(name).catch(() => null);
  if (rp && Number.isFinite(Number(rp.rp))) {
    const official = Math.round(Number(rp.rp));
    const combat = data.publicSummary?.combat;
    data.publicSummary = {
      rp,
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
  return data;
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
 * Если кэш профиля стёрт — календарь не должен навсегда стать «не был».
 * Подтягиваем посещаемость из БД и ставим полный пересчёт файла в фон.
 */
async function withLiveTrainingIfEmpty(
  nick: string,
  data: ProfileViewPayload
): Promise<ProfileViewPayload> {
  if (trainingPresentCount(data.training) > 0) return data;
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

function trainCombatMatches(stats: unknown): number {
  if (!stats || typeof stats !== "object") return 0;
  const row = stats as { trainCombat?: { matches?: number } | null };
  const n = row.trainCombat?.matches;
  return Number.isFinite(n) ? Number(n) : 0;
}

/**
 * Сломанный warm (tsx без Next cache) писал trainCombat:null при живых катках.
 * На чтении поднимаем стату/историю и ставим полный rebuild в фон.
 */
async function withLiveCombatIfEmpty(
  nick: string,
  data: ProfileViewPayload
): Promise<ProfileViewPayload> {
  const hist = data.histories as {
    trainHistory?: unknown[];
    trainTotal?: number;
  } | null;
  const needCombat = trainCombatMatches(data.stats) <= 0;
  const needTrainHist = !(hist?.trainHistory && hist.trainHistory.length > 0);
  if (!needCombat && !needTrainHist) return data;

  const heavy = await loadPlayerProfileHeavy(nick).catch(() => null);
  if (!heavy) return data;

  if (needCombat && (heavy.trainCombat?.matches || 0) > 0) {
    const prev =
      data.stats && typeof data.stats === "object"
        ? (data.stats as Record<string, unknown>)
        : {};
    data.stats = {
      ...prev,
      kvStats: heavy.kvStats ?? prev.kvStats ?? null,
      kvError: heavy.kvError ?? prev.kvError ?? null,
      trainCombat: heavy.trainCombat,
      publicCombat: heavy.publicCombat ?? prev.publicCombat ?? null,
    };
  }
  if (needTrainHist && heavy.trainHistory.length > 0) {
    const prev =
      data.histories && typeof data.histories === "object"
        ? (data.histories as Record<string, unknown>)
        : {};
    data.histories = {
      ...prev,
      trainHistory: heavy.trainHistory,
      trainTotal: heavy.trainTotal || heavy.trainHistory.length,
      publicHistory: prev.publicHistory ?? heavy.publicHistory,
      cwHistory: prev.cwHistory ?? heavy.cwHistory,
      publicTotal: prev.publicTotal ?? heavy.publicTotal,
      cwTotal: prev.cwTotal ?? heavy.cwTotal,
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
    if (storedHistoryCount(data.histories) === 0) {
      const histories = await loadReadyHistories(name).catch(() => null);
      if (histories && storedHistoryCount(histories) > 0) {
        data.histories = histories;
      }
    }
    return withLivePublicRp(
      name,
      await withLiveCombatIfEmpty(
        name,
        await withLiveTrainingIfEmpty(name, data)
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
  return withLivePublicRp(
    name,
    await withLiveCombatIfEmpty(
      name,
      await withLiveTrainingIfEmpty(name, base)
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
