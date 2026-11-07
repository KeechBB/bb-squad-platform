"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { KIT_SLICE_COLORS, STANDARD_KITS } from "@/lib/squadKits";

type WeekRow = {
  factionId: string;
  name: string;
  color: string;
  week: string;
  people: number;
  perMatch: number | null;
  kd: number | null;
};

type GrowthRow = {
  order: number;
  userId: string;
  nick: string;
  name: string;
  role: string;
  live: boolean;
  level: number | null;
  delta: number | null;
  yesterday: number | null;
};

function useFitPage(active: boolean, rowCount: number) {
  const fitRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState(8);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rowCount / Math.max(1, pageSize)));
  const safePage = Math.min(page, pageCount - 1);

  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el || !active) return;
    const measure = () => {
      const head = el.querySelector("thead")?.getBoundingClientRect().height ?? 44;
      const sample = el.querySelector("tbody tr")?.getBoundingClientRect().height ?? 44;
      const room = Math.max(0, el.clientHeight - head);
      const next = Math.max(1, Math.floor(room / Math.max(sample, 1)));
      setPageSize((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, rowCount, safePage]);

  return { fitRef, pageCount, safePage, setPage, pageSize };
}

function fmt(v: number | null, digits: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits).replace(".", ",");
}

function bestValue(rows: WeekRow[], key: "people" | "perMatch" | "kd"): number | null {
  let best: number | null = null;
  for (const row of rows) {
    const v = row[key];
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    if (best == null || v > best) best = v;
  }
  return best;
}

function isBest(v: number | null, best: number | null): boolean {
  return best != null && v != null && v === best;
}

function Pager({
  safePage,
  pageCount,
  setPage,
}: {
  safePage: number;
  pageCount: number;
  setPage: (n: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="faction-roster-pager">
      <button type="button" className="btn" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)}>
        Назад
      </button>
      <span className="muted">
        {safePage + 1} / {pageCount}
      </span>
      <button
        type="button"
        className="btn"
        disabled={safePage >= pageCount - 1}
        onClick={() => setPage(safePage + 1)}
      >
        Дальше
      </button>
    </div>
  );
}

export function FactionWeekBoard({
  slug,
  kind,
  loadKey,
}: {
  slug: string;
  kind: "cw" | "train";
  loadKey: number;
}) {
  const [rows, setRows] = useState<WeekRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const page = useFitPage(loadKey > 0 && !loading, rows.length);
  const visible = rows.slice(page.safePage * page.pageSize, page.safePage * page.pageSize + page.pageSize);
  const bestPeople = bestValue(rows, "people");
  const bestAvg = bestValue(rows, "perMatch");
  const bestKd = bestValue(rows, "kd");

  useEffect(() => {
    if (loadKey < 1) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/week?kind=${kind}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; rows?: WeekRow[] };
        if (!res.ok) {
          setError(data.error || "Не удалось загрузить таблицу");
          return;
        }
        setRows(Array.isArray(data.rows) ? data.rows : []);
        page.setPage(0);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("Сеть недоступна");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [slug, kind, loadKey]);

  if (loadKey < 1) {
    return (
      <p className="muted faction-stat-note">
        {kind === "cw"
          ? "Нажми «Участие КВ», чтобы загрузить последние 7 дней."
          : "Нажми «Тренировки», чтобы загрузить последние 7 дней."}
      </p>
    );
  }

  const avgTitle = kind === "cw" ? "На матч" : "На матч в день";
  const peopleTitle = kind === "cw" ? "Людей на КВ" : "Людей за 7 дней";

  return (
    <div className="faction-online">
      {error ? <p className="error">{error}</p> : null}
      {loading && rows.length === 0 ? <p className="muted">Считаю 7 дней…</p> : null}
      <div className="faction-online-fit" ref={page.fitRef}>
        <table className="admin-table faction-stat-table">
          <thead>
            <tr>
              <th>Фракция</th>
              <th>7 дней</th>
              <th>{peopleTitle}</th>
              <th>{avgTitle}</th>
              <th>Средний KD</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.factionId}>
                <td className="faction-name-cell" style={{ color: r.color }}>
                  {r.name}
                </td>
                <td>{r.week}</td>
                <td className={isBest(r.people, bestPeople) ? "faction-best" : undefined}>{r.people}</td>
                <td className={isBest(r.perMatch, bestAvg) ? "faction-best" : undefined}>{fmt(r.perMatch, 1)}</td>
                <td className={isBest(r.kd, bestKd) ? "faction-best" : undefined}>{fmt(r.kd, 2)}</td>
              </tr>
            ))}
            {!loading && visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  Фракций пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager safePage={page.safePage} pageCount={page.pageCount} setPage={page.setPage} />
    </div>
  );
}

