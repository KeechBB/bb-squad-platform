/**
 * Season 2 · Halloween Battle Pass — UI готов, заморожен.
 * Превью: /battle-pass/halloween-preview (Keech).
 * Прод: после паузы 01–03.11 → с 04.11 (см. battlePassSchedule.ts, docs/BP-SEASON2-READY.md).
 * Живой S1 (battlePass.ts) не трогаем до выката.
 */

import type { BpLevel, BpReward } from "@/lib/battlePass";
import { BP_LEVELS } from "@/lib/battlePass";

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

