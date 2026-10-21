/** Раздел «Турниры» — Fruit Strike Squad Cup и далее. */

export type TournamentTabId =
  | "tournaments"
  | "teams"
  | "player-stats"
  | "team-rating"
  | "match-history";

export type TournamentTab = {
  id: TournamentTabId;
  label: string;
  short: string;
};

export const TOURNAMENT_TABS: TournamentTab[] = [
  { id: "tournaments", label: "Турниры", short: "Турн." },
  { id: "teams", label: "Команды", short: "Ком." },
  { id: "player-stats", label: "Статистика игроков", short: "Статы" },
  { id: "team-rating", label: "Рейтинг команд", short: "Рейт." },
  { id: "match-history", label: "История матчей", short: "История" },
];

export const FRUIT_STRIKE_LOGO = "/tournaments/fruit-strike-logo-hq.png?v=2";

export type TournamentPrizeSlot = {
  place: 1 | 2 | 3;
  label: string;
  items: string[];
  imageSrc?: string | null;
};

/** Макс. игроков в турнирной команде (состав на сайте). */
export const TOURNAMENT_TEAM_ROSTER_MAX = 12;

/** Заявка на Fruit Strike: 8 основных + 2 замены. */
export const TOURNAMENT_ENTRY_STARTERS = 8;
export const TOURNAMENT_ENTRY_SUBS = 2;
export const TOURNAMENT_ENTRY_MAX =
  TOURNAMENT_ENTRY_STARTERS + TOURNAMENT_ENTRY_SUBS;

export type ActiveTournamentDraft = {
  id: string;
  name: string;
  logoSrc: string;
  announce: string | null;
  prizes: TournamentPrizeSlot[];
  rules: string | null;
  bracketHref: string | null;
  /** ISO date strings (день включительно, МСК) */
  regOpenDate: string; // YYYY-MM-DD
  regCloseDate: string;
  withdrawUntilDate: string;
  playDate: string;
  resultsDate: string;
  mapsRevealBeforeRegEndDays: number;
};

function mskDayStart(isoDay: string): Date {
  // МСК = UTC+3, день начинается 00:00 МСК
  return new Date(`${isoDay}T00:00:00+03:00`);
}

function mskDayEnd(isoDay: string): Date {
  return new Date(`${isoDay}T23:59:59.999+03:00`);
}

export function isRegistrationOpen(
  t: ActiveTournamentDraft,
  now = new Date()
): boolean {
  return now >= mskDayStart(t.regOpenDate) && now <= mskDayEnd(t.regCloseDate);
}

export function canWithdrawEntry(
  t: ActiveTournamentDraft,
  now = new Date()
): boolean {
  // Отмена заявки — только пока открыта регистрация и не позже срока отказа.
  if (!isRegistrationOpen(t, now)) return false;
  return now <= mskDayEnd(t.withdrawUntilDate);
}

