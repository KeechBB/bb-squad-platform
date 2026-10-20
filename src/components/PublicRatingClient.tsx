"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicCombatRow } from "@/lib/publicCombat";
import type { PublicMatchRow } from "@/lib/publicMatches";
import { RpPlayerDrilldown } from "@/components/RpPlayerDrilldown";
import {
  ProfileMatchStatsModal,
  type MatchStatsOpen,
} from "@/components/ProfileMatchStatsModal";
import { PublicRpGuide } from "@/components/PublicRpGuide";

type Props = {
  rows: PublicCombatRow[];
  matches?: number;
  matchHistory: PublicMatchRow[];
  updatedAt?: string;
};

type Tab = "rating" | "history" | "guide";
type SortKey = keyof PublicCombatRow | "medals";
type MatchSortKey =
  | "date"
  | "time"
  | "mapName"
  | "serverLabel"
  | "faction1"
  | "score1"
  | "faction2"
  | "score2"
  | "winnerName";

/** Одна страница рейтинга / истории — без внутреннего скролла таблицы. */
const PAGE_SIZE = 50;
const KEECH_STEAM_ID = "76561198028435874";

const RP_STEP = 150;
const RP_BANDS: [string, string][] = [
  ["Iron", "iron"],
  ["Bronze", "bronze"],
  ["Silver", "silver"],
  ["Gold", "gold"],
  ["Platinum", "platinum"],
  ["Diamond", "diamond"],
  ["Legend", "legend"],
  ["Immortal", "immortal"],
  ["Master", "master"],
  ["Radiant", "radiant"],
  ["Eclipse", "eclipse"],
];
/** Ceiling before Predator (= Eclipse III max). */
const RP_PREDATOR_MIN = RP_BANDS.length * 3 * RP_STEP + 1; // 4951

const MSK = "Europe/Moscow";

