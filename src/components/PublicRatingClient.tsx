"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicCombatRow } from "@/lib/publicCombat";
import type { PublicMatchRow } from "@/lib/publicMatches";

type Props = {
  rows: PublicCombatRow[];
  matches: number;
  matchHistory: PublicMatchRow[];
  updatedAt: string;
};

type Tab = "rating" | "history";
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
];

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
  const [romanIdx, setRomanIdx] = useState(0); // 0=I, 1=II, 2=III
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
          const min = bi * 3 * RP_STEP + 1;
          const bandMin = min + romanIdx * RP_STEP;
          const bandMax = bandMin + RP_STEP - 1;
          return (
            <span key={key} className="public-rp-scale-step">
              <span className="public-rp-scale-range">
                {bandMin}–{bandMax}
              </span>
              <span className={`home-pwr-badge rank-${key} public-rp-scale-badge`}>
                {name.toUpperCase()} {roman[romanIdx]}
              </span>
              <span className="public-rp-scale-tier-btns" role="group">
                {roman.map((r, ri) => (
                  <button
                    key={r}
                    type="button"
                    className={`public-rp-scale-tier-btn${ri === romanIdx ? " is-active" : ""}`}
                    aria-pressed={ri === romanIdx}
                    onClick={() => setRomanIdx(ri)}
                  >
                    {ri + 1}
                  </button>
                ))}
              </span>
              {bi < RP_BANDS.length - 1 ? (
                <span className="public-rp-scale-arrow" aria-hidden>
                  →
                </span>
              ) : null}
            </span>
          );
        })}
        <span className="public-rp-scale-step public-rp-scale-step-predator">
          <span className="public-rp-scale-range">4501+</span>
          <span className="home-pwr-badge rank-predator public-rp-scale-badge">
            PREDATOR
          </span>
        </span>
      </div>
    </div>
  );
}

