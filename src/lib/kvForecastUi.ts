/** Client-safe forecast types + labels (no Node fs). */

export type ForecastFactor = {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
};

export type MatchForecast = {
  winPct: number;
  drawPct: number;
  losePct: number;
  confidence: "low" | "medium" | "high";
  summary: string;
  factors: ForecastFactor[];
};

export type UpcomingMatchPreview = {
  key: string;
  day: number;
  month: number;
  year: number;
  timeMsk: string;
  opp: string;
  map: string;
  mapShort: string;
  size: string;
  stack: string;
  server: string;
  rules: string;
  note: string | null;
  forecast: MatchForecast;
};

const MONTH_RU = [
  "",
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export function formatMatchDate(day: number, month: number, year: number): string {
  const mon = MONTH_RU[month] || "";
  return mon ? `${day} ${mon}` : `${day}.${month}.${year}`;
}

export function confidenceLabel(c: MatchForecast["confidence"]): string {
  if (c === "high") return "высокая уверенность";
  if (c === "medium") return "средняя уверенность";
  return "мало данных";
}
