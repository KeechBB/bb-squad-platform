/**
 * Season 2 · Halloween Battle Pass — UI готов, заморожен.
 * Превью: /battle-pass/halloween-preview (Keech).
 * Прод: после паузы 01–03.11 → с 04.11 (см. battlePassSchedule.ts, docs/BP-SEASON2-READY.md).
 * Живой S1 (battlePass.ts) не трогаем до выката.
 */

import type { BpLevel, BpReward } from "@/lib/battlePass";

/**
 * Те же типы, что у сезона 1, но лестница до 25 и цифры ниже.
 * Финал — 10 убийств за матч, без связки «20 киллов + ревы + 0 смертей».
 */
export const BP_S2_LEVELS: BpLevel[] = [
  {
    level: 1,
    title: "Калитка",
    task: "Сыграть 1 матч на Фруктовом Саде",
    hint: "Зачёт только если провёл ≥80% матча. SEED не считается",
    target: 1,
    unit: "матч",
  },
  {
    level: 2,
    title: "Царапина",
    task: "3 нока за один матч",
    target: 3,
    unit: "ноков",
  },
  {
    level: 3,
    title: "Три пули",
    task: "3 убийства за один матч",
    target: 3,
    unit: "убийств",
  },
  {
    level: 4,
    title: "Бинт",
    task: "3 ревайва за один матч",
    target: 3,
    unit: "ревайвов",
  },
  {
    level: 5,
    title: "Смена",
    task: "Сыграть 2 матча (пока открыт этот уровень)",
    hint: "Счётчик с открытия уровня · матч ≥80% времени в игре",
    target: 2,
    unit: "матчей",
  },
  {
    level: 6,
    title: "Нокаут",
    task: "5 ноков за один матч",
    target: 5,
    unit: "ноков",
  },
  {
    level: 7,
    title: "Очередь",
    task: "5 убийств за один матч",
    target: 5,
    unit: "убийств",
  },
  {
    level: 8,
    title: "Носилки",
    task: "5 ревайвов за один матч",
    target: 5,
    unit: "ревайвов",
  },
  {
    level: 9,
    title: "Колесо",
    task: "1 уничтоженная техника за один матч",
    target: 1,
    unit: "техники",
  },
  {
    level: 10,
    title: "Ночь",
    task: "Сыграть 3 матча (пока открыт этот уровень)",
    hint: "Счётчик с открытия уровня · матч ≥80% времени в игре",
    target: 3,
    unit: "матчей",
  },
  {
    level: 11,
    title: "Громче",
    task: "8 ноков за один матч",
    target: 8,
    unit: "ноков",
  },
  {
    level: 12,
    title: "Mutaha",
    task: "3 убийства на Mutaha за один матч",
    target: 3,
    unit: "убийств",
  },
  {
    level: 13,
    title: "Серия бинтов",
    task: "≥5 ревайвов в каждом из 2 матчей подряд",
    hint: "Срыв серии → сброс 0/2",
    target: 2,
    unit: "матчей серии",
  },
  {
    level: 14,
    title: "Танк",
    task: "Уничтожить 1 танк (накопительно на уровне)",
    target: 1,
    unit: "танков",
  },
  {
    level: 15,
    title: "Марафон",
    task: "Сыграть 4 матча (пока открыт этот уровень)",
    hint: "Матч в зачёт только при ≥80% времени в игре",
    target: 4,
    unit: "матчей",
  },
  {
    level: 16,
    title: "Гараж",
    task: "Уничтожить 2 единицы техники (накопительно на уровне)",
    target: 2,
    unit: "техники",
  },
  {
    level: 17,
    title: "Окно 15",
    task: "Суммарно 15 убийств за 3 матча подряд",
    hint: "После 3-го если меньше 15 — окно сбрасывается",
    target: 15,
    unit: "убийств",
  },
  {
    level: 18,
    title: "Две победы",
    task: "Победить 2 карты подряд",
    hint: "Поражение → сброс. Смена команды после 5-й минуты → матч не в зачёт",
    target: 2,
    unit: "побед",
  },
  {
    level: 19,
    title: "Небо",
    task: "Взорвать 1 вертолёт (накопительно на уровне)",
    target: 1,
    unit: "вертолётов",
  },
  {
    level: 20,
    title: "Гринд",
    task: "Сыграть 5 матчей (пока открыт этот уровень)",
    hint: "Матч в зачёт только при ≥80% времени в игре",
    target: 5,
    unit: "матчей",
  },
  {
    level: 21,
    title: "Чистая катка",
    task: "Закончить матч с ≥8 убийствами и ≤3 смертями",
    target: 1,
    unit: "матч",
  },
  {
    level: 22,
    title: "MVP Killer",
    task: "Заработать 1 MVP Убийца",
    hint: "Существующие MVP Killer с матча",
    target: 1,
    unit: "MVP",
  },
  {
    level: 23,
    title: "Три в одном",
    task: "За один матч: 5 ревайвов, 5 убийств и 1 уничтоженная техника",
    target: 1,
    unit: "матч",
  },
  {
    level: 24,
    title: "Разгром",
    task: "Победить с разницей более 100 тикетов",
    hint: "Смена команды после 5-й минуты → матч не в зачёт",
    target: 1,
    unit: "матч",
  },
  {
    level: 25,
    title: "Жатва",
    task: "10 убийств за один матч",
    target: 10,
    unit: "убийств",
  },
];

