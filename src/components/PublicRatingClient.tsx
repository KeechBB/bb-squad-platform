"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicCombatRow } from "@/lib/publicCombat";

type Props = {
  rows: PublicCombatRow[];
  matches: number;
  updatedAt: string;
};

type SortKey = keyof PublicCombatRow | "medals";

export function PublicRatingClient({ rows, matches, updatedAt }: Props) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("place");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#player-")) return;
    const id = decodeURIComponent(hash.slice(1));
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("public-rating-row-flash");
    }
  }, [rows]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (needle) {
      list = list.filter((r) => r.nick.toLowerCase().includes(needle));
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
      const av = Number(a[sortKey as keyof PublicCombatRow]) || 0;
      const bv = Number(b[sortKey as keyof PublicCombatRow]) || 0;
      if (av !== bv) return dir * (av - bv);
      return a.nick.localeCompare(b.nick, "ru");
    });
  }, [rows, q, sortKey, sortDir]);

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

  return (
    <div className="public-rating-shell">
      <header className="public-rating-top">
        <div>
          <p className="eyebrow">PB1 · TPUB1</p>
          <h1>Рейтинг паблика</h1>
          <p className="muted" style={{ marginTop: 6, lineHeight: 1.45 }}>
            Как рейтинг тренировок, без колонки «Тир». MVP считаем с каток
            паблика (без SEED). Пока каток нет — дни на PB1 и нули в боевой стате.
          </p>
        </div>
        <div className="public-rating-meta muted">
          <span>{matches} матчей · </span>
          <span>
            обновлено{" "}
            {new Date(updatedAt).toLocaleString("ru-RU", {
              timeZone: "Europe/Moscow",
            })}
          </span>
        </div>
      </header>

      <label className="public-rating-search">
        <span className="muted">Ник</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="поиск…"
        />
      </label>

      <section className="card">
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
                  <tr key={r.nick} id={`player-${r.nick}`}>
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
                      <Link
                        className="kv-link"
                        href={`/players/${encodeURIComponent(r.nick)}`}
                      >
                        {r.nick}
                      </Link>
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
    </div>
  );
}
