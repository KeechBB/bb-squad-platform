"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BbSapperRatingBoard, SapperRatingRow } from "@/lib/fobMinesLab";

const PAGE_SIZE = 50;

type SortKey = keyof SapperRatingRow;

function PagePager({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <nav className="public-rating-pager" aria-label="Страницы списка">
      <span className="muted public-rating-pager-meta">
        {from}–{to} из {total}
      </span>
      <div className="public-rating-pager-btns">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={`public-rating-page-btn${n === page ? " is-active" : ""}`}
            aria-current={n === page ? "page" : undefined}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function TmSapperRatingClient() {
  const [server, setServer] = useState<"all" | "TR1" | "TR2">("all");
  const [board, setBoard] = useState<BbSapperRatingBoard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyPlanted, setOnlyPlanted] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("minesPlanted");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ server, files: "0" });
      const res = await fetch(`/api/tm/sapper-rating?${qs}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      setBoard(json as BbSapperRatingBoard);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [server]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useMemo(() => {
    const rows = board?.rows || [];
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (onlyPlanted && r.minesPlanted <= 0 && r.minesTriggered <= 0) {
        return false;
      }
      if (!needle) return true;
      return (
        r.nick.toLowerCase().includes(needle) || r.steamId.includes(needle)
      );
    });

    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv, "ru");
      } else {
        cmp = Number(av) - Number(bv);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [board, q, sortKey, sortDir, onlyPlanted]);

  useEffect(() => {
    setPage(1);
  }, [q, sortKey, sortDir, server, onlyPlanted]);

  const pageCount = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE;
    return view.slice(start, start + PAGE_SIZE);
  }, [view, pageSafe]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      setSortDir(k === "nick" ? "asc" : "desc");
    }
  }

  function Th({
    k,
    label,
    title,
  }: {
    k: SortKey;
    label: string;
    title?: string;
  }) {
    const active = sortKey === k;
    return (
      <th
        className={active ? "is-sorted" : undefined}
        title={title}
        aria-sort={
          active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
        }
      >
        <button type="button" className="th-sort" onClick={() => toggleSort(k)}>
          {label}
          {active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  }

  return (
    <>
      <header className="public-rating-head">
        <p className="muted" style={{ margin: "0 0 6px" }}>
          <Link className="kv-link" href="/tm">
            ← Тренировочные матчи
          </Link>
        </p>
        <h1 className="public-rating-title">Сапёры BlackBerry</h1>
        <p className="muted public-rating-sub">
          Кто поставил · сколько из них сработало · урон · уничтожил
        </p>
      </header>

      <div
        className="public-rating-filters"
        style={{ gap: 12, flexWrap: "wrap" }}
      >
        <label className="public-rating-search">
          <span className="muted">Сервер</span>
          <select
            value={server}
            onChange={(e) =>
              setServer(e.target.value as "all" | "TR1" | "TR2")
            }
          >
            <option value="all">TR1 + TR2</option>
            <option value="TR1">TR1</option>
            <option value="TR2">TR2</option>
          </select>
        </label>
        <label className="public-rating-search">
          <span className="muted">Поиск</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ник или Steam ID…"
          />
        </label>
        <label
          className="muted"
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            paddingBottom: 8,
          }}
        >
          <input
            type="checkbox"
            checked={onlyPlanted}
            onChange={(e) => setOnlyPlanted(e.target.checked)}
          />
          только с минами
        </label>
        <button
          type="button"
          className="public-rating-page-btn"
          onClick={() => void load()}
          disabled={loading}
          style={{ alignSelf: "flex-end" }}
        >
          {loading ? "Считаю…" : "Обновить"}
        </button>
      </div>

      {err ? (
        <p className="muted" style={{ color: "#f88" }}>
          {err}
        </p>
      ) : null}

      {board ? (
        <aside className="public-rating-glossary" aria-label="Пояснения">
          {board.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          <p className="muted">
            Состав BB: {board.membersMatched} · файлов:{" "}
            {board.filesScanned.length} ·{" "}
            {new Date(board.updatedAt).toLocaleString("ru-RU", {
              timeZone: "Europe/Moscow",
            })}
          </p>
        </aside>
      ) : null}

      <PagePager
        page={pageSafe}
        pageCount={pageCount}
        total={view.length}
        onChange={setPage}
      />

      <section className="card public-rating-card">
        <div className="admin-table-wrap public-rating-table-wrap">
          <table className="admin-table cross-rating-table rating-like-cw">
            <thead>
              <tr>
                <Th k="place" label="#" />
                <Th k="nick" label="Кто" />
                <Th
                  k="minesPlanted"
                  label="Поставил"
                  title="Сколько мин поставил"
                />
                <Th
                  k="minesTriggered"
                  label="Сработало"
                  title="Сколько из поставленных нанесли урон"
                />
                <Th
                  k="mineDamage"
                  label="Урон"
                  title="Суммарный урон от его мин"
                />
                <Th
                  k="mineKills"
                  label="Уничтожил"
                  title="Целей до 0 HP (игрок / техника)"
                />
              </tr>
            </thead>
            <tbody>
              {loading && !board ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Считаю по логам…
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Нет строк
                  </td>
                </tr>
              ) : (
                pageRows.map((r) => (
                  <tr key={r.steamId}>
                    <td>{r.place}</td>
                    <td className="col-nick">
                      <Link href={`/players/${encodeURIComponent(r.nick)}`}>
                        {r.nick}
                      </Link>
                    </td>
                    <td>{r.minesPlanted}</td>
                    <td>
                      {r.minesTriggered}
                      {r.minesPlanted > 0 ? (
                        <span className="muted" style={{ marginLeft: 6 }}>
                          (
                          {Math.round(
                            (100 * r.minesTriggered) / r.minesPlanted
                          )}
                          %)
                        </span>
                      ) : null}
                    </td>
                    <td>{r.mineDamage}</td>
                    <td>{r.mineKills}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <PagePager
        page={pageSafe}
        pageCount={pageCount}
        total={view.length}
        onChange={setPage}
      />
    </>
  );
}