function mskParts(iso: string): { date: string; time: string; y: number; m: number; d: string } {
  const dt = new Date(iso);
  const date = dt.toLocaleDateString("ru-RU", {
    timeZone: MSK,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = dt.toLocaleTimeString("ru-RU", {
    timeZone: MSK,
    hour: "2-digit",
    minute: "2-digit",
  });
  const y = Number(
    dt.toLocaleString("en-CA", { timeZone: MSK, year: "numeric" })
  );
  const m = Number(
    dt.toLocaleString("en-CA", { timeZone: MSK, month: "numeric" })
  );
  const d = dt.toLocaleString("en-CA", {
    timeZone: MSK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return { date, time, y, m, d };
}

function RpRankScale() {
  // Per-rank roman (как на ТМ) — клик 1/2/3 меняет только этот ранг
  const [romanByKey, setRomanByKey] = useState<Record<string, number>>({});
  const roman = ["I", "II", "III"] as const;

  return (
    <div className="public-rp-scale" aria-label="RP ranks">
      <span className="public-rp-scale-label">
        RP
        <br />
        ranks
      </span>
      <div className="public-rp-scale-track">
        {RP_BANDS.map(([name, key], bi) => {
          const ri = romanByKey[key] ?? 0;
          const min = bi * 3 * RP_STEP + 1;
          const bandMin = min + ri * RP_STEP;
          const bandMax = bandMin + RP_STEP - 1;
          return (
            <span key={key} className="public-rp-scale-step-wrap">
              <span className="public-rp-scale-step">
                <span className="public-rp-scale-range">
                  {bandMin}–{bandMax}
                </span>
                <span
                  className={`home-pwr-badge rank-${key} public-rp-scale-badge`}
                >
                  {name.toUpperCase()} {roman[ri]}
                </span>
                <span className="public-rp-scale-tier-btns" role="group">
                  {roman.map((r, rIdx) => (
                    <button
                      key={r}
                      type="button"
                      className={`public-rp-scale-tier-btn${rIdx === ri ? " is-active" : ""}`}
                      aria-pressed={rIdx === ri}
                      onClick={() =>
                        setRomanByKey((prev) => ({ ...prev, [key]: rIdx }))
                      }
                    >
                      {rIdx + 1}
                    </button>
                  ))}
                </span>
              </span>
              <span className="public-rp-scale-arrow" aria-hidden>
                →
              </span>
            </span>
          );
        })}
        <span className="public-rp-scale-step public-rp-scale-step-predator">
          <span className="public-rp-scale-range">{RP_PREDATOR_MIN}+</span>
          <span className="home-pwr-badge rank-predator public-rp-scale-badge">
            PREDATOR
            <br />
            <small>#</small>
          </span>
        </span>
      </div>
    </div>
  );
}

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

export function PublicRatingClient({
  rows,
  matchHistory,
}: Props) {
  const [tab, setTab] = useState<Tab>("rating");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("place");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const [mq, setMq] = useState("");
  const [year, setYear] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [mSortKey, setMSortKey] = useState<MatchSortKey>("date");
  const [mSortDir, setMSortDir] = useState<"asc" | "desc">("desc");
  const [mPage, setMPage] = useState(1);
  const [drillNick, setDrillNick] = useState<string | null>(null);
  const [matchOpen, setMatchOpen] = useState<MatchStatsOpen | null>(null);

  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    for (const m of matchHistory) ys.add(mskParts(m.endedAt).y);
    return Array.from(ys).sort((a, b) => b - a);
  }, [matchHistory]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (needle) {
      list = list.filter(
        (r) =>
          r.nick.toLowerCase().includes(needle) ||
          (r.steamId && r.steamId.toLowerCase().includes(needle))
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return list.slice().sort((a, b) => {
      if (sortKey === "nick" || sortKey === "clan" || sortKey === "rankLabel") {
        return (
          dir *
          String(a[sortKey] || "").localeCompare(String(b[sortKey] || ""), "ru")
        );
      }
      if (sortKey === "medals") {
        const av = a.mvpMedic + a.mvpKiller;
        const bv = b.mvpMedic + b.mvpKiller;
        if (av !== bv) return dir * (av - bv);
        return a.nick.localeCompare(b.nick, "ru");
      }
      if (sortKey === "rp" || sortKey === "winPct") {
        const av = a[sortKey] == null ? -1e9 : Number(a[sortKey]);
        const bv = b[sortKey] == null ? -1e9 : Number(b[sortKey]);
        if (av !== bv) return dir * (av - bv);
        return a.nick.localeCompare(b.nick, "ru");
      }
      if (sortKey === "hasProfile" || sortKey === "steamId") {
        if (sortKey === "steamId") {
          return (
            dir *
            String(a.steamId || "").localeCompare(String(b.steamId || ""), "en")
          );
        }
        return a.nick.localeCompare(b.nick, "ru");
      }
      const av = Number(a[sortKey as keyof PublicCombatRow]) || 0;
      const bv = Number(b[sortKey as keyof PublicCombatRow]) || 0;
      if (av !== bv) return dir * (av - bv);
      return a.nick.localeCompare(b.nick, "ru");
    });
  }, [rows, q, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [q, sortKey, sortDir]);

  useEffect(() => {
    setMPage(1);
  }, [mq, year, month, day, mSortKey, mSortDir]);

  const pageCount = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE;
    return view.slice(start, start + PAGE_SIZE);
  }, [view, pageSafe]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (hash === "#history") {
      setTab("history");
      return;
    }
    if (hash === "#rp" || hash === "#guide") {
      setTab("guide");
      return;
    }
    if (!hash.startsWith("#player-")) return;
    setTab("rating");
    const nick = decodeURIComponent(hash.slice("#player-".length));
    const idx = view.findIndex((r) => r.nick === nick);
    if (idx >= 0) {
      setPage(Math.floor(idx / PAGE_SIZE) + 1);
    }
    const id = `player-${nick}`;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("public-rating-row-flash");
      }
    });
  }, [rows, view]);

  const records = useMemo(() => {
    const maxOf = (pick: (r: PublicCombatRow) => number | null | undefined) => {
      let max = 0;
      for (const r of view) {
        const v = Number(pick(r));
        if (Number.isFinite(v) && v > max) max = v;
      }
      return max;
    };
    return {
      rp: maxOf((r) => (r.rp == null ? 0 : Math.round(r.rp))),
      games: maxOf((r) => r.games),
      winPct: maxOf((r) => r.winPct),
      res: maxOf((r) => r.res),
      nok: maxOf((r) => r.nok),
      kills: maxOf((r) => r.kills),
      deaths: maxOf((r) => r.deaths),
      kd: maxOf((r) => r.kd),
      vehicleKills: maxOf((r) => r.vehicleKills),
      mvpMedic: maxOf((r) => r.mvpMedic),
      mvpKiller: maxOf((r) => r.mvpKiller),
      mvpArmor: maxOf((r) => r.mvpArmor),
    };
  }, [view]);

  function recordCls(
    value: number | null | undefined,
    max: number,
    extra = ""
  ): string {
    const v = Number(value) || 0;
    const isRec = max > 0 && v === max;
    return [extra, isRec ? "record" : ""].filter(Boolean).join(" ");
  }

  function mvpCls(
    value: number,
    kind: "medic" | "killer" | "war" | "armor",
    max: number
  ): string {
    const base = `ctr col-mvp-${kind}`;
    const v = Number(value) || 0;
    if (max > 0 && v === max) return `${base} record`;
    if (v > 0) return `${base} has-mvp`;
    return base;
  }

  const matchView = useMemo(() => {
    const needle = mq.trim().toLowerCase();
    const yNum = year ? Number(year) : null;
    const mNum = month ? Number(month) : null;
    let list = matchHistory.filter((row) => {
      const p = mskParts(row.endedAt);
      if (yNum != null && p.y !== yNum) return false;
      if (mNum != null && p.m !== mNum) return false;
      if (day && p.d !== day) return false;
      if (!needle) return true;
      const hay = [
        row.mapName,
        row.layerName,
        row.faction1,
        row.faction1Side,
        row.faction2,
        row.faction2Side,
        row.winnerName,
        row.serverLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
    const dir = mSortDir === "asc" ? 1 : -1;
    list = list.slice().sort((a, b) => {
      const pa = mskParts(a.endedAt);
      const pb = mskParts(b.endedAt);
      if (mSortKey === "date") {
        const cmp = pa.d.localeCompare(pb.d);
        if (cmp !== 0) return dir * cmp;
        return dir * pa.time.localeCompare(pb.time);
      }
      if (mSortKey === "time") {
        const cmp = pa.time.localeCompare(pb.time);
        if (cmp !== 0) return dir * cmp;
        return dir * pa.d.localeCompare(pb.d);
      }
      if (mSortKey === "score1" || mSortKey === "score2") {
        return dir * (a[mSortKey] - b[mSortKey]);
      }
      return (
        dir *
        String(a[mSortKey] || "").localeCompare(String(b[mSortKey] || ""), "ru")
      );
    });
    return list;
  }, [matchHistory, mq, year, month, day, mSortKey, mSortDir]);

  const mPageCount = Math.max(1, Math.ceil(matchView.length / PAGE_SIZE));
  const mPageSafe = Math.min(mPage, mPageCount);
  const matchPageRows = useMemo(() => {
    const start = (mPageSafe - 1) * PAGE_SIZE;
    return matchView.slice(start, start + PAGE_SIZE);
  }, [matchView, mPageSafe]);

  function goPage(p: number) {
    setPage(p);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function goMatchPage(p: number) {
    setMPage(p);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function onSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "nick" || key === "clan" || key === "place" ? "asc" : "desc"
      );
    }
  }

  function onMatchSort(key: MatchSortKey) {
    if (mSortKey === key) {
      setMSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setMSortKey(key);
      setMSortDir(
        key === "date" || key === "time" || key === "mapName" ? "desc" : "asc"
      );
    }
  }

  function Th({
    k,
    label,
    className = "ctr",
    title,
  }: {
    k: SortKey;
    label: string;
    className?: string;
    title?: string;
  }) {
    const active = sortKey === k;
    return (
      <th
        className={`${className} sortable${active ? " is-sorted" : ""}`}
        onClick={() => onSort(k)}
        title={title || "Сортировать"}
      >
        {label}
        <span className="sort-ind" aria-hidden="true">
          {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
        </span>
      </th>
    );
  }

  function MTh({
    k,
    label,
    className = "ctr",
  }: {
    k: MatchSortKey;
    label: string;
    className?: string;
  }) {
    const active = mSortKey === k;
    return (
      <th
        className={`${className} sortable${active ? " is-sorted" : ""}`}
        onClick={() => onMatchSort(k)}
        title="Сортировать"
      >
        {label}
        <span className="sort-ind" aria-hidden="true">
          {active ? (mSortDir === "asc" ? "▲" : "▼") : ""}
        </span>
      </th>
    );
  }

  return (
    <div className="public-rating-shell">
      <div className="public-rating-tabs" role="tablist" aria-label="Разделы паблика">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "rating"}
          className={`public-rating-tab${tab === "rating" ? " is-active" : ""}`}
          onClick={() => setTab("rating")}
        >
          Рейтинг игроков
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={`public-rating-tab${tab === "history" ? " is-active" : ""}`}
          onClick={() => setTab("history")}
        >
          История матчей
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "guide"}
          className={`public-rating-tab public-rating-tab-guide${
            tab === "guide" ? " is-active" : ""
          }`}
          onClick={() => setTab("guide")}
        >
          Как работает RP
        </button>
      </div>

      {tab === "guide" ? (
        <PublicRpGuide />
      ) : tab === "rating" ? (
        <>
          <p className="public-rating-top-label">Top 500</p>
          <RpRankScale />

          <div className="public-rating-filters">
            <label className="public-rating-search">
              <span className="muted">Поиск ника / Steam ID</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ник игрока или Steam ID…"
              />
            </label>
          </div>

          <aside className="public-rating-glossary" aria-label="Термины рейтинга">
            <p>
              <strong>RP</strong> — рейтинговые очки паблика (SEED не считаем).
            </p>
            <p>
              <strong>Каток</strong> — сыгранные матчи паблика ·{" "}
              <strong>% побед</strong> — доля побед в этих матчах.
            </p>
            <p>
              <strong>Ресы</strong> — кого поднял ·{" "}
              <strong>Ноки</strong> — все нокдауны (в т.ч. закончившиеся гивапом) ·{" "}
              <strong>Килы / смерти</strong> — только гивап ·{" "}
              <strong>KD</strong> — киллы / смерти.
            </p>
            <p>
              Считаем только матчи из вкладки «История» (с {`03.10.2026`}), после
              каждой катки PB1 — автоматически. Боевой счёт временно не показываем
              (нет достоверного источника без табло).
            </p>
            <p>
              <strong>Уничтожено ТЕХ</strong> — сколько техники уничтожил (с
              17.10 01:00 МСК, по логам) ·{" "}
              <strong>MVP Medic / Killer / Armor</strong> — награды за матч
              (Armor = больше всех уничтожил техники). Рекорды — жёлтым.
            </p>
          </aside>

          <PagePager
            page={pageSafe}
            pageCount={pageCount}
            total={view.length}
            onChange={goPage}
          />

          <section className="card public-rating-card">
            <div className="admin-table-wrap public-rating-table-wrap">
              <table className="admin-table cross-rating-table rating-like-cw">
                <thead>
                  <tr>
                    <Th k="place" label="Место" />
                    <Th k="rankLabel" label="Rank" />
                    <Th k="rp" label="RP" />
                    <Th k="clan" label="Тег" className="ctr col-tag" />
                    <Th k="nick" label="Ник" className="col-nick" />
                    <Th k="games" label="Каток" />
                    <Th k="winPct" label="% побед" />
                    <Th k="res" label="Ресы" />
                    <Th k="nok" label="Ноки" />
                    <Th k="kills" label="Килы" />
                    <Th k="deaths" label="Смерти" />
                    <Th k="kd" label="KD" />
                    <Th
                      k="vehicleKills"
                      label="Уничтожено ТЕХ"
                      className="ctr col-veh"
                      title="Уничтоженная техника с 17.10.2026 01:00 МСК"
                    />
                    <Th k="mvpMedic" label="MVP Medic" className="ctr col-mvp-medic" />
                    <Th k="mvpKiller" label="MVP Killer" className="ctr col-mvp-killer" />
                    <Th
                      k="mvpArmor"
                      label="MVP Armor"
                      className="ctr col-mvp-armor"
                      title="MVP за уничтожение техники в матче"
                    />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="muted">
                        Пока нет данных с паблика.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((r) => {
                      const rpVal = r.rp == null ? null : Math.round(r.rp);
                      const hasKeechPatch = r.steamId === KEECH_STEAM_ID;
                      return (
                      <tr key={r.steamId || r.nick} id={`player-${r.nick}`}>
                        <td className="ctr">{r.place}</td>
                        <td className="ctr">
                          <span className={`home-pwr-badge rank-${r.rankKey}`}>
                            {r.rankLabel}
                          </span>
                        </td>
                        <td className={recordCls(rpVal, records.rp, "ctr")}>
                          {rpVal == null ? "—" : rpVal}
                        </td>
                        <td className="ctr col-tag">{r.clan}</td>
                        <td className="col-nick">
                          <button
                            type="button"
                            className={`public-rating-nick-btn${
                              hasKeechPatch ? " bp-nick-patch-test" : ""
                            }`}
                            title="Карты и детальный разбор RP"
                            onClick={() => setDrillNick(r.nick)}
                          >
                            {r.nick}
                          </button>
                          {r.hasProfile ? (
                            <Link
                              className="public-rating-profile-pill"
                              href={`/players/${encodeURIComponent(r.nick)}`}
                              title="Открыть профиль на сайте"
                              onClick={(e) => e.stopPropagation()}
                            >
                              profile
                            </Link>
                          ) : null}
                        </td>
                        <td className={recordCls(r.games, records.games, "ctr")}>
                          {r.games}
                        </td>
                        <td
                          className={recordCls(r.winPct, records.winPct, "ctr")}
                        >
                          {r.winPct == null ? "—" : `${r.winPct}%`}
                        </td>
                        <td className={recordCls(r.res, records.res, "ctr")}>
                          {r.res}
                        </td>
                        <td className={recordCls(r.nok, records.nok, "ctr")}>
                          {r.nok}
                        </td>
                        <td className={recordCls(r.kills, records.kills, "ctr")}>
                          {r.kills}
                        </td>
                        <td
                          className={recordCls(r.deaths, records.deaths, "ctr")}
                        >
                          {r.deaths}
                        </td>
                        <td className={recordCls(r.kd, records.kd, "ctr")}>
                          {r.kd}
                        </td>
                        <td
                          className={recordCls(
                            r.vehicleKills,
                            records.vehicleKills,
                            "ctr col-veh"
                          )}
                        >
                          {r.vehicleKills}
                        </td>
                        <td className={mvpCls(r.mvpMedic, "medic", records.mvpMedic)}>
                          {r.mvpMedic}
                        </td>
                        <td className={mvpCls(r.mvpKiller, "killer", records.mvpKiller)}>
                          {r.mvpKiller}
                        </td>
                        <td className={mvpCls(r.mvpArmor, "armor", records.mvpArmor)}>
                          {r.mvpArmor}
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <PagePager
            page={pageSafe}
            pageCount={pageCount}
            total={view.length}
            onChange={goPage}
          />
        </>
      ) : (
        <>
          <aside className="public-rating-glossary" aria-label="История матчей">
            <p>
              Матчи паблика добавляются автоматически по окончании раунда (без
              SEED). Победившая фракция подсвечена зелёным. Кликни строку —
              разбор как на КВ/тренировках (Итого + фракции).
            </p>
          </aside>

          <div className="public-match-filters">
            <label>
              <span className="muted">Дата</span>
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <label>
              <span className="muted">Год</span>
              <select value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">все</option>
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="muted">Месяц</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">все</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={String(m)}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
            <label className="public-rating-search public-match-search">
              <span className="muted">Поиск</span>
              <input
                value={mq}
                onChange={(e) => setMq(e.target.value)}
                placeholder="карта, фракция…"
              />
            </label>
          </div>

          <PagePager
            page={mPageSafe}
            pageCount={mPageCount}
            total={matchView.length}
            onChange={goMatchPage}
          />

          <section className="card public-rating-card">
            <div className="admin-table-wrap public-rating-table-wrap public-match-table-wrap">
              <table className="admin-table cross-rating-table">
                <thead>
                  <tr>
                    <MTh k="date" label="Дата" />
                    <MTh k="time" label="Время" />
                    <MTh k="mapName" label="Карта" />
                    <MTh k="serverLabel" label="Сервер" />
                    <MTh k="faction1" label="Фракция 1" />
                    <MTh k="score1" label="Счёт 1" />
                    <MTh k="faction2" label="Фракция 2" />
                    <MTh k="score2" label="Счёт 2" />
                    <MTh k="winnerName" label="Победитель" />
                  </tr>
                </thead>
                <tbody>
                  {matchPageRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="muted">
                        Пока нет матчей паблика (появятся после окончания
                        следующих каток).
                      </td>
                    </tr>
                  ) : (
                    matchPageRows.map((m) => {
                      const p = mskParts(m.endedAt);
                      const f1 =
                        m.faction1Side || m.faction1;
                      const f2 =
                        m.faction2Side || m.faction2;
                      const winLabel =
                        m.winnerTeam === 1
                          ? m.faction1Side || m.winnerName
                          : m.faction2Side || m.winnerName;
                      const s1Win = m.winnerTeam === 1;
                      const s2Win = m.winnerTeam === 2;
                      return (
                        <tr
                          key={m.id}
                          className="public-match-row is-clickable"
                          role="button"
                          tabIndex={0}
                          title="Открыть разбор матча"
                          onClick={() =>
                            setMatchOpen({
                              kind: "public",
                              matchId: m.id,
                              dateLabel: p.date,
                              timeLabel: p.time,
                              factionA: String(f1 || m.faction1 || "Команда 1"),
                              factionB: String(f2 || m.faction2 || "Команда 2"),
                              ticketsA: m.score1,
                              ticketsB: m.score2,
                              title: `${p.date} · ${m.mapName}`,
                              sub: `${m.layerName || m.mapName} · ${m.serverLabel}`,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setMatchOpen({
                                kind: "public",
                                matchId: m.id,
                                dateLabel: p.date,
                                timeLabel: p.time,
                                factionA: String(
                                  f1 || m.faction1 || "Команда 1"
                                ),
                                factionB: String(
                                  f2 || m.faction2 || "Команда 2"
                                ),
                                ticketsA: m.score1,
                                ticketsB: m.score2,
                                title: `${p.date} · ${m.mapName}`,
                                sub: `${m.layerName || m.mapName} · ${m.serverLabel}`,
                              });
                            }
                          }}
                        >
                          <td className="ctr">{p.date}</td>
                          <td className="ctr">{p.time}</td>
                          <td className="ctr" title={m.layerName || undefined}>
                            {m.mapName}
                          </td>
                          <td className="ctr">{m.serverLabel}</td>
                          <td className="ctr" title={m.faction1}>
                            {f1}
                          </td>
                          <td
                            className={`ctr public-match-score ${
                              s1Win
                                ? "is-win"
                                : s2Win
                                  ? "is-lose"
                                  : ""
                            }`}
                          >
                            {m.score1}
                          </td>
                          <td className="ctr" title={m.faction2}>
                            {f2}
                          </td>
                          <td
                            className={`ctr public-match-score ${
                              s2Win
                                ? "is-win"
                                : s1Win
                                  ? "is-lose"
                                  : ""
                            }`}
                          >
                            {m.score2}
                          </td>
                          <td className="ctr">
                            <span className="public-match-winner">{winLabel}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <PagePager
            page={mPageSafe}
            pageCount={mPageCount}
            total={matchView.length}
            onChange={goMatchPage}
          />
        </>
      )}

      {drillNick ? (
        <RpPlayerDrilldown
          nick={drillNick}
          open
          onClose={() => setDrillNick(null)}
        />
      ) : null}

      <ProfileMatchStatsModal
        open={matchOpen}
        onClose={() => setMatchOpen(null)}
      />
    </div>
  );
}