export function PublicRatingClient({
  rows,
  matches,
  matchHistory,
  updatedAt,
}: Props) {
  const [tab, setTab] = useState<Tab>("rating");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("place");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [mq, setMq] = useState("");
  const [year, setYear] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [mSortKey, setMSortKey] = useState<MatchSortKey>("date");
  const [mSortDir, setMSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (hash === "#history") {
      setTab("history");
      return;
    }
    if (!hash.startsWith("#player-")) return;
    setTab("rating");
    const id = decodeURIComponent(hash.slice(1));
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("public-rating-row-flash");
    }
  }, [rows]);

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
        const av = a.mvpMedic + a.mvpKiller + a.mvpDamage;
        const bv = b.mvpMedic + b.mvpKiller + b.mvpDamage;
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
  }: {
    k: SortKey;
    label: string;
    className?: string;
  }) {
    const active = sortKey === k;
    return (
      <th
        className={`${className} sortable${active ? " is-sorted" : ""}`}
        onClick={() => onSort(k)}
        title="Сортировать"
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
      <header className="public-rating-top">
        <div>
          <p className="eyebrow">PB1 · TPUB1</p>
          <h1>Паблик</h1>
          <p className="muted" style={{ marginTop: 6, lineHeight: 1.45 }}>
            Рейтинг игроков и история матчей паблика. SEED не считаем.
          </p>
        </div>
        <div className="public-rating-meta muted">
          <span>{matches} матчей в рейтинге · </span>
          <span>{matchHistory.length} в истории · </span>
          <span>
            обновлено{" "}
            {new Date(updatedAt).toLocaleString("ru-RU", {
              timeZone: MSK,
            })}
          </span>
        </div>
      </header>

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
      </div>

      {tab === "rating" ? (
        <>
          <RpRankScale />

          <aside className="public-rating-glossary" aria-label="Термины">
            <p>
              <strong>RP</strong> — очки паблика (вес = текущий RP, не PWR). SEED не
              считаем.
            </p>
            <p>
              <strong>Дней PB1</strong> — уникальные календарные дни на паблике (все
              Steam, даже без регистрации на сайте).
            </p>
          </aside>

          <label className="public-rating-search">
            <span className="muted">Ник / Steam ID</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="поиск по нику или Steam…"
            />
          </label>

          <section className="card public-rating-card">
            <div className="admin-table-wrap public-rating-table-wrap">
              <table className="admin-table cross-rating-table rating-like-cw">
                <thead>
                  <tr>
                    <Th k="place" label="Место" />
                    <Th k="rankLabel" label="Rank" />
                    <Th k="rp" label="RP" />
                    <Th k="nick" label="Ник" className="" />
                    <Th k="clan" label="Клан" />
                    <Th k="games" label="Каток" />
                    <Th k="winPct" label="% побед" />
                    <Th k="res" label="Ресы" />
                    <Th k="nok" label="Ноки" />
                    <Th k="kills" label="Килы" />
                    <Th k="deaths" label="Смерти" />
                    <Th k="kd" label="KD" />
                    <Th k="dmg" label="Боевой счёт" />
                    <Th k="mvpMedic" label="MVP Medic" className="ctr col-mvp-medic" />
                    <Th k="mvpKiller" label="MVP Killer" className="ctr col-mvp-killer" />
                    <Th k="mvpDamage" label="MVP War-Score" className="ctr col-mvp-war" />
                    <Th k="antiDeath" label="Anti-MVP" className="ctr col-mvp-anti" />
                    <Th k="days" label="Дней PB1" />
                  </tr>
                </thead>
                <tbody>
                  {view.length === 0 ? (
                    <tr>
                      <td colSpan={18} className="muted">
                        Пока нет данных с паблика.
                      </td>
                    </tr>
                  ) : (
                    view.map((r) => (
                      <tr key={r.steamId || r.nick} id={`player-${r.nick}`}>
                        <td className="ctr">{r.place}</td>
                        <td className="ctr">
                          <span className={`home-pwr-badge rank-${r.rankKey}`}>
                            {r.rankLabel}
                          </span>
                        </td>
                        <td className="ctr">
                          {r.rp == null ? "—" : Math.round(r.rp)}
                        </td>
                        <td>
                          {r.hasProfile ? (
                            <Link
                              className="kv-link"
                              href={`/players/${encodeURIComponent(r.nick)}`}
                            >
                              {r.nick}
                            </Link>
                          ) : (
                            <span title="Ещё нет аккаунта на сайте">{r.nick}</span>
                          )}
                        </td>
                        <td className="ctr">{r.clan}</td>
                        <td className="ctr">{r.games}</td>
                        <td className="ctr">
                          {r.winPct == null ? "—" : `${r.winPct}%`}
                        </td>
                        <td className="ctr">{r.res}</td>
                        <td className="ctr">{r.nok}</td>
                        <td className="ctr">{r.kills}</td>
                        <td className="ctr">{r.deaths}</td>
                        <td className="ctr">{r.kd}</td>
                        <td className="ctr">{r.dmg.toLocaleString("ru-RU")}</td>
                        <td className="ctr col-mvp-medic">{r.mvpMedic}</td>
                        <td className="ctr col-mvp-killer">{r.mvpKiller}</td>
                        <td className="ctr col-mvp-war">{r.mvpDamage}</td>
                        <td className="ctr col-mvp-anti">{r.antiDeath}</td>
                        <td className="ctr">{r.days}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <aside className="public-rating-glossary" aria-label="История матчей">
            <p>
              Матчи паблика добавляются автоматически по окончании раунда (без
              SEED). Победившая фракция подсвечена зелёным.
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

          <section className="card public-rating-card">
            <div className="admin-table-wrap public-rating-table-wrap public-match-table-wrap">
              <table className="admin-table cross-rating-table">
                <thead>
                  <tr>
                    <MTh k="date" label="Дата" />
                    <MTh k="time" label="Время" />
                    <MTh k="mapName" label="Карта" className="" />
                    <MTh k="serverLabel" label="Сервер" />
                    <MTh k="faction1" label="Фракция 1" className="" />
                    <MTh k="score1" label="Счёт 1" />
                    <MTh k="faction2" label="Фракция 2" className="" />
                    <MTh k="score2" label="Счёт 2" />
                    <MTh k="winnerName" label="Победитель" className="" />
                  </tr>
                </thead>
                <tbody>
                  {matchView.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="muted">
                        Пока нет матчей паблика (появятся после окончания
                        следующих каток).
                      </td>
                    </tr>
                  ) : (
                    matchView.map((m) => {
                      const p = mskParts(m.endedAt);
                      const f1 =
                        m.faction1Side || m.faction1;
                      const f2 =
                        m.faction2Side || m.faction2;
                      const winLabel =
                        m.winnerTeam === 1
                          ? m.faction1Side || m.winnerName
                          : m.faction2Side || m.winnerName;
                      return (
                        <tr key={m.id}>
                          <td className="ctr">{p.date}</td>
                          <td className="ctr">{p.time}</td>
                          <td title={m.layerName || undefined}>{m.mapName}</td>
                          <td className="ctr">{m.serverLabel}</td>
                          <td title={m.faction1}>{f1}</td>
                          <td className="ctr">{m.score1}</td>
                          <td title={m.faction2}>{f2}</td>
                          <td className="ctr">{m.score2}</td>
                          <td>
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
        </>
      )}
    </div>
  );
}
