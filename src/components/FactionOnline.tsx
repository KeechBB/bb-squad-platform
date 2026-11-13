"use client";

import { useEffect, useMemo, useState } from "react";
import { useFitTablePage } from "@/lib/useFitTablePage";

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
  const [days, setDays] = useState<OnlineDay[]>([]);
  const [rows, setRows] = useState<OnlineRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

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

  const page = useFitTablePage(filtered.length, loadKey > 0 && !loading);
  const visible = filtered.slice(
    page.safePage * page.pageSize,
    page.safePage * page.pageSize + page.pageSize
  );

  useEffect(() => {
    page.setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только сброс при фильтре / новой явке
  }, [q, rows]);

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
          }}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      {loading && rows.length === 0 ? <p className="muted">Считаю явку…</p> : null}
      <div className="faction-online-fit" ref={page.fitRef}>
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
                  return <td key={d.ymd}>{text}</td>;
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
      {page.pageCount > 1 ? (
        <div className="faction-roster-pager">
          <button type="button" className="btn" disabled={page.safePage <= 0} onClick={page.goPrev}>
            Назад
          </button>
          <span className="muted">
            {page.safePage + 1} / {page.pageCount}
          </span>
          <button
            type="button"
            className="btn"
            disabled={page.safePage >= page.pageCount - 1}
            onClick={page.goNext}
          >
            Дальше
          </button>
        </div>
      ) : null}
    </div>
  );
}
