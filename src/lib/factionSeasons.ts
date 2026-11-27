/**
 * Сезоны фракций по временам года (МСК).
 * Season 1 = Осень 2026. Межсезонный аукцион с этой осени пропускаем —
 * первый рабочий цикл с конца зимы 2026/27.
 */

export type SeasonId = `S${number}`;

export type SeasonKey = "autumn" | "winter" | "spring" | "summer";

export type SeasonDef = {
  id: SeasonId;
  number: number;
  key: SeasonKey;
  /** «Осень 2026» */
  titleRu: string;
  /** «Season 1 Осень 2026» */
  label: string;
  /** YYYY-MM-DD МСК inclusive */
  startsOn: string;
  /** YYYY-MM-DD МСК inclusive */
  endsOn: string;
  /**
   * Межсезонный аукцион в последний день сезона.
   * false = пропускаем (как Осень 2026).
   */
  endAuctionEnabled: boolean;
};

/** Ценовые тиры для межсезонного аукциона (B$). */
export const SEASON_AUCTION_TIERS = [
  { tier: 5, label: "Тир 5", minBd: 50_000, maxBd: 100_000 },
  { tier: 4, label: "Тир 4", minBd: 100_000, maxBd: 150_000 },
  { tier: 3, label: "Тир 3", minBd: 150_000, maxBd: 200_000 },
  { tier: 2, label: "Тир 2", minBd: 200_000, maxBd: 250_000 },
  { tier: 1, label: "Тир 1", minBd: 250_000, maxBd: null },
] as const;

export const SEASON_AUCTION_HOURS = 24;
/** Сколько игроков разных тиров выставляет каждая фракция. */
export const SEASON_AUCTION_SLOTS = 5;

const SEASON_KEY_RU: Record<SeasonKey, string> = {
  autumn: "Осень",
  winter: "Зима",
  spring: "Весна",
  summer: "Лето",
};

/** Канон: S1 Осень 2026 → дальше по кругу. */
export const FACTION_SEASONS: SeasonDef[] = [
  {
    id: "S1",
    number: 1,
    key: "autumn",
    titleRu: "Осень 2026",
    label: "Season 1 Осень 2026",
    startsOn: "2026-09-01",
    endsOn: "2026-11-30",
    endAuctionEnabled: false,
  },
  {
    id: "S2",
    number: 2,
    key: "winter",
    titleRu: "Зима 2026/27",
    label: "Season 2 Зима 2026/27",
    startsOn: "2026-12-01",
    endsOn: "2027-02-28",
    endAuctionEnabled: true,
  },
  {
    id: "S3",
    number: 3,
    key: "spring",
    titleRu: "Весна 2027",
    label: "Season 3 Весна 2027",
    startsOn: "2027-03-01",
    endsOn: "2027-05-31",
    endAuctionEnabled: true,
  },
  {
    id: "S4",
    number: 4,
    key: "summer",
    titleRu: "Лето 2027",
    label: "Season 4 Лето 2027",
    startsOn: "2027-06-01",
    endsOn: "2027-08-31",
    endAuctionEnabled: true,
  },
  {
    id: "S5",
    number: 5,
    key: "autumn",
    titleRu: "Осень 2027",
    label: "Season 5 Осень 2027",
    startsOn: "2027-09-01",
    endsOn: "2027-11-30",
    endAuctionEnabled: true,
  },
];

function mskYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function seasonKeyRu(key: SeasonKey): string {
  return SEASON_KEY_RU[key];
}

export function findSeasonByYmd(ymd: string): SeasonDef | null {
  return (
    FACTION_SEASONS.find((s) => ymd >= s.startsOn && ymd <= s.endsOn) || null
  );
}

export function getCurrentSeason(now = new Date()): SeasonDef | null {
  return findSeasonByYmd(mskYmd(now));
}

export function getNextSeason(now = new Date()): SeasonDef | null {
  const ymd = mskYmd(now);
  return FACTION_SEASONS.find((s) => s.startsOn > ymd) || null;
}

export function formatYmdRu(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

export type SeasonTierDef = (typeof SEASON_AUCTION_TIERS)[number];

/** Игрок подходит под тир по текущей стоимости (верхняя граница не включена, кроме Тир 1). */
export function valueFitsTier(valueBd: number, tier: SeasonTierDef): boolean {
  const v = Math.max(0, Math.round(valueBd));
  if (tier.maxBd == null) return v >= tier.minBd;
  return v >= tier.minBd && v < tier.maxBd;
}

export function tierLabelForValue(valueBd: number): string | null {
  const v = Math.max(0, Math.round(valueBd));
  for (const t of SEASON_AUCTION_TIERS) {
    if (valueFitsTier(v, t)) return t.label;
  }
  return null;
}

export function tierDefByNumber(tier: number): SeasonTierDef | null {
  return SEASON_AUCTION_TIERS.find((t) => t.tier === tier) || null;
}

export function mskTodayYmd(now = new Date()): string {
  return mskYmd(now);
}

/** День межсезонных трансферов = последний день сезона (МСК), если аукцион включён. */
export function isSeasonTransferDay(
  season: SeasonDef | null,
  now = new Date(),
): boolean {
  if (!season || !season.endAuctionEnabled) return false;
  return mskYmd(now) === season.endsOn;
}

export function formatTierRangeRu(tier: SeasonTierDef): string {
  if (tier.maxBd == null) {
    return `от ${tier.minBd.toLocaleString("ru-RU")} B$ и выше`;
  }
  return `${tier.minBd.toLocaleString("ru-RU")} – ${tier.maxBd.toLocaleString("ru-RU")} B$`;
}

export function seasonAuctionRulesText(): string[] {
  return [
    "В последний день сезона командир или зам выставляют на аукцион 5 игроков разных ценовых тиров.",
    "Тир 5: 50–100 тыс. B$ · Тир 4: 100–150 · Тир 3: 150–200 · Тир 2: 200–250 · Тир 1: от 250 тыс.",
    "Если штаб не выставил — система выставляет сама (кроме игроков на контракте).",
    "Активный контракт защищает от сезонного трансферного окна — такого игрока выставить нельзя.",
    `Торги ${SEASON_AUCTION_HOURS} часа: побеждает наибольшая ставка.`,
    "В этот день фракция берёт не больше одного игрока каждого тира; в сумме может купить до 5 игроков (в т.ч. своей фракции).",
    "Осень 2026 (Season 1): межсезонный аукцион пропускаем. Первый рабочий — в конце зимы 2026/27.",
  ];
}

/** Кандидат на межсезон: тир по цене + нет активного контракта. */
export function isSeasonAuctionEligible(opts: {
  playerValue: number;
  hasContract: boolean;
  tier: SeasonTierDef;
}): boolean {
  if (opts.hasContract) return false;
  return valueFitsTier(opts.playerValue, opts.tier);
}

export function draftStorageKey(slug: string, seasonId: string): string {
  return `bb-season-draft:${slug}:${seasonId}`;
}
