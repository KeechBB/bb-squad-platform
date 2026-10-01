"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  ClanEloBoard,
  EnemyPwrBoard,
  MeetingListItem,
} from "@/lib/crossRating";

type Tab = "clans" | "players";

type Props = {
  clans: ClanEloBoard;
  enemies: EnemyPwrBoard;
  meetings: MeetingListItem[];
};

export function CrossRatingClient({ clans, enemies, meetings }: Props) {
  const [tab, setTab] = useState<Tab>("clans");

  return (
    <section className="card cross-rating-card">
      <div className="profile-kv-head profile-stats-tabs-head">
        <div
          className="profile-stats-tablist"
          role="tablist"
          aria-label="Межклановый рейтинг"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "clans"}
            className={`profile-stats-tab${tab === "clans" ? " active" : ""}`}
            onClick={() => setTab("clans")}
          >
            Рейтинг команд
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "players"}
            className={`profile-stats-tab${tab === "players" ? " active" : ""}`}
            onClick={() => setTab("players")}
          >
            Рейтинг игроков
          </button>
        </div>
        <Link className="kv-link" href="/cw">
          Календарь КВ →
        </Link>
      </div>

      {tab === "clans" ? (
        <div className="profile-stats-tabpanel" role="tabpanel">
          <p className="muted cross-rating-note">
            Elo старт 1000, K=25. Кланы без победы BB — выше нас, без цифры
            (калибровка). Main+Junior = один BB.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table cross-rating-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Клан</th>
                  <th>Elo</th>
                  <th>Встречи</th>
                  <th>W–L</th>
                </tr>
              </thead>
              <tbody>
                {clans.rows.map((r) => (
                  <tr
                    key={r.key}
                    className={
                      r.isBb
                        ? "cross-rating-bb"
                        : !r.calibrated
                          ? "cross-rating-calib"
                          : undefined
                    }
                  >
                    <td>{r.place}</td>
                    <td>
                      <strong>[{r.tag}]</strong>{" "}
                      <span className="muted">{r.name}</span>
                      {!r.calibrated && !r.isBb ? (
                        <em className="cross-rating-badge">калибровка</em>
                      ) : null}
                    </td>
                    <td>
                      {r.elo == null ? (
                        <span className="muted">—</span>
                      ) : (
                        r.elo
                      )}
                    </td>
                    <td>{r.meetings}</td>
                    <td>
                      {r.wins}–{r.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="stats-h3" style={{ marginTop: 20 }}>
            Встречи
          </h3>
          <div className="admin-table-wrap">
            <table className="admin-table cross-rating-table">
              <thead>
                <tr>
                  <th>День</th>
                  <th>Соперник</th>
                  <th>Стек</th>
                  <th>Карта</th>
                  <th>Счёт</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.matchId}>
                    <td>
                      {String(m.day).padStart(2, "0")}.
                      {m.month.slice(5) || "??"}
                    </td>
                    <td>
                      <strong>[{m.oppTag}]</strong>
                    </td>
                    <td>{m.stack}</td>
                    <td title={m.map}>{m.map}</td>
                    <td>
                      {m.meeting || (m.bbWon ? "win" : "lose")}
                      <em className="stat-sub">
                        {" "}
                        {m.r1}
                        {m.r2 ? ` · ${m.r2}` : ""}
                      </em>
                    </td>
                    <td>
                      <Link
                        className="kv-link"
                        href={`/rating/match/${encodeURIComponent(m.matchId)}`}
                      >
                        подробно →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="profile-stats-tabpanel" role="tabpanel">
          <p className="muted cross-rating-note">
            Только враги со скринов (`oppR1` / `oppR2`). Наших сюда не кладём.
            PWR — та же шкала, что у КВ.
          </p>
          {enemies.players === 0 ? (
            <p className="muted" style={{ marginTop: 12, lineHeight: 1.45 }}>
              Пока нет статы соперников. Залей скрины табло врагов — появятся
              карточки и PWR. Матчей с opp-стороной:{" "}
              <strong>{enemies.matchesWithOpp}</strong>.
            </p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table cross-rating-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Ник</th>
                    <th>Клан</th>
                    <th>PWR</th>
                    <th>Ранг</th>
                    <th>K/D</th>
                    <th>Катки</th>
                  </tr>
                </thead>
                <tbody>
                  {enemies.rows.map((r) => (
                    <tr key={r.nick}>
                      <td>{r.place}</td>
                      <td>
                        <Link
                          href={`/rating/players/${encodeURIComponent(r.nick)}`}
                        >
                          {r.nick}
                        </Link>
                      </td>
                      <td>[{r.clanTag}]</td>
                      <td>
                        <strong>{r.pwr}</strong>
                      </td>
                      <td>
                        <span className={`pwr-pill pwr-${r.rankKey}`}>
                          {r.rankLabel}
                        </span>
                      </td>
                      <td>
                        {r.kills}/{r.deaths}{" "}
                        <em className="stat-sub">({r.kd})</em>
                      </td>
                      <td>{r.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
