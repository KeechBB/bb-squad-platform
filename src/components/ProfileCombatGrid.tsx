"use client";

import type { ReactNode } from "react";

/** Единая сетка 12 клеток: трени / паб / КВ. */

export type CombatGridInput = {
  matches: number;
  rounds?: number | null;
  wins: number;
  draws?: number;
  losses: number;
  winrate: number;
  kills: number;
  deaths: number;
  kd: number;
  avgKills: number;
  dmg: number;
  avgDmg: number;
  res: number;
  nok: number;
  mvpKiller: number;
  mvpMedic: number;
  /** нет на трени/КВ → 0 */
  mvpArmor?: number | null;
  /** нет на трени/КВ → 0 */
  vehicleKills?: number | null;
};

type CellTone =
  | "matches"
  | "wl"
  | "kd"
  | "avg-kills"
  | "dmg"
  | "avg-dmg"
  | "revives"
  | "knocks"
  | "mvp-killer"
  | "mvp-medic"
  | "mvp-armor"
  | "vehicle";

type Cell = {
  tone: CellTone;
  label: string;
  value: ReactNode;
  sub?: string;
};

function cellsFrom(s: CombatGridInput): Cell[] {
  const wl =
    s.draws != null && s.draws > 0
      ? `${s.wins}–${s.draws}–${s.losses}`
      : `${s.wins}–${s.losses}`;
  const armor = Number(s.mvpArmor) || 0;
  const veh = Number(s.vehicleKills) || 0;

  return [
    {
      tone: "matches",
      label: s.rounds != null ? "Матчи / раунды" : "Катки",
      value:
        s.rounds != null ? (
          <>
            {s.matches}
            <em> / {s.rounds}</em>
          </>
        ) : (
          s.matches
        ),
    },
    {
      tone: "wl",
      label: s.draws != null && s.draws > 0 ? "W–D–L" : "W–L",
      value: wl,
      sub: `winrate ${s.winrate}%`,
    },
    {
      tone: "kd",
      label: "K / D",
      value: (
        <>
          {s.kills}
          <em> / {s.deaths}</em>
        </>
      ),
      sub: `KD ${s.kd}`,
    },
    {
      tone: "avg-kills",
      label: "Ср. киллы / катка",
      value: s.avgKills,
    },
    {
      tone: "dmg",
      label: "Урон",
      value: s.dmg.toLocaleString("ru-RU"),
    },
    {
      tone: "avg-dmg",
      label: "Ср. урон / катка",
      value: s.avgDmg,
    },
    {
      tone: "revives",
      label: "Revives",
      value: s.res,
    },
    {
      tone: "knocks",
      label: "Ноки",
      value: s.nok,
    },
    {
      tone: "mvp-killer",
      label: "MVP Killer",
      value: s.mvpKiller,
    },
    {
      tone: "mvp-medic",
      label: "MVP Medic",
      value: s.mvpMedic,
    },
    {
      tone: "mvp-armor",
      label: "MVP Armor",
      value: armor,
    },
    {
      tone: "vehicle",
      label: "Техника",
      value: veh,
    },
  ];
}

export function ProfileCombatGrid({ stats }: { stats: CombatGridInput }) {
  const cells = cellsFrom(stats);
  return (
    <div className="profile-kv-grid-12" role="list">
      {cells.map((c) => (
        <div
          key={c.label}
          role="listitem"
          className={`profile-kv-cell tone-${c.tone}`}
        >
          <span className="profile-kv-cell-label">{c.label}</span>
          <strong>{c.value}</strong>
          {c.sub ? <em className="stat-sub">{c.sub}</em> : null}
        </div>
      ))}
    </div>
  );
}
