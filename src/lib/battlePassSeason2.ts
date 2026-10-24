/**
 * Season 2 · Halloween Battle Pass — только скрытое превью.
 * Живой S1 (battlePass.ts) не трогаем.
 */

import type { BpLevel, BpPlayerProgress, BpReward } from "@/lib/battlePass";
import { BP_LEVELS } from "@/lib/battlePass";
import { sortBattlePassRows } from "@/lib/battlePassData";

const S2_TAIL: BpLevel[] = [
  {
    level: 21,
    title: "Жатва",
    task: "Сыграть 3 матча (пока открыт этот уровень)",
    hint: "Черновик Season 2",
    target: 3,
    unit: "матчей",
  },
  {
    level: 22,
    title: "Тыквенный огонь",
    task: "10 ноков за один матч",
    target: 10,
    unit: "ноков",
  },
  {
    level: 23,
    title: "Ночной рейд",
    task: "Сыграть 5 матчей (пока открыт этот уровень)",
    target: 5,
    unit: "матчей",
  },
  {
    level: 24,
    title: "Безжалостный",
    task: "Победить 2 карты подряд",
    target: 2,
    unit: "побед",
  },
  {
    level: 25,
    title: "Король сада",
    task: "Закончить матч: >20 убийств, ≥10 ревайвов, 0 TK, 0 смертей",
    target: 1,
    unit: "матч",
  },
];

export const BP_S2_LEVELS: BpLevel[] = [...BP_LEVELS, ...S2_TAIL];

/**
 * Каждые 5 уровней — награда (канон схемы):
 * 5 нож · 10 фон · 15 текст · 20 пушка · 25 кубок
 */
export const BP_S2_REWARDS: BpReward[] = [
  {
    level: 5,
    id: "hw2-knife",
    name: "Крюк «Жнец сада»",
    short: "Нож",
    kind: "customize",
    preview:
      "Нашивка-крюк у ника в рейтингах. Ставится и снимается в «Кастомизация профиля»",
    hover: "Крюк «Жнец сада» · ур. 5 Season 2 Halloween",
    image: "/bp-halloween/knife-hook-v2.png",
  },
  {
    level: 10,
    id: "hw2-bg",
    name: "Ночной урожай",
    short: "Фон",
    kind: "bg",
    preview:
      "Фон профиля «Ночной урожай». Остаётся в списке фонов навсегда",
    hover: "Ночной урожай · ур. 10 Season 2 Halloween",
    image: "/bp-halloween/profile-bg-v1.jpg",
  },
  {
    level: 15,
    id: "hw2-nick",
    name: "Фиолетовая готика",
    short: "Текст",
    kind: "nick",
    preview:
      "Фиолетовый объёмный шрифт ника с кислотно-зелёной подсветкой для рейтингов",
    hover: "Фиолетовая готика · ур. 15 Season 2 Halloween",
    image: "/bp-halloween/nick-v2.jpg",
  },
  {
    level: 20,
    id: "hw2-gun",
    name: "АК «Тыквенный магазин»",
    short: "Пушка",
    kind: "customize",
    preview:
      "Нашивка АК у ника в рейтингах. Ставится и снимается в «Кастомизация профиля»",
    hover: "АК «Тыквенный магазин» · ур. 20 Season 2 Halloween",
    image: "/bp-halloween/weapon-ak-v2.png",
  },
  {
    level: 25,
    id: "hw2-trophy",
    name: "Кубок «Золотая тыква»",
    short: "Кубок",
    kind: "medal",
    preview:
      "Кубок за полное прохождение Season 2 — финальная награда на полке профиля",
    hover: "Кубок «Золотая тыква» · ур. 25 Season 2 Halloween",
    image: "/bp-halloween/trophy-v1-cutout.png",
  },
];

export const BP_S2_HERO_ART = "/bp-halloween/hero-squad.jpg";
export const BP_S2_IDLE_ART = "/bp-halloween/gallows-animated.webp";

/**
 * Крупный превью в правом окне.
 * Предметы — cutout PNG (без чёрного JPG-фона); фон профиля — сам арт сцены.
 */
