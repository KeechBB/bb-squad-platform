"use client";

import { useEffect, useState } from "react";
import type { RpPlayer, RpPlayerMatch } from "@/lib/trainRp";

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

type Props = {
  nick: string;
  open: boolean;
  onClose: () => void;
  /** Prefetched player (skip fetch). */
  player?: RpPlayer | null;
};

/** Maps list → match RP breakdown (same UI as train/public profile). */
export function RpPlayerDrilldown({ nick, open, onClose, player: prefetched }: Props) {
  const [player, setPlayer] = useState<RpPlayer | null>(prefetched ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchOpen, setMatchOpen] = useState<RpPlayerMatch | null>(null);

  useEffect(() => {
    if (!open) {
      setMatchOpen(null);
      return;
    }
    if (prefetched) {
      setPlayer(prefetched);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/public/rp-player?nick=${encodeURIComponent(nick)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        return r.json() as Promise<{ player: RpPlayer | null }>;
      })
      .then((j) => {
        if (cancelled) return;
        if (!j.player) throw new Error("Нет RP по этому нику");
        setPlayer(j.player);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setPlayer(null);
          setError(e.message || "Ошибка загрузки");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, nick, prefetched]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (matchOpen) setMatchOpen(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, matchOpen, onClose]);

  if (!open) return null;

  // Slim ladder stubs have numeric kills/deaths and no map/date/net — hide them.
  const matches = player?.matches
    ? [...player.matches]
        .filter(
          (m) =>
            typeof m.map === "string" &&
            m.map.length > 0 &&
            Array.isArray(m.kills) &&
            Array.isArray(m.deaths)
        )
        .reverse()
    : [];
  const rpShow = player?.rp != null ? Math.round(player.rp) : null;
  const slimOnly =
    !loading &&
    !error &&
    !!player?.matches?.length &&
    matches.length === 0;

  return (
    <>
      <div
        className="rp-breakdown-overlay"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !matchOpen) onClose();
        }}
      >
        <div className="rp-breakdown-panel rp-maps-panel">
          <header className="rp-breakdown-head">
            <div>
              <h3>PB1 RP · {player?.nick || nick}</h3>
              <p className="muted">
                {loading
                  ? "Загрузка…"
                  : error
                    ? error
                    : slimOnly
                      ? `${rpShow == null ? "—" : rpShow} · ${
                          player?.rankLabel || "—"
                        } · нет полного разбора (ledger)`
                      : `${rpShow == null ? "—" : rpShow} · ${
                          player?.rankLabel || "—"
                        } · клик по карте — разбор`}
              </p>
            </div>
            <button type="button" className="rp-breakdown-close" onClick={onClose}>
              ✕
            </button>
          </header>
          {!loading && !error && matches.length === 0 ? (
            <p className="muted">
              {slimOnly
                ? "Полный RP-ledger на сервере не найден — разбор по картам недоступен."
                : "Пока нет карт с RP паблика."}
            </p>
          ) : null}
          {!loading && !error && matches.length > 0 ? (
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
          ) : null}
        </div>
      </div>

      {matchOpen ? (
        <MatchBreakdown match={matchOpen} onClose={() => setMatchOpen(null)} />
      ) : null}
    </>
  );
}
