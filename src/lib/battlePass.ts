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
  /** Своя картинка награды (превью сезонов); без неё — стандартные ассеты PB1 */
  image?: string;
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
    id: "pb1-aurum-clean",
    name: "Aurum Clean",
    short: "Золотой ник",
    kind: "nick",
    preview:
      "Металлический золотой стиль ника для рейтингов паблика, КВ и тренировок. Ставится и снимается в «Кастомизация профиля»",
    hover:
      "Aurum Clean · Награда за достижение 10 уровня Battle Pass Тестовый сезон",
  },
  {
    level: 15,
    id: "pb1-profile-customize",
    name: "M4A1 «Золотой стандарт»",
    short: "Нашивка",
    kind: "customize",
    preview:
      "Золотая M4A1 у ника в рейтингах паблика, КВ и тренировок. Ставится и снимается в «Кастомизация профиля»",
    hover:
      "M4A1 «Золотой стандарт» · Награда за достижение 15 уровня Battle Pass Тестовый сезон",
  },
  {
    level: 20,
    id: "pb1-best-tester",
    name: "Клубничный Импульс",
    short: "Медаль",
    kind: "medal",
    preview:
      "Розовая клубничная граната на золотом пьедестале Battle Pass S1 — финальная награда на полке профиля. Если к 31.10 23:59 никто не возьмёт 20 ур. — достанется ближайшему к финишу",
    hover:
      "Клубничный Импульс · 20 ур. BP «Фруктовый Сад». К 31.10 23:59 без финишера — ближайшему к 20 уровню",
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
    task: "5 ноков за один матч",
    target: 5,
    unit: "ноков",
  },
  {
    level: 3,
    title: "Стрелок",
    task: "5 убийств за один матч",
    target: 5,
    unit: "убийств",
  },
  {
    level: 4,
    title: "Медик",
    task: "5 ревайвов за один матч",
    target: 5,
    unit: "ревайвов",
  },
  {
    level: 5,
    title: "Технарь",
    task: "2 уничтоженной техники за один матч",
    target: 2,
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
    task: "5 убийств на Mutaha за один матч",
    target: 5,
    unit: "убийств",
  },
  {
    level: 8,
    title: "Стрик ревов",
    task: "≥10 ревайвов в каждом из 2 матчей подряд",
    hint: "Срыв серии → сброс 0/2",
    target: 2,
    unit: "матчей серии",
  },
  {
    level: 9,
    title: "Танки",
    task: "Уничтожить 1 танк (накопительно на уровне)",
    target: 1,
    unit: "танков",
  },
  {
    level: 10,
    title: "MVP Killer",
    task: "Заработать 1 MVP Убийца",
    hint: "Существующие MVP Killer с матча",
    target: 1,
    unit: "MVP",
  },
  {
    level: 11,
    title: "Марафон",
    task: "Сыграть 5 матчей (пока открыт этот уровень)",
    hint: "Матч в зачёт только при ≥80% времени в игре",
    target: 5,
    unit: "матчей",
  },
  {
    level: 12,
    title: "Окно 30",
    task: "Суммарно 30 убийств за фиксированные 5 матчей подряд",
    hint: "Вариант A: после 5-го если <30 — сброс окна. Прогресс N/30",
    target: 30,
    unit: "убийств",
  },
  {
    level: 13,
    title: "Небо",
    task: "Взорвать 1 вертолёт (накопительно на уровне)",
    target: 1,
    unit: "вертолётов",
  },
  {
    level: 14,
    title: "Победный стрик",
    task: "Победить 3 карты подряд",
    hint: "Поражение → сброс. Смена команды после 5-й минуты → матч не в зачёт",
    target: 3,
    unit: "побед",
  },
  {
    level: 15,
    title: "MVP Medic",
    task: "Заработать 1 MVP Медик",
    hint: "Существующие MVP Medic с матча",
    target: 1,
    unit: "MVP",
  },
  {
    level: 16,
    title: "Гринд",
    task: "Сыграть 5 матчей (пока открыт этот уровень)",
    hint: "Матч в зачёт только при ≥80% времени в игре",
    target: 5,
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
