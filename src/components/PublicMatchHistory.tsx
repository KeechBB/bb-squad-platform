"use client";

import { useState } from "react";
import type { TrainMatchHistoryRow } from "@/lib/homeTrainPwr";
import type { RpPlayer, RpPlayerMatch } from "@/lib/trainRp";
import { abbreviateFaction } from "@/lib/factionAbbrev";
import { RpHuntMatchBreakdown } from "@/components/RpHuntMatchBreakdown";

type Props = {
  matchHistory?: TrainMatchHistoryRow[];
  highlightNick?: string;
  hideTitle?: boolean;
};

export function PublicMatchHistory({
  matchHistory = [],
  highlightNick,
  hideTitle = false,
}: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerCache, setPlayerCache] = useState<RpPlayer | null>(null);
  const [openMatch, setOpenMatch] = useState<RpPlayerMatch | null>(null);

  async function openRow(matchId: string) {
    const nick = (highlightNick || "").trim();
    if (!nick || !matchId) return;
    setError(null);
    setLoadingId(matchId);
    try {
      let player = playerCache;
      if (!player) {
        const r = await fetch(
          `/api/public/rp-player?nick=${encodeURIComponent(nick)}`,
          { cache: "no-store" }
        );
        if (!r.ok) {
          throw new Error(
            (await r.json().catch(() => ({}))).error || r.statusText
          );
        }
        const j = (await r.json()) as { player: RpPlayer | null };
        if (!j.player) throw new Error("Нет RP по этому нику");
        player = j.player;
        setPlayerCache(player);
      }
      const hit = (player.matches || []).find((m) => m.id === matchId);
      if (!hit || !Array.isArray(hit.kills)) {
        throw new Error("Нет детального разбора по этой катке");
      }
      setOpenMatch(hit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="card profile-hist-card profile-train-hist-card profile-public-hist-card">
      {hideTitle ? null : (
        <h2 className="profile-hist-title">История матчей паблика</h2>
      )}
      {error ? (
        <p className="muted" style={{ margin: "6px 0 0", color: "#f87171" }}>
          {error}
        </p>
      ) : null}
      {matchHistory.length === 0 ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Пока нет каток паблика (PB1) с этим ником в рейтинге — история
          появится после матчей с give-up киллами.
        </p>
      ) : (
        <div className="admin-table-wrap profile-hist-table-wrap">
          <table className="admin-table training-sessions-table training-match-hist-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Карта</th>
                <th>Счёт</th>
                <th className="num">Δ RP</th>
                <th>Результат</th>
                <th className="num">RP</th>
              </tr>
            </thead>
            <tbody>
              {matchHistory.map((m) => {
                const delta = m.rpDelta;
                const deltaCls =
                  delta == null
                    ? "pwr-delta zero"
                    : delta > 0
                      ? "pwr-delta plus"
                      : delta < 0
                        ? "pwr-delta minus"
                        : "pwr-delta zero";
                const deltaText =
                  delta == null
                    ? "—"
                    : delta > 0
                      ? `+${delta}`
                      : String(delta);
                const hasScore =
                  m.ticketsA != null &&
                  m.ticketsB != null &&
                  m.factionA !== "—" &&
                  m.factionB !== "—";
                const score = hasScore
                  ? `${abbreviateFaction(m.factionA)} ${m.ticketsA} : ${m.ticketsB} ${abbreviateFaction(m.factionB)}`
                  : "—";
                const resultCls =
                  m.won === true
                    ? "kv-pill win"
                    : m.won === false
                      ? "kv-pill lose"
                      : "kv-pill";
                const resultText =
                  m.won === true
                    ? "Победа"
                    : m.won === false
                      ? "Поражение"
                      : "—";
                const rpAfter = m.rpAfter;
                const busy = loadingId === m.matchId;
                return (
                  <tr
                    key={m.matchId}
                    className="profile-hist-row-click"
                    tabIndex={0}
                    onClick={() => openRow(m.matchId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openRow(m.matchId);
                      }
                    }}
                  >
                    <td>{m.dateLabel}</td>
                    <td title={m.map}>
                      <span className="training-match-map">{m.map}</span>
                    </td>
                    <td className="training-match-score" title={score}>
                      {score}
                    </td>
                    <td className={`num ${deltaCls}`}>
                      {busy ? "…" : deltaText}
                    </td>
                    <td>
                      <span className={resultCls}>{resultText}</span>
                    </td>
                    <td
                      className="num"
                      title={
                        rpAfter != null
                          ? `${m.rankLabel} · ${rpAfter}`
                          : "RP ещё не считался"
                      }
                    >
                      {rpAfter != null ? (
                        <span className="profile-hist-pwr">
                          <span
                            className={`home-pwr-badge rank-${m.rankKey}`}
                          >
                            {m.rankLabel}
                          </span>
                          <span className="profile-hist-pwr-n">{rpAfter}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {openMatch ? (
        <RpHuntMatchBreakdown
          match={openMatch}
          onClose={() => setOpenMatch(null)}
        />
      ) : null}
    </section>
  );
}
