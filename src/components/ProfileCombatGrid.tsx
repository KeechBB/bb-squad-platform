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

type Cell = {
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
      label: s.draws != null && s.draws > 0 ? "W–D–L" : "W–L",
      value: wl,
      sub: `winrate ${s.winrate}%`,
    },
    {
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
      label: "Ср. киллы / катка",
      value: s.avgKills,
    },
    {
      label: "Урон",
      value: s.dmg.toLocaleString("ru-RU"),
    },
    {
      label: "Ср. урон / катка",
      value: s.avgDmg,
    },
    {
      label: "Revives",
      value: s.res,
    },
    {
      label: "Ноки",
      value: s.nok,
    },
    {
      label: "MVP Killer",
      value: s.mvpKiller,
    },
    {
      label: "MVP Medic",
      value: s.mvpMedic,
    },
    {
      label: "MVP Armor",
      value: armor,
    },
    {
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
        <div key={c.label} role="listitem">
          <span className="muted">{c.label}</span>
          <strong>{c.value}</strong>
          {c.sub ? <em className="stat-sub">{c.sub}</em> : null}
        </div>
      ))}
    </div>
  );
}