/** Черновик активного турнира (Fruit Strike Squad Cup #01). */
export const ACTIVE_TOURNAMENT: ActiveTournamentDraft = {
  id: "fruit-strike-s1",
  name: "Fruit Strike Squad Cup Event #01",
  logoSrc: FRUIT_STRIKE_LOGO,
  regOpenDate: "2026-10-21",
  regCloseDate: "2026-10-30",
  withdrawUntilDate: "2026-10-29",
  playDate: "2026-10-31",
  resultsDate: "2026-11-01",
  mapsRevealBeforeRegEndDays: 5,
  announce: [
    "Fruit Strike Squad Cup Event #01",
    "",
    "Регистрация команд: 21.10.26 — 30.10.26",
    "Отказ от участия: до 29.10.26",
    "Дни проведения: 31.10.26",
    "Подведение итогов: 01.11.26",
    "",
    "Формат 8×8 · мод Fruit Cup League",
    "В заявке: до 8 основных + 2 замены (макс. 10 человек).",
    "Карты появятся в сетке за 5 дней до конца регистрации.",
  ].join("\n"),
  prizes: [
    {
      place: 1,
      label: "1 место",
      imageSrc: "/awards/fruit-strike-place1-trophy-v1.png",
      items: [
        "Кубок «Алый урожай» — в награды профиля",
        "10 000 ₽ — капитану команды",
        "Награду получают все игроки команды из заявки",
      ],
    },
    {
      place: 2,
      label: "2 место",
      imageSrc: "/bp-assets/fruit-strike-place2-ak-v2.png",
      items: [
        "Нашивка АК «Цитрусовый шторм» — в кастомизацию профиля",
        "Награду получают все игроки команды из заявки",
      ],
    },
    {
      place: 3,
      label: "3 место",
      imageSrc: "/profile-bgs/fruit-strike-place3-bg-v3.jpg",
      items: [
        "Фон «Тактический урожай» — в кастомизацию профиля",
        "Награду получают все игроки команды из заявки",
      ],
    },
  ],
  rules: [
    "1. Для данного турнира используется мод Fruit Cup League (FCL).",
    "2. Формат турнира — 8×8.",
    "3. Карты будут назначены и показаны в сетке турнира за 5 дней до окончания регистрации.",
    "4. В заявке на участие — не больше 10 человек: 8 основных игроков и 2 замены.",
    "5. Награды за 1–3 места указаны в блоке призов. Их получают все игроки команды, указанные в заявке.",
    "6. Денежный приз 10 000 ₽ за 1 место передаётся капитану команды, а не каждому игроку лично.",
    "7. Регламент игровых правил полностью совпадает с возможностями мода FCL: всё, что разрешено модом — разрешено регламентом.",
    "8. Состав команды любой: неважно, из каких кланов игроки.",
    "9. Регистрация команд: 21.10.26–30.10.26. Отменить заявку можно только в срок регистрации (отказ от участия — до 29.10.26).",
    "10. Заявку подаёт капитан: выбирает состав из своей команды в пределах лимита 8+2.",
  ].join("\n"),
  bracketHref: null,
};

/* ——— Команды (турнирные, не кланы) ——— */

export type TeamSubTabId = "overview" | "my-team";

export const TEAM_SUB_TABS: { id: TeamSubTabId; label: string }[] = [
  { id: "overview", label: "Общая" },
  { id: "my-team", label: "Моя команда" },
];

export type TournamentTeamRole =
  | "captain"
  | "deputy"
  | "starter"
  | "sub"
  | "reserve";

export const TOURNAMENT_TEAM_ROLE_LABEL: Record<TournamentTeamRole, string> = {
  captain: "Капитан",
  deputy: "Зам",
  starter: "Основной состав",
  sub: "Замена",
  reserve: "Резерв",
};

export function mapDbTeamRole(role: string): TournamentTeamRole {
  switch (role) {
    case "CAPTAIN":
      return "captain";
    case "DEPUTY":
      return "deputy";
    case "SUB":
      return "sub";
    case "RESERVE":
      return "reserve";
    default:
      return "starter";
  }
}

export type TournamentMatchHistoryRow = {
  id: string;
  dateLabel: string;
  teamA: string;
  teamB: string;
  map: string;
  score: string;
  result: "win" | "lose" | "pending" | string;
};

export const TOURNAMENT_MATCH_HISTORY_DRAFT: TournamentMatchHistoryRow[] = [];

export const TEAMS_SECTION_BLURB = [
  "Турнирная команда — это не клан.",
  "Клан живёт на платформе постоянно (КВ, тренировки, рейтинг).",
  "Команда собирается под конкретный турнир: свой тег, логотип и состав.",
  "Создать команду может любой игрок; заявку на турнир подаёт капитан (8 основных + 2 замены).",
].join("\n\n");

/* ——— Статистика / рейтинг игроков турнира ——— */

export type TournamentPlayerStatRow = {
  nick: string;
  clanTag: string | null;
  noks: number;
  kills: number;
  deaths: number;
  kd: number;
  matches: number;
  winPct: number;
  vehicles: number;
  mvpKiller: number;
  mvpMedic: number;
  mvpArmor: number;
};

export type TournamentPlayerStatSortKey =
  | "noks"
  | "kills"
  | "deaths"
  | "kd"
  | "matches"
  | "winPct"
  | "vehicles"
  | "mvpKiller"
  | "mvpMedic"
  | "mvpArmor"
  | "nick";

/* ——— Рейтинг команд ——— */

export type TournamentTeamRatingRow = {
  id: string;
  name: string;
  tag: string;
  logoSrc: string | null;
  matches: number;
  winPct: number;
  avgKd: number;
  tournamentsPlayed: number;
  titles: number;
};

export type TournamentTeamRatingSortKey =
  | "name"
  | "tag"
  | "matches"
  | "winPct"
  | "avgKd"
  | "tournamentsPlayed"
  | "titles";
