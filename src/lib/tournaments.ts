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

export const TOURNAMENT_BETS_HREF = "/tournaments/bets";

export function isTournamentTab(value: string | undefined): value is TournamentTabId {
  return TOURNAMENT_TABS.some((tab) => tab.id === value);
}

export function tournamentTabHref(id: TournamentTabId): string {
  return id === "tournaments" ? "/tournaments" : `/tournaments?tab=${id}`;
}

export const FRUIT_STRIKE_LOGO =
  "/tournaments/fruit-strike-logo-hq.png?v=20261021-blue-gold-transparent";

export type TournamentPrizeSlot = {
  place: 1 | 2 | 3;
  label: string;
  items: string[];
  imageSrc?: string | null;
  /** Главный денежный приз (командный, через капитана) */
  cashBanner?: { amount: string; note: string } | null;
  /** Подпись при наведении на картинку награды */
  hoverTip?: string | null;
};

/** Макс. игроков в турнирной команде (состав на сайте). На матч всё равно заявка. */
export const TOURNAMENT_TEAM_ROSTER_MAX = 50;

/** Заявка на Fruit Strike: 8 основных + 2 замены. */
export const TOURNAMENT_ENTRY_STARTERS = 8;
export const TOURNAMENT_ENTRY_SUBS = 2;
export const TOURNAMENT_ENTRY_MAX =
  TOURNAMENT_ENTRY_STARTERS + TOURNAMENT_ENTRY_SUBS;

export type ActiveTournamentDraft = {
  id: string;
  name: string;
  logoSrc: string;
  /** @deprecated — используй announceSchedule / announceFormat */
  announce: string | null;
  /** Левая колонка анонса: даты / регистрация */
  announceSchedule: string[];
  /** Правая колонка анонса: формат / состав / карты */
  announceFormat: string[];
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

/** День ISO → ДД.ММ.ГГ */
export function formatTourDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-");
  if (!y || !m || !d) return isoDay;
  return `${d}.${m}.${y.slice(2)}`;
}

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
  // Открыта с 00:00 дня открытия до 23:59:59 дня закрытия (МСК).
  // С 00:00 следующего дня (для #01 = 31.10) — закрыта.
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

/** Фаза турнира для баннеров и CTA. */
export type TournamentPhase =
  | "registration"
  | "upcoming"
  | "live"
  | "results";

export function tournamentPhase(
  t: ActiveTournamentDraft,
  now = new Date()
): TournamentPhase {
  if (isRegistrationOpen(t, now)) return "registration";
  if (now < mskDayStart(t.playDate)) return "upcoming";
  if (now <= mskDayEnd(t.playDate)) return "live";
  return "results";
}

/** Текст CTA на главной / в анонсе. */
export function tournamentHomeCta(
  t: ActiveTournamentDraft,
  now = new Date()
): string {
  const phase = tournamentPhase(t, now);
  if (phase === "registration") return "Регистрация открыта — перейти →";
  if (phase === "upcoming") return "Регистрация закрыта · завтра игры →";
  if (phase === "live") return "Регистрация закрыта · идут игры турнира →";
  return "Турнир завершён · смотреть итоги →";
}

/** Короткая строка статуса под заголовком на главной. */
export function tournamentHomeStatusLine(
  t: ActiveTournamentDraft,
  now = new Date()
): { lead: string; emphasis: string; rest: string } {
  const phase = tournamentPhase(t, now);
  const play = formatTourDay(t.playDate);
  if (phase === "registration") {
    return {
      lead: "Регистрация",
      emphasis: `${formatTourDay(t.regOpenDate)} — ${formatTourDay(t.regCloseDate)}`,
      rest: `· игра ${play} · приз 10 000 ₽`,
    };
  }
  if (phase === "upcoming") {
    return {
      lead: "Регистрация закрыта",
      emphasis: `завтра игры · ${play}`,
      rest: "· приз 10 000 ₽",
    };
  }
  if (phase === "live") {
    return {
      lead: "Регистрация закрыта",
      emphasis: `сегодня идут игры · ${play}`,
      rest: "· приз 10 000 ₽",
    };
  }
  return {
    lead: "Регистрация закрыта",
    emphasis: "турнир завершён",
    rest: `· итоги ${formatTourDay(t.resultsDate)} · приз 10 000 ₽`,
  };
}