type GrowthSortKey = "order" | "nick" | "role" | "level" | "delta";

const GROWTH_COLUMNS: { key: GrowthSortKey; label: string; title?: string }[] = [
  { key: "order", label: "№" },
  { key: "nick", label: "Ник" },
  { key: "role", label: "Основная роль" },
  { key: "level", label: "Уровень" },
  {
    key: "delta",
    label: "Динамика",
    title: "Изменение уровня основной роли относительно вчерашнего дня",
  },
];

function growthCompare(a: GrowthRow, b: GrowthRow, key: GrowthSortKey, dir: "asc" | "desc") {
  const num = (v: number | null) => (v == null || !Number.isFinite(v) ? null : v);
  let cmp = 0;
  if (key === "order") cmp = a.order - b.order;
  else if (key === "nick") cmp = a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" });
  else if (key === "role") cmp = a.role.localeCompare(b.role, "ru", { sensitivity: "base" });
  else {
    const va = num(key === "level" ? a.level : a.delta);
    const vb = num(key === "level" ? b.level : b.delta);
    if (va == null && vb == null) cmp = 0;
    else if (va == null) return 1;
    else if (vb == null) return -1;
    else cmp = va - vb;
  }
  if (cmp === 0) return a.order - b.order;
  return dir === "asc" ? cmp : -cmp;
}

function deltaText(row: GrowthRow): string {
  if (row.delta == null) return "—";
  const body = Math.abs(row.delta).toFixed(2).replace(".", ",");
  if (row.delta > 0) return `+${body}`;
  if (row.delta < 0) return `−${body}`;
  return body;
}

function deltaTip(row: GrowthRow): string {
  if (!row.live) return "У этой роли лестница ещё в разработке.";
  if (row.level == null) return "Лестница есть, уровень ещё на калибровке.";
  if (row.yesterday == null || row.delta == null) {
    return "Изменение уровня относительно вчерашнего дня. Вчерашнего снимка ещё нет, цифра появится завтра.";
  }
  return `Изменение уровня относительно вчерашнего дня. Вчера ${fmt(row.yesterday, 2)}, сегодня ${fmt(row.level, 2)}.`;
}

