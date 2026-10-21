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
