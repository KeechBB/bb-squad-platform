import type { KvMatch } from "@/lib/kvStats";
import type {
  ForecastFactor,
  MatchForecast,
  UpcomingMatchPreview,
} from "@/lib/kvForecastUi";

export type {
  ForecastFactor,
  MatchForecast,
  UpcomingMatchPreview,
} from "@/lib/kvForecastUi";
export { formatMatchDate, confidenceLabel } from "@/lib/kvForecastUi";

function shortMap(map: string): string {
  let s = map.trim();
  s = s.replace(/^(SEC|BALT|OOTB)\s+/i, "");
  s = s.replace(/^\d+\s+/, "");
  s = s.replace(/\s+(AAS|PAAS|RAAS|TC|Invasion|Seed).*$/i, "");
  s = s.replace(/\s+v\d+$/i, "");
  return s.trim() || map;
}

async function loadJson<T = unknown>(relPath: string): Promise<T> {
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  const rel = relPath.replace(/^\//, "");
  const data = await loadKvJsonCached<T>(rel);
  if (data == null) throw new Error(`KV missing on disk: ${rel}`);
  return data;
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
  const index = await loadJson<{
    months?: { url?: string; year?: number; month?: number }[];
  }>("data/index.json");
  const months = index.months || [];
  const monthPayloads = await Promise.all(
    months.map(async (m) => {
      const data = await loadJson<{ month?: string; matches?: KvMatch[] }>(
        String(m.url || "").replace(/^\//, "")
      );
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
  return { matches, source: "vps-disk" };
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

function isPlayedStatus(status?: string) {
  return status === "win" || status === "lose" || status === "draw";
}

function winRate(list: KvMatch[]): { rate: number | null; played: number; wins: number; draws: number } {
  const played = list.filter((m) => isPlayedStatus(m.status));
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

type StackBrief = {
  last: TaggedMatch | null;
  lastNicks: string[];
  recent: TaggedMatch[];
  core: string[];
};

function matchStamp(m: TaggedMatch): number {
  return m.year * 10000 + m.month * 100 + (Number(m.day) || 0);
}

function sameStack(a: string | undefined, b: string | undefined): boolean {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

type PlayersFile = {
  total?: Array<{ nick?: string }>;
  players?: Array<{ nick?: string }>;
  r1?: Array<{ nick?: string }>;
  r2?: Array<{ nick?: string }>;
};

async function lineupOf(match: TaggedMatch): Promise<string[]> {
  const purl = String(match.playersUrl || "").replace(/^\/+/, "");
  if (!purl) return [];
  try {
    const pj = await loadJson<PlayersFile>(purl);
    const set = new Set<string>();
    for (const key of ["total", "players", "r1", "r2"] as const) {
      for (const p of pj[key] || []) {
        const n = String(p?.nick || "").trim();
        if (n) set.add(n);
      }
    }
    return [...set];
  } catch {
    return [];
  }
}

function namesPreview(nicks: string[], limit = 5): string {
  if (!nicks.length) return "состав не записан";
  const head = nicks.slice(0, limit).join(", ");
  const rest = nicks.length - limit;
  return rest > 0 ? `${head} +${rest}` : head;
}

async function buildStackBriefs(
  matches: TaggedMatch[]
): Promise<Map<string, StackBrief>> {
  const played = matches
    .filter((m) => isPlayedStatus(m.status))
    .sort((a, b) => matchStamp(b) - matchStamp(a));
  const byStack = new Map<string, TaggedMatch[]>();
  for (const m of played) {
    const key = (m.stack || "").trim().toLowerCase();
    if (!key) continue;
    const list = byStack.get(key) || [];
    list.push(m);
    byStack.set(key, list);
  }
  const out = new Map<string, StackBrief>();
  await Promise.all(
    [...byStack.entries()].map(async ([key, list]) => {
      const recent = list.slice(0, 5);
      const last = recent[0] || null;
      const lastNicks = last ? await lineupOf(last) : [];
      const coreSet = new Set(lastNicks.map((n) => n.toLowerCase()));
      const prev = recent.slice(1, 4);
      const prevLines = await Promise.all(prev.map((m) => lineupOf(m)));
      for (const line of prevLines) {
        for (const n of line) {
          const k = n.toLowerCase();
          if (coreSet.has(k)) continue;
          const hits =
            prevLines.filter((row) =>
              row.some((x) => x.toLowerCase() === k)
            ).length + (lastNicks.some((x) => x.toLowerCase() === k) ? 1 : 0);
          if (hits >= 2) coreSet.add(k);
        }
      }
      const core = lastNicks.length
        ? lastNicks
        : [...coreSet].slice(0, 12);
      out.set(key, { last, lastNicks, recent, core });
    })
  );
  return out;
}

function resultWord(status?: string): string {
  if (status === "win") return "победа";
  if (status === "lose") return "поражение";
  if (status === "draw") return "ничья";
  return status || "матч";
}

function buildForecast(
  match: TaggedMatch,
  history: TaggedMatch[],
  brief?: StackBrief
): MatchForecast {
  const playedAll = history.filter(
    (m) => isPlayedStatus(m.status) && matchStamp(m) < matchStamp(match)
  );
  const stackName = match.stack || "";
  const stackHist = playedAll.filter((m) => sameStack(m.stack, stackName));
  const stack = winRate(stackHist);
  const mapKey = shortMap(match.map || "");
  const mapHist = stackHist.filter(
    (m) => m.map && shortMap(m.map).toLowerCase() === mapKey.toLowerCase()
  );
  const stackOnMap = winRate(mapHist);
  const onMap = stackOnMap.played
    ? stackOnMap
    : winRate(
        playedAll.filter(
          (m) => m.map && shortMap(m.map).toLowerCase() === mapKey.toLowerCase()
        )
      );
  const mapScope = stackOnMap.played ? "состава" : "клана";
  const oppKey = (match.opp || "").toLowerCase();
  const h2hStackHist = stackHist.filter(
    (m) => (m.opp || "").toLowerCase() === oppKey
  );
  const h2h = winRate(h2hStackHist);
  const priorForm = [...stackHist]
    .sort((a, b) => matchStamp(b) - matchStamp(a))
    .slice(0, 5);
  const recent = winRate(
    match.status === "upcoming" && brief?.recent.length
      ? brief.recent
      : priorForm
  );

  const factors: ForecastFactor[] = [];
  const weights: { w: number; rate: number }[] = [];

  if (recent.rate != null && recent.played > 0 && stackName) {
    factors.push({
      label: `Форма ${stackName}`,
      value: `${recent.wins}W / ${recent.played} посл.`,
      tone: toneForRate(recent.rate),
    });
    weights.push({ w: 0.28, rate: recent.rate });
  }

  if (stack.rate != null && stackName) {
    factors.push({
      label: `Сезон ${stackName}`,
      value: `${stack.rate}% · ${stack.played} игр`,
      tone: toneForRate(stack.rate),
    });
    weights.push({ w: stack.played >= 3 ? 0.16 : 0.1, rate: stack.rate });
  }

  const sameOuting =
    !!brief?.last &&
    matchStamp(brief.last) === matchStamp(match) &&
    (brief.last.opp || "").toLowerCase() === oppKey &&
    sameStack(brief.last.stack, stackName);

  if (brief?.core.length) {
    const last = brief.last;
    factors.push({
      label: "Кто выходит",
      value: namesPreview(brief.core),
      tone:
        last?.status === "win"
          ? "good"
          : last?.status === "lose"
            ? "bad"
            : "neutral",
    });
    if (last && !sameOuting) {
      factors.push({
        label: "Последний выход",
        value: `${resultWord(last.status)} vs ${last.opp || "—"} · ${shortMap(last.map || "")}`,
        tone:
          last.status === "win"
            ? "good"
            : last.status === "lose"
              ? "bad"
              : "neutral",
      });
    }
  }

  if (onMap.rate != null) {
    factors.push({
      label: `Карта ${mapKey}`,
      value: `${onMap.rate}% · ${onMap.played} игр ${mapScope}`,
      tone: toneForRate(onMap.rate),
    });
    weights.push({ w: onMap.played >= 2 ? 0.22 : 0.12, rate: onMap.rate });
  } else {
    factors.push({
      label: `Карта ${mapKey || "—"}`,
      value: "у состава нет сыгранных",
      tone: "neutral",
    });
  }

  if (h2h.rate != null) {
    factors.push({
      label: `Личные ${stackName || "состава"}`,
      value: `${h2h.wins}W / ${h2h.played} vs ${match.opp}`,
      tone: toneForRate(h2h.rate),
    });
    weights.push({ w: h2h.played >= 2 ? 0.3 : 0.18, rate: h2h.rate });
  } else {
    factors.push({
      label: `Личные ${stackName || "состава"}`,
      value: `с ${match.opp || "соперником"} ещё не играли`,
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
    stack.played > 0
      ? Math.round((100 * stack.draws) / stack.played)
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
    recent,
    size: match.size || "",
    status: match.status || "",
    meeting: match.meeting || "",
    core: brief?.core || [],
    last: brief?.last || null,
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
  recent: ReturnType<typeof winRate>;
  size: string;
  status: string;
  meeting: string;
  core: string[];
  last: TaggedMatch | null;
}): string {
  const bits: string[] = [];
  if (opts.status === "win" || opts.status === "lose" || opts.status === "draw") {
    const score = opts.meeting ? ` (${opts.meeting})` : "";
    bits.push(
      `Итог состава ${opts.stackName}: ${resultWord(opts.status)}${score} против ${opts.opp}.`
    );
  } else if (opts.winPct >= 62) {
    bits.push(
      `Модель склоняется к победе ${opts.stackName} (${opts.winPct}%) против ${opts.opp}.`
    );
  } else if (opts.winPct <= 42) {
    bits.push(
      `Для ${opts.stackName} матч выглядит сложным: ${opts.winPct}% на победу против ${opts.opp}.`
    );
  } else {
    bits.push(
      `Ровный прогноз для ${opts.stackName}: ~${opts.winPct}% на победу против ${opts.opp}.`
    );
  }

  if (opts.core.length) {
    bits.push(`Сейчас выходят: ${namesPreview(opts.core, 6)}.`);
  }
  if (opts.last && (opts.last.opp || "").toLowerCase() !== opts.opp.toLowerCase()) {
    bits.push(
      `Последний выход этого состава — ${resultWord(opts.last.status)} против ${opts.last.opp || "—"}.`
    );
  }

  if (opts.h2h.rate != null) {
    bits.push(
      `Личные ${opts.stackName} с ${opts.opp}: ${opts.h2h.wins} побед из ${opts.h2h.played}.`
    );
  } else {
    bits.push(`Прямых встреч ${opts.stackName} с ${opts.opp} нет — смотрим форму ядра и карту.`);
  }

  if (opts.recent.rate != null && opts.recent.played >= 2) {
    bits.push(
      `Короткая форма: ${opts.recent.wins}W из ${opts.recent.played}.`
    );
  }

  if (opts.onMap.rate != null && opts.onMap.played >= 2) {
    bits.push(
      opts.onMap.rate >= 55
        ? `На ${opts.map} состав уверен (${opts.onMap.rate}% WR).`
        : `Карта ${opts.map} по истории состава слабая (${opts.onMap.rate}% WR).`
    );
  }

  if (opts.size) bits.push(`Формат ${opts.size}.`);

  return bits.join(" ");
}

function toPreview(
  m: TaggedMatch,
  i: number,
  matches: TaggedMatch[],
  briefs: Map<string, StackBrief>
): UpcomingMatchPreview {
  const mapFull = m.map || "—";
  const brief = briefs.get((m.stack || "").trim().toLowerCase());
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
    status: m.status || "",
    meeting: m.meeting || null,
    forecast: buildForecast(m, matches, brief),
  };
}

export async function buildUpcomingMatchPreviews(
  limit = 6
): Promise<{ previews: UpcomingMatchPreview[]; source: string }> {
  const { previews, source } = await buildCalendarMatches();
  return {
    previews: previews
      .filter((m) => m.status === "upcoming")
      .slice(0, limit),
    source,
  };
}

/** Все игры КВ для календаря главной, с прогнозом по составу. */
export async function buildCalendarMatches(): Promise<{
  previews: UpcomingMatchPreview[];
  source: string;
}> {
  const { matches, source } = await loadTaggedMatches();
  const briefs = await buildStackBriefs(matches);
  const dated = matches
    .filter((m) => Number(m.day) > 0 && m.month > 0 && m.year > 0)
    .sort((a, b) => matchStamp(a) - matchStamp(b));
  return {
    previews: dated.map((m, i) => toPreview(m, i, matches, briefs)),
    source,
  };
}
