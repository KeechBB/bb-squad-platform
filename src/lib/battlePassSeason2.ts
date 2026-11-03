/**
 * Season 2 · Halloween Battle Pass — UI готов, заморожен.
 * Превью: /battle-pass/halloween-preview (Keech).
 * Прод: после паузы 01–03.11 → с 04.11 (см. battlePassSchedule.ts, docs/BP-SEASON2-READY.md).
 * Живой S1 (battlePass.ts) не трогаем до выката.
 */

import type { BpLevel, BpReward } from "@/lib/battlePass";

/**
 * Лестница до 25. Ур. 1–5 — мягкий вход; дальше гринды и техника нарастают.
 * Пустыня (скор): Al Basrah / Mutaha / Tallil / Fallujah — в тексте задания
 * конкретные карты не светим.
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
    task: "6 ноков за один матч",
    target: 6,
    unit: "ноков",
  },
  {
    level: 7,
    title: "Очередь",
    task: "6 убийств за один матч",
    target: 6,
    unit: "убийств",
  },
  {
    level: 8,
    title: "Пехотки",
    task: "Уничтожить 5 пехоток (накопительно на уровне)",
    hint: "Лёгкая техника: logi / транспорт / лёгкие вооружённые (не MRAP, не БТР/БМП, не танк)",
    target: 5,
    unit: "пехоток",
  },
  {
    level: 9,
    title: "Носилки",
    task: "6 ревайвов за один матч",
    target: 6,
    unit: "ревайвов",
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
    title: "Полевой госпиталь",
    task: "50 ревайвов (накопительно на уровне)",
    hint: "Сумма ревов со всех матчей, пока открыт уровень",
    target: 50,
    unit: "ревайвов",
  },
  {
    level: 12,
    title: "Пустыня",
    task: "Сыграть 5 пустынных карт (накопительно на уровне)",
    hint: "Скор: Al Basrah / Mutaha / Tallil / Fallujah · любая комбинация · матч ≥80%",
    target: 5,
    unit: "карт",
  },
  {
    level: 13,
    title: "MRAP",
    task: "Уничтожить 3 MRAP (накопительно на уровне)",
    hint: "Только класс MRAP (не пехотка и не БТР/БМП)",
    target: 3,
    unit: "MRAP",
  },
  {
    level: 14,
    title: "Громче",
    task: "10 убийств за один матч",
    target: 10,
    unit: "убийств",
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
    title: "БТР",
    task: "Уничтожить 2 БТР (накопительно на уровне)",
    hint: "БТР/БМП (IFV/APC) · не MRAP и не танк",
    target: 2,
    unit: "БТР",
  },
  {
    level: 17,
    title: "Сотня",
    task: "100 убийств (накопительно на уровне)",
    hint: "Сумма киллов со всех матчей, пока открыт уровень",
    target: 100,
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
    title: "Танк",
    task: "Уничтожить 1 танк (накопительно на уровне)",
    target: 1,
    unit: "танков",
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
    task: "Закончить матч с ≥10 убийствами и ≤3 смертями",
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
    task: "За один матч: 8 ревайвов, 8 убийств и 1 уничтоженная техника",
    target: 1,
    unit: "матч",
  },
  {
    level: 24,
    title: "Разгром",
    task: "Победить с разницей более 150 тикетов",
    hint: "Смена команды после 5-й минуты → матч не в зачёт",
    target: 1,
    unit: "матч",
  },
  {
    level: 25,
    title: "Жатва",
    task: "15 убийств за один матч",
    target: 15,
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
    image: "/bp-halloween/profile-bg-v1.jpg?v=fog1",
  },
  {
    level: 15,
    id: "hw2-nick",
    name: "Алая жатва",
    short: "Текст",
    kind: "nick",
    preview:
      "Металлический алый ник — как Aurum, но в красных тонах",
    hover: "Алая жатва · ур. 15 Season 2 Halloween",
    image: "/bp-halloween/nick-v2.jpg?v=scarlet5",
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
  if (reward.id === "hw2-nick") return "/bp-halloween/nick-v2-cutout.png?v=scarlet5";
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
  if (reward.id === "hw2-nick") return "/bp-halloween/nick-v2-cutout.png?v=scarlet5";
  return reward.image || BP_S2_IDLE_ART;
}

