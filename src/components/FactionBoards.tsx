"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { KIT_SLICE_COLORS, STANDARD_KITS } from "@/lib/squadKits";
import { useFitTablePage } from "@/lib/useFitTablePage";
import { DraggableModal } from "@/components/DraggableModal";

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
  goPrev,
  goNext,
}: {
  safePage: number;
  pageCount: number;
  goPrev: () => void;
  goNext: () => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="faction-roster-pager">
      <button type="button" className="btn" disabled={safePage <= 0} onClick={goPrev}>
        Назад
      </button>
      <span className="muted">
        {safePage + 1} / {pageCount}
      </span>
      <button type="button" className="btn" disabled={safePage >= pageCount - 1} onClick={goNext}>
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
  const page = useFitTablePage(rows.length, loadKey > 0 && !loading);
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
        <table className="admin-table faction-stat-table faction-week-table">
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
      <Pager
        safePage={page.safePage}
        pageCount={page.pageCount}
        goPrev={page.goPrev}
        goNext={page.goNext}
      />
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
  const page = useFitTablePage(sorted.length, loadKey > 0 && !loading);
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
      <Pager
        safePage={page.safePage}
        pageCount={page.pageCount}
        goPrev={page.goPrev}
        goNext={page.goNext}
      />
    </div>
  );
}

type RolePlayer = { userId: string; nick: string; hours: number; sec: number };
type RoleSlice = {
  kit: string;
  sec?: number;
  players?: number;
  pct: number;
  roster?: RolePlayer[];
};

function kitColor(kit: string): string {
  const i = (STANDARD_KITS as readonly string[]).indexOf(kit);
  return KIT_SLICE_COLORS[(i < 0 ? 0 : i) % KIT_SLICE_COLORS.length];
}

