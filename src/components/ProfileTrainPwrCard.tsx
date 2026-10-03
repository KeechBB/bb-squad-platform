"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { HomeTrainPwrRow } from "@/lib/homeTrainPwr";
import type { RpPlayer, RpPlayerMatch } from "@/lib/trainRp";
import { ProfileCompareCard } from "@/components/ProfileCompareCard";

type Props = {
  stats: HomeTrainPwrRow | null;
  compareNick?: string | null;
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

function normalizeMatch(m: RpPlayerMatch): RpPlayerMatch {
  return {
    ...m,
    kills: Array.isArray(m.kills) ? m.kills : [],
    deaths: Array.isArray(m.deaths) ? m.deaths : [],
    teamkills: Array.isArray(m.teamkills) ? m.teamkills : [],
    revives: Array.isArray(m.revives) ? m.revives : [],
  };
}

function MatchBreakdown({
  match,
  onClose,
}: {
  match: RpPlayerMatch;
  onClose: () => void;
}) {
  const m = normalizeMatch(match);
  const dateShort = m.date?.slice(5)?.replace("-", ".") || m.date;
  const body = (
    <div
      className="rp-breakdown-overlay rp-breakdown-overlay-detail"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rp-breakdown-panel">
        <header className="rp-breakdown-head">
          <div>
            <h3>
              {m.map} · {dateShort}
            </h3>
            <p className="muted">
              NET {fmtDelta(m.net)} · K {m.kills.length} / D {m.deaths.length}
              {(m.teamkills?.length || 0) > 0 ? ` · TK ${m.teamkills!.length}` : ""}
              {(m.revives?.length || 0) > 0 ? ` · R ${m.revives!.length}` : ""}
            </p>
          </div>
          <button type="button" className="rp-breakdown-close" onClick={onClose}>
            ✕
          </button>
        </header>
        {m.kills.length + m.deaths.length + (m.teamkills?.length || 0) === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Нет событий Die/revive в ledger по этой карте — ±RP есть, разбор
            киллов пустой.
          </p>
        ) : null}
        <div
          className={`rp-breakdown-cols${
            (m.revives?.length || 0) > 0 ? " has-revives" : ""
          }`}
        >
          <section>
            <h4 className="rp-breakdown-col-title gain">
              + gained ({m.kills.length})
            </h4>
            <ul className="rp-breakdown-list">
              {m.kills.map((e, i) => (
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
              Sum {fmtDelta(m.kills.reduce((s, e) => s + e.delta, 0))}
            </p>
          </section>
          <section>
            <h4 className="rp-breakdown-col-title loss">
              − lost ({m.deaths.length + (m.teamkills?.length || 0)})
            </h4>
            <ul className="rp-breakdown-list">
              {m.deaths.map((e, i) => (
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
              {(m.teamkills || []).map((e, i) => (
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
                  m.deaths.reduce((s, e) => s + Math.abs(e.delta), 0) +
                  (m.teamkills || []).reduce((s, e) => s + Math.abs(e.delta), 0)
                )
              )}
            </p>
          </section>
          {(m.revives?.length || 0) > 0 ? (
            <section>
              <h4 className="rp-breakdown-col-title gain">
                + поднял ({m.revives!.length})
              </h4>
              <ul className="rp-breakdown-list">
                {m.revives!.map((e, i) => (
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
                Sum {fmtDelta(m.revives!.reduce((s, e) => s + e.delta, 0))}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
  if (typeof document === "undefined") return body;
  return createPortal(body, document.body);
}

export function ProfileTrainPwrCard({ stats, compareNick }: Props) {
  const [open, setOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState<RpPlayerMatch | null>(null);
  const [fullPlayer, setFullPlayer] = useState<RpPlayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setMatchOpen(null);
      return;
    }
    const nick = stats?.nick || compareNick || "";
    if (!nick) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/train/rp-player?nick=${encodeURIComponent(nick)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(
            (await r.json().catch(() => ({}))).error || r.statusText
          );
        }
        return r.json() as Promise<{ player: RpPlayer | null }>;
      })
      .then((j) => {
        if (cancelled) return;
        if (!j.player) throw new Error("Нет RP по этому нику");
        setFullPlayer(j.player);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setFullPlayer(null);
          setError(e.message || "Ошибка загрузки");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, stats?.nick, compareNick]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (matchOpen) setMatchOpen(null);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, matchOpen]);

  const matches = useMemo(() => {
    const src = fullPlayer?.matches?.length
      ? fullPlayer.matches
      : stats?.matches || [];
    return [...src].map(normalizeMatch).reverse();
  }, [fullPlayer, stats]);

  const compare =
    compareNick ? (
      <ProfileCompareCard myNick={compareNick} variant="stack" />
    ) : null;

  if (!stats) {
    return (
      <section className="card profile-pwr-card">
        <div className="profile-kv-head">
          <h2>Ранг тренировок</h2>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>
          Пока нет статы в тренировочных матчах — RP появится после каток с
          give-up киллами.
        </p>
        {compare}
      </section>
    );
  }

  const rpShow = Math.round(Number(stats.rp ?? stats.pwr) || 0);

  const mapsModal =
    open && mounted ? (
      <div
        className="rp-breakdown-overlay"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !matchOpen) setOpen(false);
        }}
      >
        <div className="rp-breakdown-panel rp-maps-panel">
          <header className="rp-breakdown-head">
            <div>
              <h3>RP · {stats.nick}</h3>
              <p className="muted">
                {loading
                  ? `${rpShow} · ${stats.rankLabel} · загрузка разбора…`
                  : error
                    ? `${rpShow} · ${stats.rankLabel} · ${error}`
                    : `${rpShow} · ${stats.rankLabel} · клик по карте — разбор`}
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
    ) : null;

  return (
    <>
      <section className="card profile-pwr-card">
        <div className="profile-kv-head">
          <h2>Ранг тренировок</h2>
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
        {compare}
      </section>

      {mapsModal && createPortal(mapsModal, document.body)}

      {matchOpen ? (
        <MatchBreakdown match={matchOpen} onClose={() => setMatchOpen(null)} />
      ) : null}
    </>
  );
}