/** Черновик активного турнира (Fruit Strike Squad Cup #01). */
export const ACTIVE_TOURNAMENT: ActiveTournamentDraft = {
  id: "fruit-strike-s1",
  name: "Fruit Strike Squad Cup Event #01",
  logoSrc: FRUIT_STRIKE_LOGO,
  regOpenDate: "2026-10-21",
  regCloseDate: "2026-10-30",
  withdrawUntilDate: "2026-10-30",
  playDate: "2026-10-31",
  resultsDate: "2026-11-01",
  mapsRevealBeforeRegEndDays: 5,
  announce: null,
  announceSchedule: [
    "Регистрация команд: 21.10.26 — 30.10.26",
    "Отказ от участия: до конца регистрации 30.10.26",
    "Дни проведения: 31.10.26",
    "Подведение итогов: 01.11.26",
  ],
  announceFormat: [
    "Формат 8×8 · мод Fruit Cup League",
    "Заявка: 8 основных + 2 замены (макс. 10).",
    "В команде — только игроки с аккаунтом на сайте.",
    "Карты FCL назначены в сетке · матч = R1+R2 · победа по сумме тикетов.",
  ],
  prizes: [
    {
      place: 1,
      label: "1 место",
      imageSrc: "/awards/fruit-strike-place1-trophy-v1.png",
      hoverTip:
        "Кубок «Алый урожай» — в награды профиля всем игрокам из заявки",
      cashBanner: {
        amount: "10 000 ₽",
        note: "Командный приз · выдаётся капитану",
      },
      items: [
        "Кубок «Алый урожай» — всем из заявки",
      ],
    },
    {
      place: 2,
      label: "2 место",
      imageSrc: "/bp-assets/fruit-strike-place2-ak-v2.png",
      hoverTip:
        "Нашивка АК «Цитрусовый шторм» — в кастомизацию профиля всем из заявки",
      items: [
        "Нашивка АК «Цитрусовый шторм» — всем из заявки",
      ],
    },
    {
      place: 3,
      label: "3 место",
      imageSrc: "/profile-bgs/fruit-strike-place3-bg-v3.jpg",
      hoverTip:
        "Фон «Тактический урожай» — в кастомизацию профиля всем из заявки",
      items: [
        "Фон «Тактический урожай» — всем из заявки",
      ],
    },
  ],
  rules: [
    "1. Для данного турнира используется мод Fruit Cup League (FCL).",
    "2. Формат турнира — 8×8.",
    "3. Карты FCL 8×8 назначены на каждый матч сетки (слой вида FCL_Map_v1 / FCL_Map_v2).",
    "3a. Каждый матч — два раунда (R1 и R2). Победа во встрече считается по сумме тикетов за оба раунда (не по счёту раундов 2–0 / 1–1).",
    "3b. Фракции по умолчанию: слева USA, справа RGF.",
    "4. В заявке на участие — не больше 10 человек: 8 основных игроков и 2 замены.",
    "5. Награды за 1–3 места указаны в блоке призов. Их получают все игроки команды, указанные в заявке.",
    "6. Главный приз 10 000 ₽ — командный: побеждает вся команда из заявки, сумма передаётся капитану для команды (это не личная награда капитана).",
    "7. Регламент игровых правил полностью совпадает с возможностями мода FCL: всё, что разрешено модом — разрешено регламентом.",
    "8. Состав команды любой: неважно, из каких кланов игроки.",
    "9. Создавать команду и принимать игроков можно только среди зарегистрированных на сайте (Steam + заполненный профиль). Без аккаунта на платформе в команду не попасть.",
    "10. Регистрация команд: 21.10.26–30.10.26. Отменить заявку можно до конца этого срока, потом поменять состав и зарегистрироваться снова.",
    "11. Заявку на турнир подаёт капитан или зам: выбирает состав из своей команды в пределах лимита 8+2.",
  ].join("\n"),
  bracketHref: "/tournaments/bracket",
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

/** Тег турнирной команды: 1–6 букв или цифр, без пробелов. */
export const TEAM_TAG_RE = /^[A-Za-zА-Яа-яЁё0-9]{1,6}$/;
export const TEAM_NAME_RE = /^[A-Za-zА-Яа-яЁё0-9 _.\-]{2,32}$/;

export function normalizeTeamTag(raw: string): string {
  return raw.trim().toUpperCase();
}

/** null — название и тег годятся. */
export function teamIdentityError(name: string, tag: string): string | null {
  const n = name.trim();
  const t = normalizeTeamTag(tag);
  if (n.length < 2 || n.length > 32) return "Название 2–32 символа";
  if (!TEAM_NAME_RE.test(n)) return "Недопустимое название";
  if (!TEAM_TAG_RE.test(t)) return "Тег: 1–6 букв или цифр";
  return null;
}

export const TEAMS_SECTION_BLURB = [
  "Турнирная команда — это не клан.",
  "Клан живёт на платформе постоянно (КВ, тренировки, рейтинг).",
  "Команда собирается под конкретный турнир: свой тег, логотип и состав.",
  "Создать команду и приглашать игроков можно только среди зарегистрированных на сайте (Steam + заполненный профиль).",
  "Заявку на турнир подаёт капитан или зам (8 основных + 2 замены).",
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
