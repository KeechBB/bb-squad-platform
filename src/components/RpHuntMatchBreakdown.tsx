"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { RpMatchEvent, RpPlayerMatch } from "@/lib/trainRp";
import { formatRpEventLabel, isVehicleRpEvent } from "@/lib/rpVehicleLabels";

function fmtDelta(n: number) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return v > 0 ? `+${v}` : String(v);
}

type Row = {
  key: string;
  time: string;
  nick: string;
  delta: number;
  arrow?: boolean;
  /** Full title hover — vehicle reason etc. */
  title?: string;
};

function newestFirst(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

function isDriverShareNok(e: RpMatchEvent): boolean {
  return e.kind === "driver_share" && e.reason === "nok";
}

function toNokRows(events: RpMatchEvent[]): Row[] {
  return (events || []).map((e, i) => {
    const tk = Boolean(e.teamkill);
    const mag = Math.abs(Number(e.delta) || 0);
    const vehicle = isVehicleRpEvent(e);
    const nick = vehicle ? formatRpEventLabel(e, "kill") : e.victim;
    return {
      key: `n-${i}-${e.time}-${e.victim}-${e.kind || "nok"}`,
      time: e.time || "—",
      nick,
      title: vehicle
        ? `${nick} · ${fmtDelta(mag)} RP`
        : e.victim,
      delta: tk ? -mag : mag,
    };
  });
}

function toKillRows(events: RpMatchEvent[]): Row[] {
  return (events || []).map((e, i) => {
    const vehicle = isVehicleRpEvent(e);
    const nick = vehicle ? formatRpEventLabel(e, "kill") : e.victim;
    return {
      key: `k-${i}-${e.time}-${e.victim}-${e.kind || "die"}`,
      time: e.time || "—",
      nick,
      title: vehicle
        ? `${nick} · ${fmtDelta(Math.abs(Number(e.delta) || 0))} RP`
        : e.victim,
      delta:
        Math.abs(Number(e.delta) || 0) *
        (e.teamkill || e.kind === "tk" ? -1 : 1),
    };
  });
}

function toDeathRows(events: RpMatchEvent[]): Row[] {
  return (events || []).map((e, i) => {
    const vehicle = isVehicleRpEvent(e);
    const nick = vehicle ? formatRpEventLabel(e, "death") : e.killer;
    const mag = Math.abs(Number(e.delta) || 0);
    return {
      key: `d-${i}-${e.time}-${e.killer}-${e.kind || "die"}`,
      time: e.time || "—",
      nick,
      title: vehicle
        ? `${nick} · −${mag} RP`
        : e.killer,
      delta: -mag,
      arrow: !vehicle,
    };
  });
}

function toReviveRows(events: RpMatchEvent[]): Row[] {
  return (events || []).map((e, i) => ({
    key: `r-${i}-${e.time}-${e.victim}`,
    time: e.time || "—",
    nick: e.victim,
    delta: Math.abs(Number(e.delta) || 0),
  }));
}

function toGotNokRows(events: RpMatchEvent[]): Row[] {
  return (events || []).map((e, i) => {
    const mag = Math.abs(
      Number((e as RpMatchEvent & { victimDelta?: number }).victimDelta ?? e.delta) || 0
    );
    return {
      key: `gn-${i}-${e.time}-${e.killer}`,
      time: e.time || "—",
      nick: e.killer,
      delta: -mag,
      arrow: true,
    };
  });
}

function Col({
  title,
  rows,
  empty = "—",
}: {
  title: string;
  rows: Row[];
  empty?: string;
}) {
  const list = newestFirst(rows);
  return (
    <section className="keech-hunt-col">
      <h4>{title}</h4>
      {list.length === 0 ? (
        <p className="muted keech-hunt-empty">{empty}</p>
      ) : (
        <ul className="keech-hunt-list">
          {list.map((r) => (
            <li key={r.key} className="keech-hunt-row">
              <span className="keech-hunt-time">{r.time}</span>
              <span className="keech-hunt-nick" title={r.title || r.nick}>
                {r.arrow ? `← ${r.nick}` : r.nick}
              </span>
              <span
                className={`keech-hunt-delta ${r.delta >= 0 ? "plus" : "minus"}`}
              >
                {fmtDelta(r.delta)}
              </span>
              <span className="keech-hunt-hit-spacer" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Props = {
  match: RpPlayerMatch;
  onClose: () => void;
  /** Вкладка внутри модалки матча — без своего оверлея. */
  embedded?: boolean;
};

export function useRpMatchColumns(match: RpPlayerMatch) {
  // Килы = гивапы. Техника = vehicle_kill / loss. Доля мехвода в столбики не идёт.
  const rawKills = match.kills || [];
  const shareNoks = rawKills.filter(isDriverShareNok);
  const legacyVehicleFromKills = rawKills.filter(
    (e) =>
      e.kind === "vehicle_kill" ||
      (e.kind === "driver_share" && e.reason !== "nok")
  );
  const kills = rawKills.filter(
    (e) =>
      !isDriverShareNok(e) &&
      e.kind !== "vehicle_kill" &&
      e.kind !== "driver_share"
  );
  const noks = [...(match.noks || []), ...shareNoks];
  const gotNoks = match.gotNoks || [];
  const rawDeaths = match.deaths || [];
  const lossFromDeaths = rawDeaths.filter(
    (e) =>
      e.kind === "vehicle_loss" || e.kind === "vehicle_loss_driver"
  );
  const deaths = rawDeaths.filter(
    (e) =>
      e.kind !== "vehicle_loss" && e.kind !== "vehicle_loss_driver"
  );
  const teamkills = match.teamkills || [];
  const revives = match.revives || [];

  const vehicleEvents = [
    ...(match.vehicles || []),
    ...legacyVehicleFromKills.filter(
      (e) => !(match.vehicles || []).some(
        (v) =>
          v.time === e.time &&
          v.kind === e.kind &&
          v.victim === e.victim
      )
    ),
    ...lossFromDeaths.filter(
      (e) => !(match.vehicles || []).some(
        (v) =>
          v.time === e.time &&
          v.kind === e.kind &&
          v.victim === e.victim
      )
    ),
  ];

  const nokRows = toNokRows(noks);
  const killRows = [
    ...toKillRows(kills),
    ...toKillRows(
      teamkills.map((e) => ({ ...e, kind: "tk" as const, teamkill: true }))
    ),
  ];
  const vehicleGainRows = toKillRows(
    vehicleEvents.filter((e) => e.kind === "vehicle_kill")
  );
  const vehicleLossRows = toDeathRows(
    vehicleEvents.filter(
      (e) =>
        e.kind === "vehicle_loss" || e.kind === "vehicle_loss_driver"
    )
  );
  const vehicleRows = [...vehicleGainRows, ...vehicleLossRows];
  const deathRows = toDeathRows(deaths);
  const reviveRows = toReviveRows(revives);
  const gotRows = toGotNokRows(gotNoks);

  const net =
    Math.round(
      (Number(match.net) ||
        [...nokRows, ...killRows, ...vehicleRows, ...deathRows, ...reviveRows, ...gotRows].reduce(
          (s, r) => s + r.delta,
          0
        )) *
        10
    ) / 10;

  return {
    net,
    nokRows,
    killRows,
    vehicleRows,
    vehicleGainRows,
    vehicleLossRows,
    deathRows,
    reviveRows,
    gotRows,
  };
}

/** Hunt-style 5-column match breakdown (ledger / post-match only). */
export function RpHuntMatchBreakdown({ match, onClose, embedded }: Props) {
  const cols = useRpMatchColumns(match);
  const dateShort = match.date?.slice(5)?.replace("-", ".") || match.date;

  useEffect(() => {
    if (embedded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, embedded]);

  const board = (
    <>
      {embedded ? (
        <p className="profile-rp-detail-net">
          Итог катки{" "}
          <b className={cols.net >= 0 ? "plus" : "minus"}>{fmtDelta(cols.net)} RP</b>
          <span className="muted">
            {" "}
            · ноки {cols.nokRows.length} · киллы {cols.killRows.length} · техника{" "}
            {cols.vehicleGainRows.length}
            {cols.vehicleLossRows.length ? `/−${cols.vehicleLossRows.length}` : ""} ·
            смерти {cols.deathRows.length} · ресы {cols.reviveRows.length} · нокнули{" "}
            {cols.gotRows.length}
          </span>
        </p>
      ) : null}
      <div className="keech-hunt-cols detail rp-breakdown-cols-scroll">
        <Col title={`ноки (${cols.nokRows.length})`} rows={cols.nokRows} />
        <Col title={`+ киллы (${cols.killRows.length})`} rows={cols.killRows} />
        <Col
          title={`техника (${cols.vehicleGainRows.length}${
            cols.vehicleLossRows.length ? `/−${cols.vehicleLossRows.length}` : ""
          })`}
          rows={cols.vehicleRows}
        />
        <Col title={`− смерти (${cols.deathRows.length})`} rows={cols.deathRows} />
        <Col title={`+ ресы (${cols.reviveRows.length})`} rows={cols.reviveRows} />
        <Col title={`Меня нокнул (${cols.gotRows.length})`} rows={cols.gotRows} />
      </div>
    </>
  );

  if (embedded) return <div className="profile-rp-detail">{board}</div>;

  const ui = (
    <div
      className="rp-breakdown-overlay rp-breakdown-overlay-detail"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rp-breakdown-panel hunt-wide">
        <header className="rp-breakdown-head">
          <div className="rp-breakdown-head-main">
            <button
              type="button"
              className="rp-breakdown-back"
              onClick={onClose}
            >
              ← Назад
            </button>
            <div>
              <h3>
                {match.map} · {dateShort}
              </h3>
              <p className="muted">
                NET {fmtDelta(cols.net)} · N {cols.nokRows.length} / GN {cols.gotRows.length} / K{" "}
                {cols.killRows.length} / Т {cols.vehicleGainRows.length} / D {cols.deathRows.length} / R{" "}
                {cols.reviveRows.length}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rp-breakdown-close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        {board}
      </div>
    </div>
  );

  if (typeof document === "undefined") return ui;
  return createPortal(ui, document.body);
}
