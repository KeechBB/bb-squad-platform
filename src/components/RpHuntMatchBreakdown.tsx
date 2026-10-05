"use client";

import type { RpMatchEvent, RpPlayerMatch } from "@/lib/trainRp";

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
};

function newestFirst(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

function toNokRows(events: RpMatchEvent[]): Row[] {
  return (events || []).map((e, i) => {
    const tk = Boolean(e.teamkill);
    const mag = Math.abs(Number(e.delta) || 0);
    return {
      key: `n-${i}-${e.time}-${e.victim}`,
      time: e.time || "—",
      nick: e.victim,
      delta: tk ? -mag : mag,
    };
  });
}

function toKillRows(events: RpMatchEvent[]): Row[] {
  return (events || []).map((e, i) => ({
    key: `k-${i}-${e.time}-${e.victim}`,
    time: e.time || "—",
    nick: e.victim,
    delta: Math.abs(Number(e.delta) || 0) * (e.teamkill || e.kind === "tk" ? -1 : 1),
  }));
}

function toDeathRows(events: RpMatchEvent[]): Row[] {
  return (events || []).map((e, i) => ({
    key: `d-${i}-${e.time}-${e.killer}`,
    time: e.time || "—",
    nick: e.killer,
    delta: -Math.abs(Number(e.delta) || 0),
    arrow: true,
  }));
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
              <span className="keech-hunt-nick" title={r.nick}>
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
};

/** Hunt-style 5-column match breakdown (ledger / post-match only). */
export function RpHuntMatchBreakdown({ match, onClose }: Props) {
  const noks = match.noks || [];
  const gotNoks = match.gotNoks || [];
  const kills = match.kills || [];
  const deaths = match.deaths || [];
  const teamkills = match.teamkills || [];
  const revives = match.revives || [];
  const dateShort = match.date?.slice(5)?.replace("-", ".") || match.date;

  const nokRows = toNokRows(noks);
  const killRows = [
    ...toKillRows(kills),
    ...toKillRows(
      teamkills.map((e) => ({ ...e, kind: "tk" as const, teamkill: true }))
    ),
  ];
  const deathRows = toDeathRows(deaths);
  const reviveRows = toReviveRows(revives);
  const gotRows = toGotNokRows(gotNoks);

  const net =
    Math.round(
      (Number(match.net) ||
        [...nokRows, ...killRows, ...deathRows, ...reviveRows, ...gotRows].reduce(
          (s, r) => s + r.delta,
          0
        )) *
        10
    ) / 10;

  return (
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
          <div>
            <h3>
              {match.map} · {dateShort}
            </h3>
            <p className="muted">
              NET {fmtDelta(net)} · N {nokRows.length} / GN {gotRows.length} / K{" "}
              {killRows.length} / D {deathRows.length} / R {reviveRows.length}
            </p>
          </div>
          <button type="button" className="rp-breakdown-close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="keech-hunt-cols detail">
          <Col title={`ноки (${nokRows.length})`} rows={nokRows} />
          <Col title={`+ киллы (${killRows.length})`} rows={killRows} />
          <Col title={`− смерти (${deathRows.length})`} rows={deathRows} />
          <Col title={`+ ресы (${reviveRows.length})`} rows={reviveRows} />
          <Col title={`Меня нокнул (${gotRows.length})`} rows={gotRows} />
        </div>
      </div>
    </div>
  );
}
