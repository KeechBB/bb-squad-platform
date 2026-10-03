"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PlayerPublicCombatStats } from "@/lib/publicCombat";
import type { RpPlayerMatch } from "@/lib/trainRp";

type Props = {
  nick?: string | null;
  rp?: number | null;
  rankLabel?: string | null;
  rankKey?: string | null;
  combat?: PlayerPublicCombatStats | null;
  matches?: RpPlayerMatch[] | null;
};

function fmtDelta(n: number) {
  const v = Math.round(Number(n) || 0);
  return v > 0 ? `+${v}` : String(v);
}

function romanFromPwr(pwr: number) {
  const band = Math.min(9, Math.max(0, Math.floor(Math.max(0, pwr) / 100)));
  const roman = ["I", "II", "III"] as const;
  return roman[band % 3];
}

function pwrBarPct(pwr: number) {
  return Math.max(8, Math.min(100, (Math.max(0, pwr) / 1000) * 100));
}

function MatchBreakdown({
  match,
  onClose,
}: {
  match: RpPlayerMatch;
  onClose: () => void;
}) {
  const dateShort = match.date?.slice(5)?.replace("-", ".") || match.date;
  return (
    <div className="rp-breakdown-overlay" role="dialog" aria-modal="true">
      <div className="rp-breakdown-panel">
        <header className="rp-breakdown-head">
          <div>
            <h3>
              {match.map} · {dateShort}
            </h3>
            <p className="muted">
              NET {fmtDelta(match.net)} · K {match.kills.length} / D{" "}
              {match.deaths.length}
              {(match.teamkills?.length || 0) > 0
                ? ` · TK ${match.teamkills!.length}`
                : ""}
              {(match.revives?.length || 0) > 0
                ? ` · R ${match.revives!.length}`
                : ""}
            </p>
          </div>
          <button type="button" className="rp-breakdown-close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div
          className={`rp-breakdown-cols${
            (match.revives?.length || 0) > 0 ? " has-revives" : ""
          }`}
        >
          <section>
            <h4 className="rp-breakdown-col-title gain">
              + gained ({match.kills.length})
            </h4>
            <ul className="rp-breakdown-list">
              {match.kills.map((e, i) => (
                <li key={`k-${i}`}>
                  <span className="rp-ev-time">{e.time}</span>
                  <span className="rp-ev-nick" title={e.victim}>
                    {e.victim}
                  </span>
                  <span className="rp-ev-bar-wrap" title={`weight ${e.victimPwr}`}>
                    <span
                      className="rp-ev-bar gain"
                      style={{ width: `${pwrBarPct(e.victimPwr)}%` }}
                    />
                    <span className="rp-ev-roman">{romanFromPwr(e.victimPwr)}</span>
                  </span>
                  <span className="rp-ev-delta plus">{fmtDelta(e.delta)}</span>
                </li>
              ))}
            </ul>
            <p className="rp-breakdown-sum plus">
              Sum {fmtDelta(match.kills.reduce((s, e) => s + e.delta, 0))}
            </p>
          </section>
          <section>
            <h4 className="rp-breakdown-col-title loss">
              − lost (
              {match.deaths.length + (match.teamkills?.length || 0)})
            </h4>
            <ul className="rp-breakdown-list">
              {match.deaths.map((e, i) => (
                <li key={`d-${i}`}>
                  <span className="rp-ev-time">{e.time}</span>
                  <span className="rp-ev-nick" title={e.killer}>
                    {e.kind === "tk" ? `TK ← ${e.killer}` : e.killer}
                  </span>
                  <span className="rp-ev-bar-wrap" title={`weight ${e.killerPwr}`}>
                    <span
                      className="rp-ev-bar loss"
                      style={{ width: `${pwrBarPct(e.killerPwr)}%` }}
                    />
                    <span className="rp-ev-roman">{romanFromPwr(e.killerPwr)}</span>
                  </span>
                  <span className="rp-ev-delta minus">
                    {fmtDelta(-Math.abs(e.delta))}
                  </span>
                </li>
              ))}
              {(match.teamkills || []).map((e, i) => (
                <li key={`tk-${i}`}>
                  <span className="rp-ev-time">{e.time}</span>
                  <span className="rp-ev-nick" title={e.victim}>
                    TK → {e.victim}
                  </span>
                  <span className="rp-ev-bar-wrap" title={`weight ${e.victimPwr}`}>
                    <span
                      className="rp-ev-bar loss"
                      style={{ width: `${pwrBarPct(e.victimPwr)}%` }}
                    />
                    <span className="rp-ev-roman">{romanFromPwr(e.victimPwr)}</span>
                  </span>
                  <span className="rp-ev-delta minus">
                    {fmtDelta(-Math.abs(e.delta))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="rp-breakdown-sum minus">
              Sum{" "}
              {fmtDelta(
                -(
                  match.deaths.reduce((s, e) => s + Math.abs(e.delta), 0) +
                  (match.teamkills || []).reduce(
                    (s, e) => s + Math.abs(e.delta),
                    0
                  )
                )
              )}
            </p>
          </section>
          {(match.revives?.length || 0) > 0 ? (
            <section>
              <h4 className="rp-breakdown-col-title gain">
                + поднял ({match.revives!.length})
              </h4>
              <ul className="rp-breakdown-list">
                {match.revives!.map((e, i) => (
                  <li key={`r-${i}`}>
                    <span className="rp-ev-time">{e.time}</span>
                    <span className="rp-ev-nick" title={e.victim}>
                      {e.victim}
                    </span>
                    <span
                      className="rp-ev-bar-wrap"
                      title={`weight ${e.victimPwr}`}
                    >
                      <span
                        className="rp-ev-bar gain"
                        style={{ width: `${pwrBarPct(e.victimPwr)}%` }}
                      />
                      <span className="rp-ev-roman">
                        {romanFromPwr(e.victimPwr)}
                      </span>
                    </span>
                    <span className="rp-ev-delta plus">{fmtDelta(e.delta)}</span>
                  </li>
                ))}
              </ul>
              <p className="rp-breakdown-sum plus">
                Sum{" "}
                {fmtDelta(match.revives!.reduce((s, e) => s + e.delta, 0))}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Карточка паблика + детальный разбор RP по матчам (как у тренировок). */
export function ProfilePublicRatingCard({
  nick,
  rp,
  rankLabel,
  rankKey,
  combat,
  matches: matchesProp,
}: Props) {
  const [open, setOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState<RpPlayerMatch | null>(null);
  const href = nick
    ? `/public#player-${encodeURIComponent(nick)}`
    : "/public";
  const medals =
    (combat?.mvpDamage || 0) +
    (combat?.mvpKiller || 0) +
    (combat?.mvpMedic || 0);
  const hasAny =
    rp != null ||
    (combat &&
      (combat.matches > 0 ||
        combat.days > 0 ||
        combat.kills > 0 ||
        combat.deaths > 0 ||
        medals > 0 ||
        combat.antiDeath > 0));
  const winPct =
    combat?.winrate != null ? Math.round(combat.winrate) : null;
  const kd =
    combat?.kd != null
      ? Number(combat.kd).toLocaleString("ru-RU", {
          maximumFractionDigits: 2,
        })
      : "—";
  const matches = useMemo(
    () => (matchesProp?.length ? [...matchesProp].reverse() : []),
    [matchesProp]
  );
  const rpShow = rp != null ? Math.round(rp) : null;
  const rankShow = rankLabel || "PB1";

  return (
    <>
      <section className="card profile-pwr-card profile-public-rating-card">
        <div className="profile-kv-head">
          <h2>Рейтинг паблика</h2>
          <Link className="kv-link" href={href}>
            Открыть →
          </Link>
        </div>

        {hasAny ? (
          <>
            <div className="profile-pwr-hero">
              <span
                className={`home-pwr-badge rank-${rankKey || "iron"} profile-pwr-badge`}
                title={rankShow}
              >
                {rankShow}
              </span>
              <div className="profile-pwr-hero-nums">
                <strong>{rpShow == null ? "—" : rpShow}</strong>
                <span className="muted">RP</span>
              </div>
            </div>
            <div className="profile-kv-extra profile-pwr-meta profile-pwr-meta-2">
              <div>
                <span className="muted">Убийства</span>
                <strong>{combat?.kills ?? 0}</strong>
              </div>
              <div>
                <span className="muted">Смерти</span>
                <strong>{combat?.deaths ?? 0}</strong>
              </div>
              <div>
                <span className="muted">KD</span>
                <strong>{kd}</strong>
              </div>
              <div>
                <span className="muted">% побед</span>
                <strong>{winPct == null ? "—" : `${winPct}%`}</strong>
              </div>
            </div>
            <div className="profile-kv-awards">
              <span className="profile-kv-award">
                War <b>{combat?.mvpDamage ?? 0}</b>
              </span>
              <span className="profile-kv-award">
                Killer <b>{combat?.mvpKiller ?? 0}</b>
              </span>
              <span className="profile-kv-award">
                Medic <b>{combat?.mvpMedic ?? 0}</b>
              </span>
              <span className="profile-kv-award">
                Anti <b>{combat?.antiDeath ?? 0}</b>
              </span>
            </div>
          </>
        ) : (
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>
            PB1 · RP и стата появятся после каток паблика (без SEED).
          </p>
        )}

        <button
          type="button"
          className="profile-rp-detail-btn"
          onClick={() => setOpen(true)}
        >
          детальный разбор
        </button>
      </section>

      {open ? (
        <div className="rp-breakdown-overlay" role="dialog" aria-modal="true">
          <div className="rp-breakdown-panel rp-maps-panel">
            <header className="rp-breakdown-head">
              <div>
                <h3>PB1 RP · {nick || "—"}</h3>
                <p className="muted">
                  {rpShow == null ? "—" : rpShow} · {rankShow} · клик по карте —
                  разбор (киллы / смерти / ресы)
                </p>
              </div>
              <button
                type="button"
                className="rp-breakdown-close"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>
            {matches.length === 0 ? (
              <p className="muted">
                Пока нет карт с RP паблика. Появятся после сборки ledger (без
                SEED).
              </p>
            ) : (
              <ul className="rp-maps-list">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="rp-maps-row"
                      onClick={() => setMatchOpen(m)}
                    >
                      <span className="rp-maps-date">
                        {m.date?.slice(5)?.replace("-", ".") || m.date}
                      </span>
                      <span className="rp-maps-map">{m.map}</span>
                      <span
                        className={
                          m.net > 0
                            ? "rp-ev-delta plus"
                            : m.net < 0
                              ? "rp-ev-delta minus"
                              : "rp-ev-delta"
                        }
                      >
                        {fmtDelta(m.net)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {matchOpen ? (
        <MatchBreakdown match={matchOpen} onClose={() => setMatchOpen(null)} />
      ) : null}
    </>
  );
}
