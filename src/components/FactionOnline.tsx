"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type OnlineDay = { ymd: string; weekday: string; date: string };
type OnlineRow = {
  userId: string;
  nick: string;
  name: string;
  cells: Record<string, string>;
};

function normQuery(s: string) {
  return s.trim().toLowerCase().replace(/[-_\s]+/g, "");
}

export function FactionOnline({ slug, loadKey }: { slug: string; loadKey: number }) {
  const fitRef = useRef<HTMLDivElement | null>(null);
  const [days, setDays] = useState<OnlineDay[]>([]);
  const [rows, setRows] = useState<OnlineRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(8);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (loadKey < 1) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/online`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          days?: OnlineDay[];
          rows?: OnlineRow[];
        };
        if (!res.ok) {
          setError(data.error || "Не удалось загрузить явку");
          return;
        }
        setDays(Array.isArray(data.days) ? data.days : []);
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setPage(0);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("Сеть недоступна");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [slug, loadKey]);

  const filtered = useMemo(() => {
    const needle = normQuery(q);
    if (!needle) return rows;
    return rows.filter((r) => normQuery(`${r.nick} ${r.name}`).includes(needle));
  }, [rows, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / Math.max(1, pageSize)));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el || loadKey < 1) return;
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
  }, [loadKey, filtered.length, safePage, loading]);

  if (loadKey < 1) {
    return <p className="muted faction-stat-note">Нажми «Онлайн», чтобы загрузить явку.</p>;
  }

  return (
    <div className="faction-online">
      <p className="muted faction-online-hint">20:00–01:00 МСК · первый заход и последний выход, TR1 и TR2</p>
      <label className="field faction-online-search">
        <span>Ник в составе</span>
        <input
          value={q}
          placeholder="Ник"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      {loading && rows.length === 0 ? <p className="muted">Считаю явку…</p> : null}
      <div className="faction-online-fit" ref={fitRef}>
        <table className="admin-table faction-online-table">
          <thead>
            <tr>
              <th>Ник</th>
              {days.map((d) => (
                <th key={d.ymd}>
                  <span className="faction-online-wd">{d.weekday}</span>
                  <span className="faction-online-date">{d.date}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.userId}>
                <td>
                  {r.nick}
                  {r.name ? <span className="muted"> {r.name}</span> : null}
                </td>
                {days.map((d) => {
                  const text = r.cells[d.ymd] || "—";
                  return (
                    <td key={d.ymd}>{text}</td>
                  );
                })}
              </tr>
            ))}
            {!loading && visible.length === 0 ? (
              <tr>
                <td colSpan={1 + days.length} className="muted">
                  {rows.length === 0 ? "В составе пока никого." : "Никого не найдено"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
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
      ) : null}
    </div>
  );
}
