"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { PlayerKvStats } from "@/lib/kvStats";
import type { CwMatchHistoryRow } from "@/lib/homeCwPwr";
import {
  ProfileMatchStatsModal,
  type MatchStatsOpen,
} from "@/components/ProfileMatchStatsModal";

function statusLabel(s: string) {
  if (s === "win") return "W";
  if (s === "draw") return "D";
  if (s === "lose") return "L";
  return s || "—";
}

function statusClass(s: string) {
  if (s === "win") return "kv-pill win";
  if (s === "draw") return "kv-pill draw";
  if (s === "lose") return "kv-pill lose";
  return "kv-pill";
}

type Props = {
  stats: PlayerKvStats | null;
  error?: string | null;
  /** false — только сводка; историю выносим в отдельный блок профиля */
  includeMatchHistory?: boolean;
  /** true — без внешней карточки и заголовка (внутри ProfileStatsTabs) */
  hideOuterCard?: boolean;
};

export function ProfileKvMatchHistory({
  matchHistory = [],
  highlightNick,
}: {
  matchHistory?: CwMatchHistoryRow[];
  highlightNick?: string;
}) {
  const [open, setOpen] = useState<MatchStatsOpen | null>(null);

  return (
    <section className="card profile-hist-card profile-kv-hist-card">
      <h2 className="profile-hist-title">История матчей КВ</h2>
      {matchHistory.length === 0 ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Пока нет КВ с ником в рейтинге — история появится после оцифровки
          табло.
        </p>
      ) : (
        <div className="admin-table-wrap profile-hist-table-wrap">
          <table className="admin-table training-sessions-table training-match-hist-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Соперник</th>
                <th>Карта</th>
                <th>Счёт</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {matchHistory.map((m) => {
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
                const canOpen = Boolean(m.playersUrl);
                return (
                  <tr
                    key={m.matchId}
                    className={canOpen ? "profile-hist-row-click" : undefined}
                    tabIndex={canOpen ? 0 : undefined}
                    onClick={() => {
                      if (!canOpen) return;
                      const statusRu =
                        m.status === "win"
                          ? "победа"
                          : m.status === "lose"
                            ? "поражение"
                            : m.status || "";
                      setOpen({
                        kind: "cw",
                        matchId: m.matchId,
                        title: `${m.dateLabel} vs ${m.opp}`,
                        sub: [
                          m.map,
                          m.size,
                          m.stack,
                          m.meeting && m.meeting !== "—"
                            ? `счёт ${m.meeting}`
                            : null,
                          statusRu,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                        playersUrl: m.playersUrl,
                        meeting: m.meeting,
                        r1Label:
                          m.r1 && m.r1 !== "—"
                            ? `Раунд 1 · ${m.r1}`
                            : "Раунд 1",
                        r2Label:
                          m.r2 && m.r2 !== "—"
                            ? `Раунд 2 · ${m.r2}`
                            : "Раунд 2",
                        r1Tickets: m.r1,
                        r2Tickets: m.r2,
                        highlightNick,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (!canOpen) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLTableRowElement).click();
                      }
                    }}
                  >
                    <td>{m.dateLabel}</td>
                    <td title={[m.opp, m.map, m.stack !== "—" ? m.stack : ""]
                      .filter(Boolean)
                      .join(" · ")}>
                      <span className="training-match-map">{m.opp}</span>
                    </td>
                    <td title={m.map}>
                      <span className="training-match-map">{m.map}</span>
                    </td>
                    <td className="training-match-score" title={m.meeting}>
                      {m.meeting}
                    </td>
                    <td>
                      <span className={resultCls}>{resultText}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ProfileMatchStatsModal open={open} onClose={() => setOpen(null)} />
    </section>
  );
}

export function ProfileKvStats({
  stats,
  error,
  includeMatchHistory = true,
  hideOuterCard = false,
}: Props) {
  const head = hideOuterCard ? null : (
    <div className="profile-kv-head">
      <h2>Статистика КВ</h2>
      <Link className="kv-link" href="/cw">
        Таблица КВ →
      </Link>
    </div>
  );

  const wrap = (body: ReactNode) =>
    hideOuterCard ? (
      <>{body}</>
    ) : (
      <section className="card profile-kv-card">{body}</section>
    );

  if (error) {
    return wrap(
      <>
        {head}
        <p className="error" style={{ marginTop: 8 }}>
          {error}
        </p>
      </>
    );
  }

  if (!stats || (stats.rounds === 0 && stats.awards.length === 0)) {
    return wrap(
      <>
        {head}
        <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>
          Пока нет раундов с ником <strong>{stats?.nick || "—"}</strong> в
          таблице игроков КВ. Когда появятся скрины итогов — сюда подтянутся
          K/D, урон и награды.
        </p>
      </>
    );
  }

  const awardTotal =
    stats.mvpDamage + stats.mvpKiller + stats.mvpMedic + stats.antiDeath;

  return wrap(
    <>
      {head}

      <div className="profile-kv-summary">
        <div>
          <span className="muted">Матчи / раунды</span>
          <strong>
            {stats.matches}
            <em> / {stats.rounds}</em>
          </strong>
        </div>
        <div>
          <span className="muted">W–D–L</span>
          <strong>
            {stats.wins}–{stats.draws}–{stats.losses}
          </strong>
          <em className="stat-sub">winrate {stats.winrate}%</em>
        </div>
        <div>
          <span className="muted">K / D</span>
          <strong>
            {stats.kills}
            <em> / {stats.deaths}</em>
          </strong>
          <em className="stat-sub">KD {stats.kd}</em>
        </div>
        <div>
          <span className="muted">Урон</span>
          <strong>{stats.dmg.toLocaleString("ru-RU")}</strong>
          <em className="stat-sub">ср. {stats.avgDmg} / игра</em>
        </div>
      </div>

      <div className="profile-kv-extra">
        <div>
          <span className="muted">Ср. киллы / игра</span>
          <strong>{stats.avgKills}</strong>
        </div>
        <div>
          <span className="muted">Revives</span>
          <strong>{stats.res}</strong>
        </div>
        <div>
          <span className="muted">Ноки</span>
          <strong>{stats.nok}</strong>
        </div>
        <div>
          <span className="muted">Награды MVP</span>
          <strong>{awardTotal}</strong>
        </div>
      </div>

      <div className="profile-kv-awards">
        <span className="profile-kv-award">
          War-Score <b>{stats.mvpDamage}</b>
        </span>
        <span className="profile-kv-award">
          Killer <b>{stats.mvpKiller}</b>
        </span>
        <span className="profile-kv-award">
          Medic <b>{stats.mvpMedic}</b>
        </span>
        <span className="profile-kv-award">
          Anti-Death <b>{stats.antiDeath}</b>
        </span>
      </div>

      {includeMatchHistory ? (
        <div className="profile-kv-block">
          <h3 className="stats-h3">История матчей КВ</h3>
          <div className="admin-table-wrap profile-kv-table-wrap">
            <table className="admin-table profile-kv-table">
              <thead>
                <tr>
                  <th>День</th>
                  <th>Соперник</th>
                  <th>Карта</th>
                  <th>RES</th>
                  <th>Ноки</th>
                  <th>K</th>
                  <th>D</th>
                  <th>DMG</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {(stats.recentMatches || []).map((m) => (
                  <tr key={m.matchId}>
                    <td>{String(m.day).padStart(2, "0")}</td>
                    <td>{m.opp}</td>
                    <td title={m.map}>{m.map}</td>
                    <td>{m.res}</td>
                    <td>{m.nok}</td>
                    <td>{m.kills}</td>
                    <td>{m.deaths}</td>
                    <td>{m.dmg}</td>
                    <td>
                      <span className={statusClass(m.status)}>
                        {statusLabel(m.status)}
                      </span>
                      <span className="muted" style={{ marginLeft: 6 }}>
                        {m.meeting}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
