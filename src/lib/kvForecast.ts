import type { KvMatch } from "@/lib/kvStats";

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

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://keechbb.github.io/blackberry-kv",
  "https://kv.bb-squad.ru",
].filter(Boolean) as string[];

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

function shortMap(map: string): string {
  let s = map.trim();
  s = s.replace(/^(SEC|BALT|OOTB)\s+/i, "");
  s = s.replace(/^\d+\s+/, "");
  s = s.replace(/\s+(AAS|PAAS|RAAS|TC|Invasion|Seed).*$/i, "");
  s = s.replace(/\s+v\d+$/i, "");
  return s.trim() || map;
}

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 120 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type TaggedMatch = KvMatch & {
  year: number;
  month: number;
  id?: string;
  timeMsk?: string;
  server?: string;
  rules?: string;
  note?: string;
  size?: string;
};

async function loadTaggedMatches(): Promise<{
  matches: TaggedMatch[];
  source: string;
}> {
  let lastErr: unknown;
  for (const base of KV_BASES) {
    try {
      const root = base.replace(/\/$/, "");
      const index = await fetchJson(`${root}/data/index.json`);
      const months = index.months || [];
      const monthPayloads = await Promise.all(
        months.map(async (m: { url?: string; year?: number; month?: number }) => {
          const url = String(m.url || "").startsWith("http")
            ? m.url
            : `${root}/${String(m.url || "").replace(/^\//, "")}`;
          const data = await fetchJson(url!);
          const year =
            Number(m.year) || Number(String(data.month || "").slice(0, 4)) || 0;
          const month =
            Number(m.month) || Number(String(data.month || "").slice(5, 7)) || 0;
          return { data, year, month };
        })
      );
      const matches: TaggedMatch[] = [];
      for (const { data, year, month } of monthPayloads) {
        for (const match of data.matches || []) {
          matches.push({ ...match, year, month });
        }
      }
      return { matches, source: base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("KV unavailable");
}

function toneForRate(rate: number | null): ForecastFactor["tone"] {
  if (rate == null) return "neutral";
  if (rate >= 55) return "good";
  if (rate <= 40) return "bad";
  return "neutral";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function winRate(list: KvMatch[]): { rate: number | null; played: number; wins: number; draws: number } {
  const played = list.filter((m) => m.status && m.status !== "upcoming");
  if (!played.length) return { rate: null, played: 0, wins: 0, draws: 0 };
  const wins = played.filter((m) => m.status === "win").length;
  const draws = played.filter((m) => m.status === "draw").length;
  return {
    rate: Math.round((100 * wins) / played.length),
    played: played.length,
    wins,
    draws,
  };
}

function buildForecast(match: TaggedMatch, history: TaggedMatch[]): MatchForecast {
  const playedAll = history.filter((m) => m.status && m.status !== "upcoming");
  const overall = winRate(playedAll);
  const stackName = match.stack || "";
  const stackHist = playedAll.filter(
    (m) => (m.stack || "").toLowerCase() === stackName.toLowerCase()
  );
  const stack = winRate(stackHist);
  const mapKey = shortMap(match.map || "");
  const mapHist = playedAll.filter(
    (m) => m.map && shortMap(m.map).toLowerCase() === mapKey.toLowerCase()
  );
  const onMap = winRate(mapHist);
  const oppKey = (match.opp || "").toLowerCase();
  const h2hHist = playedAll.filter(
    (m) => (m.opp || "").toLowerCase() === oppKey
  );
  const h2h = winRate(h2hHist);

  const factors: ForecastFactor[] = [];
  const weights: { w: number; rate: number }[] = [];

  if (overall.rate != null) {
    factors.push({
      label: "Общий WR",
      value: `${overall.rate}% · ${overall.played} игр`,
      tone: toneForRate(overall.rate),
    });
    weights.push({ w: 0.2, rate: overall.rate });
  }

  if (stack.rate != null && stackName) {
    factors.push({
      label: `Состав ${stackName}`,
      value: `${stack.rate}% · ${stack.played} игр`,
      tone: toneForRate(stack.rate),
    });
    weights.push({ w: stack.played >= 3 ? 0.3 : 0.18, rate: stack.rate });
  }

  if (onMap.rate != null) {
    factors.push({
      label: `Карта ${mapKey}`,
      value: `${onMap.rate}% · ${onMap.played} игр`,
      tone: toneForRate(onMap.rate),
    });
    weights.push({ w: onMap.played >= 2 ? 0.35 : 0.2, rate: onMap.rate });
  } else {
    factors.push({
      label: `Карта ${mapKey || "—"}`,
      value: "нет сыгранных",
      tone: "neutral",
    });
  }

  if (h2h.rate != null) {
    factors.push({
      label: `vs ${match.opp}`,
      value: `${h2h.rate}% · ${h2h.played} встреч`,
      tone: toneForRate(h2h.rate),
    });
    weights.push({ w: h2h.played >= 2 ? 0.25 : 0.15, rate: h2h.rate });
  } else {
    factors.push({
      label: `vs ${match.opp || "соперник"}`,
      value: "первый раз / нет истории",
      tone: "neutral",
    });
  }

  let winPct = 50;
  if (weights.length) {
    const sumW = weights.reduce((s, x) => s + x.w, 0);
    winPct = Math.round(weights.reduce((s, x) => s + x.rate * x.w, 0) / sumW);
  }
  winPct = clamp(winPct, 18, 88);

  const drawBase =
    overall.played > 0
      ? Math.round((100 * overall.draws) / overall.played)
      : 8;
  const drawPct = clamp(Math.round(drawBase * 0.7), 4, 18);
  let losePct = 100 - winPct - drawPct;
  if (losePct < 5) {
    losePct = 5;
    winPct = 100 - losePct - drawPct;
  }

  const sample = (onMap.played || 0) + (h2h.played || 0) + (stack.played || 0);
  const confidence: MatchForecast["confidence"] =
    sample >= 8 ? "high" : sample >= 3 ? "medium" : "low";

  const summary = writeSummary({
    opp: match.opp || "соперник",
    map: mapKey,
    stackName: stackName || "состав",
    winPct,
    onMap,
    stackStats: stack,
    h2h,
    size: match.size || "",
  });

  return { winPct, drawPct, losePct, confidence, summary, factors };
}

function writeSummary(opts: {
  opp: string;
  map: string;
  stackName: string;
  winPct: number;
  onMap: ReturnType<typeof winRate>;
  stackStats: ReturnType<typeof winRate>;
  h2h: ReturnType<typeof winRate>;
  size: string;
}): string {
  const bits: string[] = [];
  if (opts.winPct >= 62) {
    bits.push(
      `Модель склоняется к победе BB (${opts.winPct}%) против ${opts.opp}.`
    );
  } else if (opts.winPct <= 42) {
    bits.push(
      `Матч выглядит сложным: оценка победы ${opts.winPct}% против ${opts.opp}.`
    );
  } else {
    bits.push(
      `Ровный прогноз: ~${opts.winPct}% на победу BB против ${opts.opp}.`
    );
  }

  if (opts.onMap.rate != null && opts.onMap.played >= 2) {
    bits.push(
      opts.onMap.rate >= 55
        ? `На ${opts.map} состав чувствует себя уверенно (${opts.onMap.rate}% WR).`
        : `Карта ${opts.map} — слабое место по истории (${opts.onMap.rate}% WR).`
    );
  } else {
    bits.push(`По карте ${opts.map} мало данных — вес оценки снижен.`);
  }

  if (opts.stackStats.rate != null) {
    bits.push(
      `${opts.stackName} сейчас на ${opts.stackStats.rate}% побед за сезонную выборку.`
    );
  }

  if (opts.h2h.rate != null) {
    bits.push(
      `Личные встречи с ${opts.opp}: ${opts.h2h.wins}W / ${opts.h2h.played} игр.`
    );
  } else {
    bits.push(`Прямой истории с ${opts.opp} почти нет — ставка на форму и карту.`);
  }

  if (opts.size) bits.push(`Формат ${opts.size}.`);

  return bits.join(" ");
}

export function formatMatchDate(day: number, month: number, year: number): string {
  const mon = MONTH_RU[month] || "";
  return mon ? `${day} ${mon}` : `${day}.${month}.${year}`;
}

export function confidenceLabel(c: MatchForecast["confidence"]): string {
  if (c === "high") return "высокая уверенность";
  if (c === "medium") return "средняя уверенность";
  return "мало данных";
}

export async function buildUpcomingMatchPreviews(
  limit = 6
): Promise<{ previews: UpcomingMatchPreview[]; source: string }> {
  const { matches, source } = await loadTaggedMatches();
  const upcoming = matches
    .filter((m) => m.status === "upcoming")
    .sort((a, b) => {
      const ay = a.year * 10000 + a.month * 100 + (Number(a.day) || 0);
      const by = b.year * 10000 + b.month * 100 + (Number(b.day) || 0);
      return ay - by;
    })
    .slice(0, limit);

  const previews: UpcomingMatchPreview[] = upcoming.map((m, i) => {
    const mapFull = m.map || "—";
    return {
      key: m.id || `${m.year}-${m.month}-${m.day}-${m.opp}-${i}`,
      day: Number(m.day) || 0,
      month: m.month,
      year: m.year,
      timeMsk: m.timeMsk || "—",
      opp: m.opp || "—",
      map: mapFull,
      mapShort: shortMap(mapFull),
      size: m.size || "—",
      stack: m.stack || "—",
      server: m.server || "—",
      rules: m.rules || "—",
      note: m.note || null,
      forecast: buildForecast(m, matches),
    };
  });

  return { previews, source };
}
