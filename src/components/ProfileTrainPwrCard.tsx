"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { HomeTrainPwrRow } from "@/lib/homeTrainPwr";
import type { RpPlayerMatch } from "@/lib/trainRp";

type Props = {
  stats: HomeTrainPwrRow | null;
};

function fmtDelta(n: number) {
  const v = Math.round(Number(n) || 0);
  return v > 0 ? `+${v}` : String(v);
}

function romanFromPwr(pwr: number) {
  // Hidden PWR weight → roman strip I/II/III inside old 100-bands
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
              NET {fmtDelta(match.net)} · give-up K {match.kills.length} / D{" "}
              {match.deaths.length}
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
              − lost ({match.deaths.length})
            </h4>
            <ul className="rp-breakdown-list">
              {match.deaths.map((e, i) => (
                <li key={`d-${i}`}>
                  <span className="rp-ev-time">{e.time}</span>
                  <span className="rp-ev-nick" title={e.killer}>
                    {e.killer}
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
            </ul>
            <p className="rp-breakdown-sum minus">
              Sum{" "}
              {fmtDelta(
                -match.deaths.reduce((s, e) => s + Math.abs(e.delta), 0)
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
                {fmtDelta(
                  match.revives!.reduce((s, e) => s + e.delta, 0)
                )}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProfileTrainPwrCard({ stats }: Props) {
  const [open, setOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState<RpPlayerMatch | null>(null);
  const matches = useMemo(
    () => (stats?.matches ? [...stats.matches].reverse() : []),
    [stats]
  );

  if (!stats) {
    return (
      <section className="card profile-pwr-card">
        <div className="profile-kv-head">
          <h2>Ранг тренировок</h2>
          <Link className="kv-link" href="/tm#/tm/rating">
            Рейтинг →
          </Link>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>
          Пока нет статы в тренировочных матчах — RP появится после каток с
          give-up киллами.
        </p>
      </section>
    );
  }

  const rpShow = Math.round(Number(stats.rp ?? stats.pwr) || 0);

  return (
    <>
      <section className="card profile-pwr-card">
        <div className="profile-kv-head">
          <h2>Ранг тренировок</h2>
          <Link className="kv-link" href="/tm#/tm/rating">
            Рейтинг →
          </Link>
        </div>

        <div className="profile-pwr-hero">
          <span
            className={`home-pwr-badge rank-${stats.rankKey} profile-pwr-badge`}
            title={stats.rankLabel}
          >
            {stats.rankLabel}
            {stats.predatorPlace != null ? (
              <span className="rank-predator-num">#{stats.predatorPlace}</span>
            ) : null}
          </span>
          <div className="profile-pwr-hero-nums">
            <strong>{rpShow}</strong>
            <span className="muted">RP</span>
          </div>
        </div>

        <div className="profile-kv-extra profile-pwr-meta profile-pwr-meta-2">
          <div>
            <span className="muted">Место</span>
            <strong>#{stats.place}</strong>
          </div>
          <div>
            <span className="muted">Каток</span>
            <strong>{stats.games}</strong>
          </div>
        </div>

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
                <h3>RP · {stats.nick}</h3>
                <p className="muted">
                  {rpShow} · {stats.rankLabel} · клик по карте — разбор
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
              <p className="muted">Пока нет карт с RP.</p>
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
