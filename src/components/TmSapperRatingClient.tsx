"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BbSapperRatingBoard,
  SapperPlaceStyle,
  SapperRatingRow,
} from "@/lib/fobMinesLab";

const PAGE_SIZE = 50;

type SortKey = keyof SapperRatingRow;
type Tab = "mines" | "fob";

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
    <nav className="tm-sapper-pager" aria-label="Страницы списка">
      <span className="tm-sapper-muted">
        {from}–{to} из {total}
      </span>
      <div className="tm-sapper-pager-btns">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={`tm-sapper-page-btn${n === page ? " is-active" : ""}`}
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

function StyleBadge({ style, label }: { style: SapperPlaceStyle; label: string }) {
  if (style === "none") return <span className="tm-sapper-muted">—</span>;
  return (
    <span
      className={`tm-sapper-badge tm-sapper-badge--${style}`}
      title={
        style === "cluster"
          ? "Мины рядом: часто цепляют друг друга"
          : style === "precision"
            ? "Мины поодиночке, без цепных сработок"
            : "И кучно, и точечно"
      }
    >
      {label}
    </span>
  );
}

function TriggerSplit({ solo, chain }: { solo: number; chain: number }) {
  const t = solo + chain;
  if (t <= 0) return <span className="tm-sapper-muted">—</span>;
  const soloPct = Math.round((100 * solo) / t);
  return (
    <div className="tm-sapper-split">
      <div
        className="tm-sapper-split-bar"
        title={`одиночные ${solo} · цепью ${chain}`}
      >
        {solo > 0 ? (
          <div className="tm-sapper-split-solo" style={{ width: `${soloPct}%` }} />
        ) : null}
        {chain > 0 ? <div className="tm-sapper-split-chain" /> : null}
      </div>
      <div className="tm-sapper-split-legend">
        <span className="is-solo">{solo} од.</span>
        <span className="is-chain">{chain} цепь</span>
      </div>
    </div>
  );
}