export function s2RewardFullImage(reward: BpReward): string {
  if (reward.kind === "bg") return reward.image || BP_S2_IDLE_ART;
  if (reward.id === "hw2-knife") return "/bp-halloween/knife-hook-v2-cutout.png";
  if (reward.id === "hw2-gun") return "/bp-halloween/weapon-ak-v2-cutout.png";
  if (reward.id === "hw2-trophy") return "/bp-halloween/trophy-v1-cutout.png";
  if (reward.id === "hw2-nick") return "/bp-halloween/nick-v2-cutout.png";
  return reward.image || BP_S2_IDLE_ART;
}

/**
 * Иконка в круге: только вырезанный предмет на прозрачном фоне.
 * Фон (kind=bg) — сама картинка фона.
 */
export function s2RewardMileImage(reward: BpReward): string {
  if (reward.kind === "bg") return reward.image || BP_S2_IDLE_ART;
  if (reward.id === "hw2-knife") return "/bp-halloween/knife-hook-v2-cutout.png";
  if (reward.id === "hw2-gun") return "/bp-halloween/weapon-ak-v2-cutout.png";
  if (reward.id === "hw2-trophy") return "/bp-halloween/trophy-v1-cutout.png";
  if (reward.id === "hw2-nick") return "/bp-halloween/nick-v2-cutout.png";
  return reward.image || BP_S2_IDLE_ART;
}

/** Детерминированный 0..1 от ника — стабильная имитация между рефрешами. */
function previewSeed(nick: string): number {
  let h = 2166136261;
  const s = String(nick || "").trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function mockProgressForNick(
  nick: string,
  placeHint: number,
  levels: BpLevel[] = BP_S2_LEVELS
): BpPlayerProgress {
  const seed = previewSeed(nick);
  // Топ по RP → выше в BP; хвост — низкие уровни. Без выдачи наград.
  const placeBoost = Math.max(0, 1 - placeHint / 55);
  const mix = Math.min(0.98, seed * 0.35 + placeBoost * 0.72);
  const maxLv = levels.length;
  const currentLevel = Math.max(1, Math.min(maxLv, Math.floor(mix * maxLv) + 1));
  const L = levels[currentLevel - 1] || levels[0];
  const current = Math.min(
    L.target - (currentLevel >= maxLv ? 0 : 1),
    Math.max(0, Math.floor(seed * L.target * 0.85))
  );
  return {
    nick,
    currentLevel,
    current,
    target: L.target,
  };
}

/**
 * Только для /battle-pass/halloween-preview (Keech).
 * Реальные ники с трейн-рейтинга + фейковые уровни. Ничего не пишет в BP/инвентарь.
 */
export async function buildSeason2PreviewMockLeaderboard(opts?: {
  selfNick?: string;
  cap?: number;
}): Promise<{ board: BpPlayerProgress[]; self: BpPlayerProgress }> {
  const cap = Math.max(10, Math.min(50, opts?.cap ?? 50));
  const selfNick = String(opts?.selfNick || "").trim();

  let nicks: string[] = [];
  try {
    const { buildTrainRpLeaderboard } = await import("@/lib/trainRp");
    const board = await buildTrainRpLeaderboard();
    nicks = (board.rows || [])
      .map((r) => String(r.nick || "").trim())
      .filter(Boolean);
  } catch {
    nicks = [];
  }

  if (nicks.length < 12) {
    try {
      const { prisma } = await import("@/lib/prisma");
      const users = await prisma.user.findMany({
        where: { profileComplete: true, nick: { not: null } },
        select: { nick: true },
        take: 80,
        orderBy: { createdAt: "asc" },
      });
      for (const u of users) {
        const n = String(u.nick || "").trim();
        if (n && !nicks.includes(n)) nicks.push(n);
      }
    } catch {
      /* ignore */
    }
  }

  if (selfNick && !nicks.some((n) => n.toLowerCase() === selfNick.toLowerCase())) {
    nicks.unshift(selfNick);
  }

  const rows = nicks.slice(0, cap).map((nick, i) =>
    mockProgressForNick(nick, i + 1)
  );
  const board = sortBattlePassRows(rows);
  const self =
    board.find(
      (r) =>
        selfNick &&
        r.nick.trim().toLowerCase() === selfNick.toLowerCase()
    ) ||
    (selfNick
      ? mockProgressForNick(selfNick, 8)
      : mockProgressForNick("Keech", 8));

  return { board, self };
}