/** Вес кольца: только время основной роли (sec). Деплои / headcount не используем. */
function roleWeight(row: RoleSlice): number {
  if (typeof row.sec === "number" && row.sec > 0) return row.sec;
  return Math.max(0, row.pct);
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
): { d: string; color: string; kit: string; pct: number; weight: number }[] {
  if (!rows.length) return [];
  const total = rows.reduce((s, r) => s + roleWeight(r), 0) || 1;
  const full = Math.PI * 2;
  let angle = -Math.PI / 2;
  const gap = rows.length > 1 ? 0.035 : 0;
  const out: { d: string; color: string; kit: string; pct: number; weight: number }[] = [];
  rows.forEach((row) => {
    const w = roleWeight(row);
    const sweep = Math.max(0.02, (w / total) * (full - gap * rows.length));
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
      weight: w,
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
  const [openKit, setOpenKit] = useState<string | null>(null);
  const paths = useMemo(() => roleDonut(slices, 60, 60, 54, 28), [slices]);
  const active = paths.find((s) => s.kit === hover) || paths[0] || null;
  const picked = factions.find((f) => f.slug === pick);
  const openSlice = openKit ? slices.find((s) => s.kit === openKit) || null : null;
  const openRoster = openSlice?.roster || [];

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
        setOpenKit(null);
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
        <p className="muted faction-stat-note">За последние 14 дней на TR1–TR5 ещё никто не играл.</p>
      ) : null}
      {slices.length > 0 ? (
        <div className="faction-analytics-stage" onMouseLeave={() => setHover(null)}>
          <svg
            className="faction-analytics-donut"
            viewBox="0 0 120 120"
            role="img"
            aria-label={
              active
                ? `${active.kit} ${pct} · основная роль по часам · клик = список`
                : "Основные роли по часам за 14 дней"
            }
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
                  className="faction-analytics-slice"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover(s.kit)}
                  onClick={() => setOpenKit(s.kit)}
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
          <p className="muted faction-analytics-hint">
            Только залитые TR-матчи за 14д · клик по сегменту — игроки и часы
          </p>
        </div>
      ) : null}

      {openSlice ? (
        <DraggableModal open closeOnBackdrop onClose={() => setOpenKit(null)}>
          <header className="profile-match-modal-head" data-drag-handle title="Перетащить окно">
            <div>
              <h2 className="profile-mail-modal-title">{openSlice.kit}</h2>
              <p className="muted">
                Залитые TR за {week || "14 дней"} · {openRoster.length}{" "}
                {openRoster.length === 1 ? "игрок" : openRoster.length < 5 ? "игрока" : "игроков"}
              </p>
            </div>
            <button type="button" className="profile-mail-close" onClick={() => setOpenKit(null)}>
              ×
            </button>
          </header>
          <div className="faction-role-modal-body">
            {openRoster.length ? (
              <table className="admin-table faction-role-modal-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Ник</th>
                    <th>Часы на роли</th>
                  </tr>
                </thead>
                <tbody>
                  {openRoster.map((p, i) => (
                    <tr key={p.userId}>
                      <td>{i + 1}</td>
                      <td>
                        <Link
                          className="player-nick-link"
                          href={`/players/${encodeURIComponent(p.nick)}`}
                        >
                          {p.nick}
                        </Link>
                      </td>
                      <td>{p.hours.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ч</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Никого с этой основной ролью за 14 дней.</p>
            )}
          </div>
        </DraggableModal>
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
  const paths = useMemo(() => shareDonut(chart.slices, 60, 60, 56, 30), [chart.slices]);
  const active = paths.find((s) => s.id === hover) || paths[0] || null;
  const pct =
    active && (Number.isInteger(active.pct) ? `${active.pct}%` : `${active.pct.toFixed(1)}%`);
  const label = active
    ? active.name.length > 12
      ? `${active.name.slice(0, 11)}…`
      : active.name
    : "";

  return (
    <div className="faction-rating-card">
      <p className="faction-rating-title">{chart.title}</p>
      {chart.slices.length === 0 ? (
        <p className="muted faction-stat-note">Нет данных за {week || "7 дней"}.</p>
      ) : (
        <div className="faction-rating-stage" onMouseLeave={() => setHover(null)}>
          <svg
            className="faction-rating-donut"
            viewBox="0 0 120 120"
            role="img"
            aria-label={active ? `${active.name} ${pct}` : chart.title}
          >
            <defs>
              <filter id={`faction-rate-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="0.55" result="b" />
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
                  opacity={dim ? 0.32 : 1}
                  filter={`url(#faction-rate-${uid})`}
                  onMouseEnter={() => setHover(s.id)}
                />
              );
            })}
            <circle cx="60" cy="60" r="26" className="profile-kits-donut-hole" />
            {active ? (
              <>
                <text x="60" y="54" textAnchor="middle" fontSize="18" className="faction-rating-pct">
                  {pct}
                </text>
                <text
                  x="60"
                  y="70"
                  textAnchor="middle"
                  fontSize="8"
                  className="faction-rating-name"
                  fill={active.color}
                >
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

type RaceRow = {
  factionId: string;
  name: string;
  slug: string;
  color: string;
  font: string;
  amount: number;
  goal: number;
  pct: number;
  status?: string;
  graceEndsAt?: string | null;
  met?: boolean | null;
};

function fmtBd(n: number): string {
  return Math.round(n || 0).toLocaleString("ru-RU");
}

function raceStatusRu(row: RaceRow): string {
  if (row.status === "grace") return "штраф 24ч";
  if (row.status === "exempt") return "спасены трансфером";
  if (row.status === "forced") return "штраф исполнен";
  if (row.status === "finalized" && row.met) return "план ✓";
  if (row.amount >= row.goal) return "цель";
  return "";
}

export function FactionRaceBoard({ slug, loadKey }: { slug: string; loadKey: number }) {
  const [label, setLabel] = useState("");
  const [rows, setRows] = useState<RaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loadKey < 1) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/race`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          label?: string;
          rows?: RaceRow[];
        };
        if (!res.ok) {
          setError(data.error || "Не удалось загрузить гонку");
          return;
        }
        setLabel(data.label || "");
        setRows(Array.isArray(data.rows) ? data.rows : []);
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
    return (
      <p className="muted faction-stat-note">
        Нажми «ГОНКА ФРАКЦИЙ», чтобы загрузить прогресс за окно.
      </p>
    );
  }

  return (
    <div className="faction-race">
      <div className="faction-race-head">
        <p className="faction-race-dates">{label || "21.11 00:00 — 28.11 00:00 МСК"}</p>
        <p className="faction-race-goal muted">
          Гринд казны за окно · у каждой фракции своя цель (±5% после недели). Легион вне гонки.
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {loading && rows.length === 0 ? <p className="muted">Считаю гонку…</p> : null}
      <div className="faction-race-table" role="table" aria-label="Гонка фракций">
        <div className="faction-race-row faction-race-row--head" role="row">
          <div className="faction-race-cell faction-race-name" role="columnheader">
            Фракция
          </div>
          <div className="faction-race-cell faction-race-bar-cell" role="columnheader">
            Прогресс
          </div>
        </div>
        {rows.map((row) => {
          const done = row.amount >= row.goal;
          const fill = Math.max(0, Math.min(100, row.pct));
          const badge = raceStatusRu(row);
          return (
            <div
              key={row.factionId}
              className={`faction-race-row${done ? " is-done" : ""}${
                row.status === "grace" ? " is-grace" : ""
              }`}
              role="row"
            >
              <div className="faction-race-cell faction-race-name" role="cell">
                <Link
                  href={`/factions/${encodeURIComponent(row.slug)}`}
                  className="faction-race-name-link"
                  style={{ color: row.color, fontFamily: `"${row.font}", Oxanium, sans-serif` }}
                >
                  {row.name}
                </Link>
                {badge ? <span className="faction-race-badge">{badge}</span> : null}
              </div>
              <div className="faction-race-cell faction-race-bar-cell" role="cell">
                <div
                  className="faction-race-bar"
                  style={{ ["--race-color" as string]: row.color }}
                  title={`${fmtBd(row.amount)} / ${fmtBd(row.goal)}`}
                >
                  <div className="faction-race-bar-fill" style={{ width: `${fill}%` }} />
                  <span className="faction-race-bar-label">
                    {fmtBd(row.amount)} / {fmtBd(row.goal)}
                    {done ? " · цель" : ""}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {!loading && !error && rows.length === 0 ? (
          <p className="muted">Нет фракций в гонке.</p>
        ) : null}
      </div>
    </div>
  );
}

type NightGrindRow = {
  factionId: string;
  name: string;
  slug: string;
  color: string;
  font: string;
  amount: number;
  stakeOn: number;
  odds: number | null;
};

type NightBetRow = {
  id: string;
  fromFactionId: string;
  fromName: string;
  fromColor: string;
  pickFactionId: string;
  pickName: string;
  pickColor: string;
  amount: number;
  odds: number | null;
  status: string;
  payout: number;
  placedByNick: string;
};

type NightBetBoardData = {
  label: string;
  windowId: string;
  status: "upcoming" | "open" | "locked" | "settled";
  canBet: boolean;
  myTreasury: number;
  balanceLabel?: string;
  isPersonalBettor?: boolean;
  pot: number;
  minBet: number;
  grind: NightGrindRow[];
  bets: NightBetRow[];
  myBets?: {
    pickFactionId: string;
    amount: number;
    odds: number | null;
    status: string;
    payout: number;
  }[];
  myBet: {
    pickFactionId: string;
    amount: number;
    odds: number | null;
    status: string;
    payout: number;
  } | null;
  winners: {
    factionId: string;
    name: string;
    color: string;
    grindAmount: number;
  }[];
  payouts: {
    fromFactionId: string;
    fromName: string;
    fromColor: string;
    amount: number;
    payout: number;
  }[];
};

function betStatusRu(s: string): string {
  if (s === "won") return "выигрыш";
  if (s === "lost") return "проигрыш";
  if (s === "refunded") return "возврат";
  return "в игре";
}

function fmtOdds(o: number | null | undefined): string {
  if (o == null || !Number.isFinite(o)) return "—";
  return `×${o.toFixed(2).replace(".", ",")}`;
}

type NightHistoryRow = {
  id: string;
  windowId: string;
  label: string;
  pickName: string;
  pickColor: string;
  amount: number;
  status: string;
  payout: number;
};

export function FactionNightBetsBoard({
  slug,
  loadKey,
}: {
  slug: string;
  loadKey: number;
}) {
  const [data, setData] = useState<NightBetBoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickId, setPickId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<NightHistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const reload = async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/night-bets`,
        { cache: "no-store", signal }
      );
      const json = (await res.json().catch(() => ({}))) as NightBetBoardData & {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Не удалось загрузить ставки");
        return;
      }
      setData(json);
      const firstMine = json.myBets?.[0] || json.myBet;
      if (!pickId && firstMine?.pickFactionId) {
        setPickId(firstMine.pickFactionId);
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError("Сеть недоступна");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (loadKey < 1) return;
    const ctrl = new AbortController();
    void reload(ctrl.signal);
    const t = window.setInterval(() => {
      void reload(ctrl.signal);
    }, 30_000);
    return () => {
      ctrl.abort();
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload by loadKey only
  }, [slug, loadKey]);

  async function submitBet() {
    if (!data?.canBet) return;
    const amount = Math.trunc(Number(String(amountStr).replace(/\s/g, "")) || 0);
    if (!pickId) {
      setError("Выбери фракцию");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/night-bets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pickFactionId: pickId, amount }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as NightBetBoardData & {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        setError(json.error || "Ставка не принята");
        return;
      }
      setData(json);
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/night-bets?history=1`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        rows?: NightHistoryRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Не удалось загрузить историю");
        setHistoryRows([]);
        return;
      }
      setHistoryRows(Array.isArray(json.rows) ? json.rows : []);
    } catch {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  if (loadKey < 1) {
    return null;
  }

  const maxGrind = data?.grind.reduce((m, r) => Math.max(m, r.amount), 0) || 0;
  const selected = data?.grind.find((g) => g.factionId === pickId) || null;
  const myBets = data?.myBets?.length
    ? data.myBets
    : data?.myBet
      ? [data.myBet]
      : [];
  const myOnSelected = selected
    ? myBets.find((b) => b.pickFactionId === selected.factionId) || null
    : null;
  const myPickIds = new Set(myBets.map((b) => b.pickFactionId));

  return (
    <div className="faction-night-bets">
      <div className="faction-night-bets-top">
        <p className="faction-night-bets-dates">
          {data?.label ||
            "Ставка на тренировку, кто из фракций больше всего заработает Долларов за тренировку. Окно ставок с 12:00, приём до 21:30."}
        </p>
        <button type="button" className="btn" onClick={() => void openHistory()}>
          История побед
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {loading && !data ? <p className="muted">Загрузка…</p> : null}

      {data ? (
        <>
          <div className="faction-night-bets-pot">
            <div className="faction-night-bets-stat">
              <span className="faction-night-bets-stat-label">Банк</span>
              <strong>{fmtBd(data.pot)} B$</strong>
            </div>
            <div className="faction-night-bets-stat">
              <span className="faction-night-bets-stat-label">
                {data.balanceLabel || "Казна фракции"}
              </span>
              <strong>{fmtBd(data.myTreasury)} B$</strong>
            </div>
            {myBets.length > 0 ? (
              <div className="faction-night-bets-stat faction-night-bets-stat--mine">
                <span className="faction-night-bets-stat-label">Ваши ставки</span>
                <strong>
                  {myBets.map((b, i) => {
                    const g = data.grind.find((x) => x.factionId === b.pickFactionId);
                    return (
                      <span key={b.pickFactionId}>
                        {i > 0 ? " · " : ""}
                        <span style={{ color: g?.color }}>{g?.name || "?"}</span>
                        {` ${fmtBd(b.amount)}`}
                      </span>
                    );
                  })}
                </strong>
              </div>
            ) : null}
          </div>

          {data.status === "settled" &&
          (data.winners.length > 0 || data.payouts.length > 0) ? (
            <div className="faction-night-bets-result">
              {data.winners.length > 0 ? (
                <p className="faction-night-bets-winners">
                  Победитель:{" "}
                  {data.winners.map((w, i) => (
                    <span key={w.factionId}>
                      {i > 0 ? ", " : ""}
                      <strong style={{ color: w.color }}>{w.name}</strong>
                      {` (${fmtBd(w.grindAmount)} B$)`}
                    </span>
                  ))}
                </p>
              ) : null}
              {data.payouts.length > 0 ? (
                <ul className="faction-night-bets-payouts">
                  {data.payouts.map((p) => (
                    <li key={`${p.fromFactionId}-${p.payout}`}>
                      <span style={{ color: p.fromColor }}>{p.fromName}</span>
                      {`: ${fmtBd(p.amount)} → +${fmtBd(p.payout)} B$`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="faction-night-bets-cards" role="list">
            {data.grind.map((row) => {
              const lead = maxGrind > 0 && row.amount === maxGrind && row.amount > 0;
              const isSel = pickId === row.factionId;
              const isMine = myPickIds.has(row.factionId);
              return (
                <button
                  key={row.factionId}
                  type="button"
                  role="listitem"
                  className={`faction-night-bets-card${isSel ? " is-selected" : ""}${
                    isMine ? " is-mine" : ""
                  }${lead ? " is-lead" : ""}`}
                  style={{ ["--nb-color" as string]: row.color }}
                  disabled={!data.canBet}
                  onClick={() => {
                    if (!data.canBet) return;
                    setPickId(row.factionId);
                  }}
                >
                  <div className="faction-night-bets-card-name">
                    <span
                      style={{
                        color: row.color,
                        fontFamily: `"${row.font}", Oxanium, sans-serif`,
                      }}
                    >
                      {row.name}
                    </span>
                    {lead ? <em>лидер</em> : null}
                    {isMine ? <em className="is-mine-tag">ваша</em> : null}
                  </div>
                  <div className="faction-night-bets-card-metrics">
                    <div>
                      <span className="faction-night-bets-stat-label">Гринд</span>
                      <strong>{fmtBd(row.amount)} B$</strong>
                    </div>
                    <div>
                      <span className="faction-night-bets-stat-label">В пуле</span>
                      <strong>{fmtBd(row.stakeOn)} B$</strong>
                    </div>
                    <div>
                      <span className="faction-night-bets-stat-label">Кэф</span>
                      <strong className="faction-night-bets-odds">
                        {fmtOdds(row.odds)}
                      </strong>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {data.canBet ? (
            <div className="faction-night-bets-place">
              <div className="faction-night-bets-place-pick">
                {selected ? (
                  <>
                    {myOnSelected ? "Додеп на " : "Ставка на "}
                    <strong style={{ color: selected.color }}>{selected.name}</strong>
                    {selected.odds != null ? ` · ${fmtOdds(selected.odds)}` : ""}
                    {myOnSelected ? ` · уже ${fmtBd(myOnSelected.amount)} B$` : ""}
                  </>
                ) : (
                  <>Выбери фракцию сверху</>
                )}
              </div>
              <div className="faction-night-bets-place-row">
                <input
                  type="text"
                  inputMode="numeric"
                  className="faction-night-bets-amount"
                  placeholder={`Сумма от ${fmtBd(data.minBet)}`}
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  disabled={busy || !selected}
                />
                <button
                  type="button"
                  className="btn faction-night-bets-place-btn"
                  disabled={busy || !selected}
                  onClick={() => void submitBet()}
                >
                  {myOnSelected ? "Додеп" : "Поставить"}
                </button>
              </div>
            </div>
          ) : null}

          {data.bets.length > 0 ? (
            <div className="faction-night-bets-list">
              <p className="faction-night-bets-list-title">Кто поставил</p>
              <ul>
                {data.bets.map((b) => (
                  <li key={b.id}>
                    <span style={{ color: b.fromColor }}>{b.fromName}</span>
                    {" → "}
                    <span style={{ color: b.pickColor }}>{b.pickName}</span>
                    {`: ${fmtBd(b.amount)} B$ · ${fmtOdds(b.odds)}`}
                    {b.payout > 0 ? ` · +${fmtBd(b.payout)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      <DraggableModal
        open={historyOpen}
        closeOnBackdrop
        onClose={() => setHistoryOpen(false)}
      >
        <header
          className="profile-match-modal-head"
          data-drag-handle
          title="Перетащить окно"
        >
          <div>
            <h2 className="profile-mail-modal-title">История побед</h2>
          </div>
          <button
            type="button"
            className="profile-mail-close"
            onClick={() => setHistoryOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="faction-night-bets-history">
          {historyLoading ? <p>Загрузка…</p> : null}
          {!historyLoading && historyRows && historyRows.length === 0 ? (
            <p>Пока пусто.</p>
          ) : null}
          {!historyLoading && historyRows && historyRows.length > 0 ? (
            <ul>
              {historyRows.map((r) => (
                <li key={r.id}>
                  <span>{r.label}</span>
                  {" · "}
                  <strong style={{ color: r.pickColor }}>{r.pickName}</strong>
                  {` · ${fmtBd(r.amount)} B$ · ${betStatusRu(r.status)}`}
                  {r.payout > 0 ? ` · +${fmtBd(r.payout)} B$` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </DraggableModal>
    </div>
  );
}
