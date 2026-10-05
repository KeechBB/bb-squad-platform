"use client";

import { useEffect, useState } from "react";
import type { RpPlayer, RpPlayerMatch } from "@/lib/trainRp";
import { RpHuntMatchBreakdown } from "@/components/RpHuntMatchBreakdown";

function fmtDelta(n: number) {
  const v = Math.round(Number(n) || 0);
  return v > 0 ? `+${v}` : String(v);
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
        <RpHuntMatchBreakdown
          match={matchOpen}
          onClose={() => setMatchOpen(null)}
        />
      ) : null}
    </>
  );
}
