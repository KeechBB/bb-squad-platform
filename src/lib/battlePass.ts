/**
 * Battle Pass — тестовый сезон «Фруктовый Сад».
 * Подсчёт: scripts/build_battle_pass.py ← build_public_rp_ledger (со следующей карты).
 */

export const BP_SEASON_ID = "pb1-2026-10";

export const BP_SEASON = {
  id: BP_SEASON_ID,
  title: "BATTLE PASS",
  subtitle: "Тестовый сезон · Фруктовый Сад",
  startLabel: "18.10.2026",
  endLabel: "31.10.2026",
  note: "Считаем с следующей карты на Фруктовом Саде (зарегистрированные).",
} as const;

export type BpRewardKind =
  | "badge"
  | "frame"
  | "nick"
  | "medal"
  | "bg"
  | "customize";

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
    id: "pb1-gold-bg",
    name: "Турнирное золото II",
    short: "Фон",
    kind: "bg",
    preview:
      "Турнирное золото II — фон профиля. Остаётся в списке фонов навсегда",
  },
  {
    level: 10,
    id: "pb1-iron-frame",
    name: "Бронелист",
    short: "Рамка",
    kind: "frame",
    preview: "Золотая рамка вокруг аватара в профиле",
  },
  {
    level: 15,
    id: "pb1-profile-customize",
    name: "Кастомизация профиля",
    short: "Нашивки + фон",
    kind: "customize",
    preview:
      "Кнопка «Кастомизация профиля»: нашивки в рейтингах (паблик / КВ / тренировки) и выбор фона",
    hover:
      "Награда за достижение 15го уровня Battle Pass Тестовый сезон",
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
      "Лучший тестировщик · Battle Pass «Фруктовый Сад» · дошёл до 20 уровня (18–31.10.2026)",
  },
];

export const BP_LEVELS: BpLevel[] = [
  {
    level: 1,
    title: "Вход",
    task: "Сыграть 1 матч на Фруктовом Саде",
    hint: "Зачёт только если провёл ≥80% матча. SEED не считается",
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
    task: "10 убийств за один матч",
    target: 10,
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
    task: "3 уничтоженной техники за один матч",
    target: 3,
    unit: "техники",
  },
  {
    level: 6,
    title: "Разгон",
    task: "Сыграть 3 матча (пока открыт этот уровень)",
    hint: "Счётчик с открытия уровня · матч ≥80% времени в игре",
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
    task: "Уничтожить 2 танка (накопительно на уровне)",
    target: 2,
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
    hint: "Матч в зачёт только при ≥80% времени в игре",
    target: 10,
    unit: "матчей",
  },
  {
    level: 12,
    title: "Окно 60",
    task: "Суммарно 60 убийств за фиксированные 5 матчей подряд",
    hint: "Вариант A: после 5-го если <60 — сброс окна. Прогресс N/60",
    target: 60,
    unit: "убийств",
  },
  {
    level: 13,
    title: "Небо",
    task: "Взорвать 2 вертолёта (накопительно на уровне)",
    target: 2,
    unit: "вертолётов",
  },
  {
    level: 14,
    title: "Победный стрик",
    task: "Победить 5 карт подряд",
    hint: "Поражение → сброс. Смена команды после 5-й минуты → матч не в зачёт",
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
    hint: "Матч в зачёт только при ≥80% времени в игре",
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
    hint: "Смена команды после 5-й минуты → матч не в зачёт",
    target: 1,
    unit: "матч",
  },
  {
    level: 20,
    title: "Легенда сезона",
    task: "Закончить матч: >20 убийств, ≥10 ревайвов, 0 TK, 0 смертей",
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