/**
 * Каждые 5 уровней — награда (канон схемы):
 * 5 нож · 10 фон · 15 текст · 20 пушка · 25 статуэтка
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
    image: "/bp-halloween/knife-hook-v2.png?v=blood1",
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
    name: "Алая жатва",
    short: "Текст",
    kind: "nick",
    preview:
      "Ярко-алый неоновый ник — плоские чёткие буквы",
    hover: "Алая жатва · ур. 15 Season 2 Halloween",
    image: "/bp-halloween/nick-v2.jpg?v=scarlet1",
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
    image: "/bp-halloween/weapon-ak-v2.png?v=blood1",
  },
  {
    level: 25,
    id: "hw2-trophy",
    name: "Гранат «Кровавая жатва»",
    short: "Статуэтка",
    kind: "medal",
    preview:
      "Статуэтка за полное прохождение Season 2 — финальная награда на полке профиля",
    hover: "Гранат «Кровавая жатва» · ур. 25 Season 2 Halloween",
    image: "/bp-halloween/pomegranate-relic-v1-cutout.png?v=3",
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
  if (reward.id === "hw2-knife") return "/bp-halloween/knife-hook-v2-cutout.png?v=blood1";
  if (reward.id === "hw2-gun") return "/bp-halloween/weapon-ak-v2-cutout.png?v=blood1";
  if (reward.id === "hw2-trophy") return "/bp-halloween/pomegranate-relic-v1-cutout.png?v=3";
  if (reward.id === "hw2-nick") return "/bp-halloween/nick-v2-cutout.png?v=scarlet1";
  return reward.image || BP_S2_IDLE_ART;
}

/**
 * Иконка в круге: только вырезанный предмет на прозрачном фоне.
 * Фон (kind=bg) — сама картинка фона.
 */
export function s2RewardMileImage(reward: BpReward): string {
  if (reward.kind === "bg") return reward.image || BP_S2_IDLE_ART;
  if (reward.id === "hw2-knife") return "/bp-halloween/knife-hook-v2-cutout.png?v=blood1";
  if (reward.id === "hw2-gun") return "/bp-halloween/weapon-ak-v2-cutout.png?v=blood1";
  if (reward.id === "hw2-trophy") return "/bp-halloween/pomegranate-relic-v1-cutout.png?v=3";
  if (reward.id === "hw2-nick") return "/bp-halloween/nick-v2-cutout.png?v=scarlet1";
  return reward.image || BP_S2_IDLE_ART;
}

