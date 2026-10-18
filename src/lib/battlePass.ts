/**
 * Battle Pass — тестовый сезон PB1.
 * Подсчёт прогресса выключен: только каталог уровней и наград.
 */

export const BP_SEASON_ID = "pb1-2026-10";

export const BP_SEASON = {
  id: BP_SEASON_ID,
  title: "BATTLE PASS",
  subtitle: "Тестовый сезон · PB1",
  startLabel: "18.10.2026",
  endLabel: "31.10.2026",
  note: "Подсчёт прогресса пока выключен — смотрим вёрстку и задания.",
} as const;

export type BpRewardKind = "badge" | "frame" | "nick" | "medal";

export type BpReward = {
  level: number;
  id: string;
  name: string;
  short: string;
  kind: BpRewardKind;
  /** Как выглядит / где висит */
  preview: string;
  /** Текст при наведении (медаль и т.п.) */
  hover?: string;
};

export type BpLevel = {
  level: number;
  title: string;
  task: string;
  /** Подсказка для будущего скорера */
  hint?: string;
  /** Цель для UI прогресса (когда включим подсчёт) */
  target: number;
  unit: string;
};

/** Награды каждые 5 уровней. */
export const BP_REWARDS: BpReward[] = [
  {
    level: 5,
    id: "pb1-scout-spark",
    name: "Искра разведки",
    short: "Значок",
    kind: "badge",
    preview:
      "В шапке профиля, сразу под ником — маленький золотой значок «Искра»",
  },
  {
    level: 10,
    id: "pb1-iron-frame",
    name: "Бронелист",
    short: "Рамка",
    kind: "frame",
    preview: "Металлическая рамка вокруг аватара в профиле",
  },
  {
    level: 15,
    id: "pb1-gold-nick",
    name: "Золотой ник",
    short: "Цвет ника",
    kind: "nick",
    preview:
      "Ник цветом Battle Pass (золото) в рейтинге паблика и везде на сайте — у всех с этой наградой одинаково",
  },
  {
    level: 20,
    id: "pb1-best-tester",
    name: "Лучший тестировщик",
    short: "Медаль",
    kind: "medal",
    preview:
      "Медаль слева в профиле под аватаром; наведение — за что выдана",
    hover:
      "Лучший тестировщик · Battle Pass PB1 · дошёл до 20 уровня (18–31.10.2026)",
  },
];

export const BP_LEVELS: BpLevel[] = [
  {
    level: 1,
    title: "Вход",
    task: "Сыграть 1 матч на PB1",
    target: 1,
    unit: "матч",
  },
  {
    level: 2,
    title: "Нокаут",
    task: "15 ноков за один матч",
    target: 15,
    unit: "ноков",
  },
  {
    level: 3,
    title: "Стрелок",
    task: "15 убийств за один матч",
    target: 15,
    unit: "убийств",
  },
  {
    level: 4,
    title: "Медик",
    task: "15 ревайвов за один матч",
    target: 15,
    unit: "ревайвов",
  },
  {
    level: 5,
    title: "Технарь",
    task: "5 уничтоженной техники за один матч",
    target: 5,
    unit: "техники",
  },
  {
    level: 6,
    title: "Разгон",
    task: "Сыграть 3 матча (пока открыт этот уровень)",
    hint: "Счётчик матчей с момента открытия уровня",
    target: 3,
    unit: "матчей",
  },
  {
    level: 7,
    title: "Mutaha",
    task: "15 убийств на Mutaha за один матч",
    target: 15,
    unit: "убийств",
  },
  {
    level: 8,
    title: "Стрик ревов",
    task: "≥10 ревайвов в каждом из 3 матчей подряд",
    hint: "Срыв серии → сброс 0/3",
    target: 3,
    unit: "матчей серии",
  },
  {
    level: 9,
    title: "Танки",
    task: "Уничтожить 5 танков (накопительно на уровне)",
    target: 5,
    unit: "танков",
  },
  {
    level: 10,
    title: "MVP Killer",
    task: "Заработать 3 MVP Убийца",
    hint: "Существующие MVP Killer с матча",
    target: 3,
    unit: "MVP",
  },
  {
    level: 11,
    title: "Марафон",
    task: "Сыграть 10 матчей (пока открыт этот уровень)",
    target: 10,
    unit: "матчей",
  },
  {
    level: 12,
    title: "Окно 100",
    task: "Суммарно 100 убийств за фиксированные 5 матчей подряд",
    hint: "Вариант A: после 5-го если <100 — сброс окна. Прогресс N/100",
    target: 100,
    unit: "убийств",
  },
  {
    level: 13,
    title: "Небо",
    task: "Взорвать 5 вертолётов (накопительно на уровне)",
    target: 5,
    unit: "вертолётов",
  },
  {
    level: 14,
    title: "Победный стрик",
    task: "Победить 5 карт подряд",
    hint: "Поражение → сброс серии",
    target: 5,
    unit: "побед",
  },
  {
    level: 15,
    title: "MVP Medic",
    task: "Заработать 3 MVP Медик",
    hint: "Существующие MVP Medic с матча",
    target: 3,
    unit: "MVP",
  },
  {
    level: 16,
    title: "Гринд",
    task: "Сыграть 15 матчей (пока открыт этот уровень)",
    target: 15,
    unit: "матчей",
  },
  {
    level: 17,
    title: "Чистая катка",
    task: "Закончить матч с ≥10 убийствами и ≤1 смертью",
    target: 1,
    unit: "матч",
  },
  {
    level: 18,
    title: "Три в одном",
    task: "За один матч: 10 ревайвов, 10 убийств и 1 уничтоженная техника",
    target: 1,
    unit: "матч",
  },
  {
    level: 19,
    title: "Разгром",
    task: "Победить с разницей более 300 тикетов",
    target: 1,
    unit: "матч",
  },
  {
    level: 20,
    title: "Легенда сезона",
    task: "Закончить матч: >30 убийств, ≥10 ревайвов, 0 TK, 0 смертей",
    target: 1,
    unit: "матч",
  },
];

export function rewardForLevel(level: number): BpReward | undefined {
  return BP_REWARDS.find((r) => r.level === level);
}

/** Заглушка прогресса: всё на уровне 1, current=0. Подсчёт не ведём. */
export type BpPlayerProgress = {
  nick: string;
  steamId?: string;
  currentLevel: number;
  /** Прогресс текущего задания */
  current: number;
  target: number;
  completedAt?: string | null;
};

export function emptySelfProgress(nick: string): BpPlayerProgress {
  const L1 = BP_LEVELS[0];
  return {
    nick,
    currentLevel: 1,
    current: 0,
    target: L1.target,
  };
}

/** Рейтинг пустой, пока не включим подсчёт */
export function emptyLeaderboard(): BpPlayerProgress[] {
  return [];
}