export function FactionGrowthBoard({ slug, loadKey }: { slug: string; loadKey: number }) {
  const [rows, setRows] = useState<GrowthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<GrowthSortKey>("order");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const sorted = useMemo(
    () => [...rows].sort((a, b) => growthCompare(a, b, sortKey, sortDir)),
    [rows, sortKey, sortDir]
  );
  const page = useFitPage(loadKey > 0 && !loading, sorted.length);
  const visible = sorted.slice(page.safePage * page.pageSize, page.safePage * page.pageSize + page.pageSize);

  function onSort(key: GrowthSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "level" || key === "delta" ? "desc" : "asc");
    }
    page.setPage(0);
  }

  useEffect(() => {
    if (loadKey < 1) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/growth`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; rows?: GrowthRow[] };
        if (!res.ok) {
          setError(data.error || "Не удалось загрузить развитие");
          return;
        }
        setRows(Array.isArray(data.rows) ? data.rows : []);
        page.setPage(0);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("Сеть недоступна");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [slug, loadKey]);

  if (loadKey < 1) {
    return <p className="muted faction-stat-note">Нажми «Развитие», чтобы загрузить состав.</p>;
  }

  return (
    <div className="faction-online">
      {error ? <p className="error">{error}</p> : null}
      {loading && rows.length === 0 ? <p className="muted">Считаю развитие…</p> : null}
      <div className="faction-online-fit" ref={page.fitRef}>
        <table className="admin-table faction-stat-table">
          <thead>
            <tr>
              {GROWTH_COLUMNS.map((col) => {
                const on = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={col.key === "delta" ? "faction-dyn-h" : undefined}
                    aria-sort={on ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      className={`faction-roster-sort${on ? " is-on" : ""}`}
                      title={col.title}
                      onClick={() => onSort(col.key)}
                    >
                      {col.label}
                      {on ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.userId}>
                <td>{r.order}</td>
                <td>
                  {r.nick}
                  {r.name ? <span className="muted"> {r.name}</span> : null}
                </td>
                <td>{r.role}</td>
                <td>{r.live && r.level != null ? fmt(r.level, 2) : "—"}</td>
                <td title={deltaTip(r)}>{deltaText(r)}</td>
              </tr>
            ))}
            {!loading && visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  В составе пока никого.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager safePage={page.safePage} pageCount={page.pageCount} setPage={page.setPage} />
    </div>
  );
}

type RoleSlice = { kit: string; players: number; pct: number };

function kitColor(kit: string): string {
  const i = (STANDARD_KITS as readonly string[]).indexOf(kit);
  return KIT_SLICE_COLORS[(i < 0 ? 0 : i) % KIT_SLICE_COLORS.length];
}

function ringSlice(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const sweep = a1 - a0;
  const large = sweep > Math.PI ? 1 : 0;
  const x0o = cx + rOuter * Math.cos(a0);
  const y0o = cy + rOuter * Math.sin(a0);
  const x1o = cx + rOuter * Math.cos(a1);
  const y1o = cy + rOuter * Math.sin(a1);
  const x0i = cx + rInner * Math.cos(a1);
  const y0i = cy + rInner * Math.sin(a1);
  const x1i = cx + rInner * Math.cos(a0);
  const y1i = cy + rInner * Math.sin(a0);
  return [
    `M ${x0o} ${y0o}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o} ${y1o}`,
    `L ${x0i} ${y0i}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x1i} ${y1i}`,
    "Z",
  ].join(" ");
}

function roleDonut(
  rows: RoleSlice[],
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number
): { d: string; color: string; kit: string; pct: number; players: number }[] {
  if (!rows.length) return [];
  const total = rows.reduce((s, r) => s + r.players, 0) || 1;
  const full = Math.PI * 2;
  let angle = -Math.PI / 2;
  const gap = rows.length > 1 ? 0.035 : 0;
  const out: { d: string; color: string; kit: string; pct: number; players: number }[] = [];
  rows.forEach((row) => {
    const sweep = Math.max(0.02, (row.players / total) * (full - gap * rows.length));
    const a0 = angle;
    angle += sweep + gap;
    // Дуга на полный оборот в SVG не рисуется: начало совпадает с концом.
    const d =
      sweep >= full - 0.001
        ? `${ringSlice(cx, cy, rOuter, rInner, a0, a0 + Math.PI)} ${ringSlice(cx, cy, rOuter, rInner, a0 + Math.PI, a0 + full)}`
        : ringSlice(cx, cy, rOuter, rInner, a0, a0 + sweep);
    out.push({
      d,
      color: kitColor(row.kit),
      kit: row.kit,
      pct: row.pct,
      players: row.players,
    });
  });
  return out;
}

type FactionPick = { slug: string; name: string; color: string };

export function FactionAnalytics({ slug, loadKey }: { slug: string; loadKey: number }) {
  const uid = useId().replace(/:/g, "");
  const [week, setWeek] = useState("");
  const [slices, setSlices] = useState<RoleSlice[]>([]);
  const [factions, setFactions] = useState<FactionPick[]>([]);
  const [pick, setPick] = useState(slug);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const paths = useMemo(() => roleDonut(slices, 60, 60, 54, 28), [slices]);
  const active = paths.find((s) => s.kit === hover) || paths[0] || null;
  const picked = factions.find((f) => f.slug === pick);

  useEffect(() => {
    setPick(slug);
  }, [slug]);

  useEffect(() => {
    if (loadKey < 1) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const q = new URLSearchParams();
        if (pick && pick !== slug) q.set("faction", pick);
        const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/analytics?${q}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          week?: string;
          slices?: RoleSlice[];
          factions?: FactionPick[];
        };
        if (!res.ok) {
          setError(data.error || "Не удалось загрузить аналитику");
          return;
        }
        setWeek(data.week || "");
        setSlices(Array.isArray(data.slices) ? data.slices : []);
        setFactions(Array.isArray(data.factions) ? data.factions : []);
        setHover(null);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("Сеть недоступна");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [slug, loadKey, pick]);

  if (loadKey < 1) {
    return <p className="muted faction-stat-note">Нажми «Аналитика», чтобы загрузить роли.</p>;
  }

  const pct =
    active && (Number.isInteger(active.pct) ? `${active.pct}%` : `${active.pct.toFixed(1)}%`);
  const label = active ? (active.kit.length > 16 ? `${active.kit.slice(0, 15)}…` : active.kit) : "";

  return (
    <div className="faction-analytics">
      <div className="faction-analytics-bar">
        {week ? <p className="faction-analytics-week">{week}</p> : <span />}
        {factions.length > 0 ? (
          <label className="faction-analytics-pick">
            <select
              value={pick}
              style={{ color: picked?.color || "#f4f0e8" }}
              onChange={(e) => setPick(e.target.value)}
            >
              {factions.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {loading && slices.length === 0 ? <p className="muted">Считаю роли…</p> : null}
      {!loading && slices.length === 0 && !error ? (
        <p className="muted faction-stat-note">За последние 7 дней на TR1 и TR2 ещё никто не играл.</p>
      ) : null}
      {slices.length > 0 ? (
        <div className="faction-analytics-stage" onMouseLeave={() => setHover(null)}>
          <svg
            className="faction-analytics-donut"
            viewBox="0 0 120 120"
            role="img"
            aria-label={active ? `${active.kit} ${pct}` : "Основные роли"}
          >
            <defs>
              <filter id={`faction-donut-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="0.6" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {paths.map((s) => {
              const on = hover === s.kit;
              const dim = hover != null && !on;
              return (
                <path
                  key={s.kit}
                  d={s.d}
                  fill={s.color}
                  opacity={dim ? 0.35 : 1}
                  filter={`url(#faction-donut-${uid})`}
                  onMouseEnter={() => setHover(s.kit)}
                />
              );
            })}
            <circle cx="60" cy="60" r="24" className="profile-kits-donut-hole" />
            {active ? (
              <>
                <text x="60" y="56" textAnchor="middle" fontSize="11" className="faction-analytics-pct">
                  {pct}
                </text>
                <text x="60" y="68" textAnchor="middle" fontSize="5.2" className="faction-analytics-kit">
                  {label}
                </text>
              </>
            ) : null}
          </svg>
        </div>
      ) : null}
    </div>
  );
}