export function TmSapperRatingClient() {
  const [server, setServer] = useState<"all" | "TR1" | "TR2">("all");
  const [board, setBoard] = useState<BbSapperRatingBoard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [tab, setTab] = useState<Tab>("mines");
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

  useEffect(() => {
    if (tab === "fob") {
      setSortKey("fobDamage");
      setSortDir("desc");
    } else {
      setSortKey("minesPlanted");
      setSortDir("desc");
    }
    setPage(1);
  }, [tab]);

  const view = useMemo(() => {
    const rows = board?.rows || [];
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (onlyActive) {
        if (tab === "mines") {
          if (r.minesPlanted <= 0 && r.minesTriggered <= 0) return false;
        } else if (r.fobHits <= 0 && r.fobDamage <= 0 && r.fobsDestroyed <= 0) {
          return false;
        }
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
    return list.map((r, i) => ({ ...r, place: i + 1 }));
  }, [board, q, sortKey, sortDir, onlyActive, tab]);

  useEffect(() => {
    setPage(1);
  }, [q, sortKey, sortDir, server, onlyActive]);

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
      setSortDir(k === "nick" || k === "placeStyleLabel" ? "asc" : "desc");
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
        <button type="button" className="tm-sapper-th" onClick={() => toggleSort(k)}>
          {label}
          {active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  }

  return (
    <div className="tm-sapper-shell">
      <header className="tm-sapper-head">
        <p className="tm-sapper-back">
          <Link href="/tm">← Тренировочные матчи</Link>
        </p>
        <h1 className="tm-sapper-title">Сапёры &amp; FOB</h1>
        <p className="tm-sapper-sub">
          BlackBerry · логи TR1/TR2 · только для тебя
        </p>
      </header>

      <div className="tm-sapper-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mines"}
          className={`tm-sapper-tab${tab === "mines" ? " is-active" : ""}`}
          onClick={() => setTab("mines")}
        >
          Мины
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "fob"}
          className={`tm-sapper-tab tm-sapper-tab--fob${tab === "fob" ? " is-active" : ""}`}
          onClick={() => setTab("fob")}
        >
          FOB
        </button>
      </div>

      <div className="tm-sapper-toolbar">
        <label className="tm-sapper-field">
          <span>Сервер</span>
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
        <label className="tm-sapper-field tm-sapper-field--grow">
          <span>Поиск</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ник или Steam ID…"
          />
        </label>
        <label className="tm-sapper-check">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
          />
          только с активностью
        </label>
        <button
          type="button"
          className="tm-sapper-page-btn"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Считаю…" : "Обновить"}
        </button>
      </div>

      {err ? <p className="tm-sapper-err">{err}</p> : null}

      {board ? (
        <aside className="tm-sapper-hint">
          {tab === "mines" ? (
            <>
              <p>
                <strong>Поставил → сработало</strong> — сколько мин и сколько из
                них нанесли урон.
              </p>
              <p>
                <span className="is-solo">● одиночные</span> — только по целям ·{" "}
                <span className="is-chain">● цепью</span> — задела другую мину.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>FOB</strong> — урон и хиты по рации из логов. «Снёс» =
                последний хит до 0 HP.
              </p>
              <p className="tm-sapper-muted">
                Кто поставил или вкопал FOB лопатой — в логах Squad нет.
              </p>
            </>
          )}
          <p className="tm-sapper-muted">
            Файлов: {board.filesScanned.length} · состав BB:{" "}
            {board.membersMatched} ·{" "}
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

      <div className="tm-sapper-table-wrap">
        <table className="tm-sapper-table">
          <thead>
            {tab === "mines" ? (
              <tr>
                <Th k="place" label="#" />
                <Th k="nick" label="Кто" />
                <Th
                  k="minesPlanted"
                  label="Поставил → сработало"
                  title="Сколько поставил и сколько сработали"
                />
                <Th
                  k="soloTriggers"
                  label="Как сработали"
                  title="Одиночные vs цепь"
                />
                <Th k="placeStyleLabel" label="Стиль" />
                <Th k="soloDamage" label="Урон целям" />
                <Th k="chainDamage" label="Урон цепи" />
                <Th
                  k="chainMinesKilled"
                  label="Снёс мин"
                  title="Чужих мин добито цепью"
                />
                <Th k="mineKills" label="Уничтожил" />
              </tr>
            ) : (
              <tr>
                <Th k="place" label="#" />
                <Th k="nick" label="Кто" />
                <Th
                  k="fobDamage"
                  label="Урон FOB"
                  title="Суммарный урон по рациям"
                />
                <Th k="fobHits" label="Хитов" title="Сколько раз бил по рации" />
                <Th
                  k="fobsDestroyed"
                  label="Снёс FOB"
                  title="Последний хит до 0 HP"
                />
                <Th
                  k="minesPlanted"
                  label="Мин (справка)"
                  title="Сколько мин поставил (для контекста)"
                />
              </tr>
            )}
          </thead>
          <tbody>
            {loading && !board ? (
              <tr>
                <td colSpan={9} className="tm-sapper-muted">
                  Считаю по логам…
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="tm-sapper-muted">
                  Нет строк
                </td>
              </tr>
            ) : tab === "mines" ? (
              pageRows.map((r) => (
                <tr key={r.steamId}>
                  <td className="tm-sapper-place">{r.place}</td>
                  <td className="tm-sapper-nick">
                    <Link href={`/players/${encodeURIComponent(r.nick)}`}>
                      {r.nick}
                    </Link>
                  </td>
                  <td>
                    <span className="tm-sapper-planted">{r.minesPlanted}</span>
                    <span className="tm-sapper-muted"> → </span>
                    <span className="tm-sapper-trig">{r.minesTriggered}</span>
                    {r.minesPlanted > 0 ? (
                      <span className="tm-sapper-pct"> {r.triggerPct}%</span>
                    ) : null}
                  </td>
                  <td>
                    <TriggerSplit
                      solo={r.soloTriggers}
                      chain={r.chainTriggers}
                    />
                  </td>
                  <td>
                    <StyleBadge
                      style={r.placeStyle}
                      label={r.placeStyleLabel}
                    />
                  </td>
                  <td>{r.soloDamage}</td>
                  <td>{r.chainDamage}</td>
                  <td>{r.chainMinesKilled}</td>
                  <td>{r.mineKills}</td>
                </tr>
              ))
            ) : (
              pageRows.map((r) => (
                <tr key={r.steamId}>
                  <td className="tm-sapper-place">{r.place}</td>
                  <td className="tm-sapper-nick">
                    <Link href={`/players/${encodeURIComponent(r.nick)}`}>
                      {r.nick}
                    </Link>
                  </td>
                  <td className="tm-sapper-fob-dmg">{r.fobDamage}</td>
                  <td>{r.fobHits}</td>
                  <td className={r.fobsDestroyed > 0 ? "tm-sapper-fob-kill" : undefined}>
                    {r.fobsDestroyed}
                  </td>
                  <td className="tm-sapper-muted">{r.minesPlanted}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PagePager
        page={pageSafe}
        pageCount={pageCount}
        total={view.length}
        onChange={setPage}
      />
    </div>
  );
}
