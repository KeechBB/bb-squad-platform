/** Каркас раздела «Турниры» — данные заполним позже. */

export type TournamentTabId =
  | "tournaments"
  | "teams"
  | "player-stats"
  | "team-rating";

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
];

export const FRUIT_STRIKE_LOGO = "/tournaments/fruit-strike-logo.png";

export type TournamentPrizeSlot = {
  place: 1 | 2 | 3;
  label: string;
  /** Пока пусто — контент позже */
  items: string[];
};

export type ActiveTournamentDraft = {
  id: string;
  name: string;
  logoSrc: string;
  /** Анонс: даты / регистрация — позже */
  announce: string | null;
  prizes: TournamentPrizeSlot[];
  /** Правила / формат / карты / моды — позже */
  rules: string | null;
  /** Ссылка на сетку — позже */
  bracketHref: string | null;
  registrationOpen: boolean;
};

/** Черновик активного турнира (Fruit Strike Squad Cup #01). */
export const ACTIVE_TOURNAMENT: ActiveTournamentDraft = {
  id: "fruit-strike-s1",
  name: "Fruit Strike Squad Cup",
  logoSrc: FRUIT_STRIKE_LOGO,
  announce: null,
  prizes: [
    { place: 1, label: "1 место", items: [] },
    { place: 2, label: "2 место", items: [] },
    { place: 3, label: "3 место", items: [] },
  ],
  rules: null,
  bracketHref: null,
  registrationOpen: false,
};

/* ——— Команды (турнирные, не кланы) ——— */

export type TeamSubTabId = "overview" | "my-team";

export const TEAM_SUB_TABS: { id: TeamSubTabId; label: string }[] = [
  { id: "overview", label: "Общая" },
  { id: "my-team", label: "Моя команда" },
];

/** Сколько слотов в турнирной команде (позже уточним). */
export const TOURNAMENT_TEAM_ROSTER_MAX = 8;

/** Роли внутри турнирной команды (не путать с клановыми). */
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

export type TournamentTeamMemberDraft = {
  id: string;
  nick: string;
  joinedAt: string;
  role: TournamentTeamRole;
  /** Клан на сайте — позже с профиля */
  clanName: string | null;
};

export type TournamentTeamDraft = {
  id: string;
  name: string;
  tag: string;
  logoSrc: string | null;
  createdAt: string; // ISO date
  membersCount: number;
  rosterMax: number;
  members: TournamentTeamMemberDraft[];
  /** Исходящие инвайты в команду — позже */
  pendingInvites: { nick: string; sentAt: string }[];
  /** Инвайты на ивенты от площадки — позже */
  eventInvites: { title: string; note: string }[];
};

/** Пока пусто — список придёт с бэка. */
export const TOURNAMENT_TEAMS_DRAFT: TournamentTeamDraft[] = [];

export const TEAMS_SECTION_BLURB = [
  "Турнирная команда — это не клан.",
  "Клан живёт на платформе постоянно (КВ, тренировки, рейтинг).",
  "Команда собирается под конкретный турнир: свой тег, логотип и состав.",
  "Создать команду может любой игрок; заявку на турнир подаёт капитан, когда набран нужный состав.",
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

/** Пока пусто — подтянем с матчей турнира. */
export const TOURNAMENT_PLAYER_STATS_DRAFT: TournamentPlayerStatRow[] = [];

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
  /** Сколько турниров команда сыграла */
  tournamentsPlayed: number;
  /** Сколько раз взяли 1 место */
  titles: number;
};

export const TOURNAMENT_TEAM_RATING_DRAFT: TournamentTeamRatingRow[] = [];

export type TournamentTeamRatingSortKey =
  | "name"
  | "tag"
  | "matches"
  | "winPct"
  | "avgKd"
  | "tournamentsPlayed"
  | "titles";
