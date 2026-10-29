import { promises as fs } from "node:fs";
import { prisma } from "@/lib/prisma";
import { readSnapshot, snapshotFile, writeSnapshot } from "@/lib/diskSnapshot";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { loadUserPublicAttendanceStats } from "@/lib/publicAttendance";
import { buildPlayerPublicCombatStats } from "@/lib/publicCombat";
import { lookupPlayerPublicRp } from "@/lib/publicRp";
import { lookupPlayerTrainPwr } from "@/lib/homeTrainPwr";
import { loadPlayerProfileHeavy } from "@/lib/playerProfileHeavy";
import { loadReadyHistories } from "@/lib/profileMatchLines";
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
 * Только готовый файл. Пустые истории в старом файле добираем готовыми
 * строками из базы — это чтение, не пересчёт. Нет файла — пустая оболочка.
 * Запрос страницы сборку не запускает.
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
    return data;
  }
  const histories = await loadReadyHistories(name).catch(() => null);
  const base = emptyPayload();
  if (histories) base.histories = histories;
  return base;
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