type RatingSlice = {
  factionId: string;
  name: string;
  color: string;
  value: number;
  pct: number;
};

type RatingChart = {
  id: string;
  title: string;
  total: number;
  slices: RatingSlice[];
};

function shareDonut(
  rows: RatingSlice[],
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number
): { d: string; color: string; id: string; name: string; pct: number; value: number }[] {
  if (!rows.length) return [];
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  const full = Math.PI * 2;
  let angle = -Math.PI / 2;
  const gap = rows.length > 1 ? 0.035 : 0;
  const out: { d: string; color: string; id: string; name: string; pct: number; value: number }[] = [];
  rows.forEach((row) => {
    const sweep = Math.max(0.02, (row.value / total) * (full - gap * rows.length));
    const a0 = angle;
    angle += sweep + gap;
    const d =
      sweep >= full - 0.001
        ? `${ringSlice(cx, cy, rOuter, rInner, a0, a0 + Math.PI)} ${ringSlice(cx, cy, rOuter, rInner, a0 + Math.PI, a0 + full)}`
        : ringSlice(cx, cy, rOuter, rInner, a0, a0 + sweep);
    out.push({
      d,
      color: row.color,
      id: row.factionId,
      name: row.name,
      pct: row.pct,
      value: row.value,
    });
  });
  return out;
}

function RatingDonut({ chart, week }: { chart: RatingChart; week: string }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<string | null>(null);
  const paths = useMemo(() => shareDonut(chart.slices, 60, 60, 54, 28), [chart.slices]);
  const active = paths.find((s) => s.id === hover) || paths[0] || null;
  const pct =
    active && (Number.isInteger(active.pct) ? `${active.pct}%` : `${active.pct.toFixed(1)}%`);
  const label = active ? (active.name.length > 14 ? `${active.name.slice(0, 13)}…` : active.name) : "";

  return (
    <div className="faction-rating-card">
      <p className="faction-rating-title">{chart.title}</p>
      {chart.slices.length === 0 ? (
        <p className="muted faction-stat-note">Нет данных за {week || "7 дней"}.</p>
      ) : (
        <div className="faction-rating-stage" onMouseLeave={() => setHover(null)}>
          <svg
            className="faction-analytics-donut"
            viewBox="0 0 120 120"
            role="img"
            aria-label={active ? `${active.name} ${pct}` : chart.title}
          >
            <defs>
              <filter id={`faction-rate-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="0.6" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {paths.map((s) => {
              const on = hover === s.id;
              const dim = hover != null && !on;
              return (
                <path
                  key={s.id}
                  d={s.d}
                  fill={s.color}
                  opacity={dim ? 0.35 : 1}
                  filter={`url(#faction-rate-${uid})`}
                  onMouseEnter={() => setHover(s.id)}
                />
              );
            })}
            <circle cx="60" cy="60" r="24" className="profile-kits-donut-hole" />
            {active ? (
              <>
                <text x="60" y="56" textAnchor="middle" fontSize="11" className="faction-analytics-pct">
                  {pct}
                </text>
                <text x="60" y="68" textAnchor="middle" fontSize="5.2" className="faction-analytics-kit">
                  {label}
                </text>
              </>
            ) : null}
          </svg>
        </div>
      )}
    </div>
  );
}

export function FactionRatings({ slug, loadKey }: { slug: string; loadKey: number }) {
  const [week, setWeek] = useState("");
  const [charts, setCharts] = useState<RatingChart[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loadKey < 1) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/ratings`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          week?: string;
          charts?: RatingChart[];
        };
        if (!res.ok) {
          setError(data.error || "Не удалось загрузить рейтинги");
          return;
        }
        setWeek(data.week || "");
        setCharts(Array.isArray(data.charts) ? data.charts : []);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("Сеть недоступна");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [slug, loadKey]);

  if (loadKey < 1) {
    return <p className="muted faction-stat-note">Нажми «Рейтинги», чтобы загрузить доли фракций.</p>;
  }

  return (
    <div className="faction-ratings">
      <div className="faction-analytics-bar">
        {week ? <p className="faction-analytics-week">{week}</p> : <span />}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {loading && charts.length === 0 ? <p className="muted">Считаю рейтинги…</p> : null}
      <div className="faction-ratings-grid">
        {charts.map((c) => (
          <RatingDonut key={c.id} chart={c} week={week} />
        ))}
      </div>
    </div>
  );
}
