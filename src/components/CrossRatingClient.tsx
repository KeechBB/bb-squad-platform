"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ClanEloBoard, EnemyPwrBoard } from "@/lib/crossRating";

type Tab = "clans" | "players";

type Props = {
  clans: ClanEloBoard;
  enemies: EnemyPwrBoard;
};

const PWR_BANDS: [number, string, string][] = [
  [0, "Iron", "iron"],
  [100, "Bronze", "bronze"],
  [200, "Silver", "silver"],
  [300, "Gold", "gold"],
  [400, "Platinum", "platinum"],
  [500, "Diamond", "diamond"],
  [600, "Legend", "legend"],
  [700, "Immortal", "immortal"],
  [800, "Master", "master"],
  [900, "Radiant", "radiant"],
];

function PwrScale() {
  return (
    <div className="cross-pwr-scale" aria-label="PWR ranks">
      <span className="cross-pwr-scale-label">
        PWR
        <br />
        ranks
      </span>
      <div className="cross-pwr-scale-track">
        {PWR_BANDS.map(([min, label, key], i) => {
          const max = i < PWR_BANDS.length - 1 ? PWR_BANDS[i + 1][0] - 1 : 1000;
          return (
            <span key={key} className="cross-pwr-scale-step">
              <span className="cross-pwr-scale-range">
                {min}–{max}
              </span>
              <span className={`pwr-pill pwr-${key}`}>{label}</span>
              {i < PWR_BANDS.length - 1 ? (
                <span className="cross-pwr-scale-arrow" aria-hidden>
                  →
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function CrossRatingClient({ clans, enemies }: Props) {
  const [tab, setTab] = useState<Tab>("clans");
  const [nickQ, setNickQ] = useState("");

  const enemyRows = useMemo(() => {
    const q = nickQ.trim().toLowerCase();
    if (!q) return enemies.rows;
    return enemies.rows.filter((r) => r.nick.toLowerCase().includes(q));
  }, [enemies.rows, nickQ]);

  return (
    <div className="cross-rating-shell">
      <header className="cross-rating-top">
        <div>
          <p className="eyebrow">межклановый рейтинг</p>
          <h1>Рейтинг кланов</h1>
          <p className="muted cross-rating-lead">
            Elo команд по КВ · {clans.meetings} встреч · BB Elo {clans.bbElo}
          </p>
        </div>
        <div
          className="profile-stats-tablist cross-rating-tabs"
          role="tablist"
          aria-label="Рейтинг кланов"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "clans"}
            className={`profile-stats-tab${tab === "clans" ? " active" : ""}`}
            onClick={() => setTab("clans")}
          >
            Рейтинг кланов
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
      </header>

      {tab === "clans" ? (
        <section className="card cross-rating-panel" role="tabpanel">
          <p className="muted cross-rating-note">
            Elo старт 1000, K=25. Без победы BB — выше нас, без цифры
            (калибровка). Кликни клан — история встреч. Main+Junior = один BB.
          </p>
          <div className="admin-table-wrap cross-rating-table-wrap">
            <table className="admin-table cross-rating-table cross-clans-table">
              <thead>
                <tr>
                  <th className="ctr">#</th>
                  <th>Лого</th>
                  <th>Тег</th>
                  <th>Название</th>
                  <th className="ctr">Elo</th>
                  <th className="ctr">Встречи</th>
                  <th className="ctr">W–L</th>
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
                    <td className="ctr">{r.place}</td>
                    <td>
                      <Link
                        className="cross-clan-link"
                        href={`/rating/clan/${encodeURIComponent(r.key)}`}
                      >
                        {r.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="cross-clan-logo"
                            src={r.logoUrl}
                            alt=""
                            width={40}
                            height={40}
                          />
                        ) : (
                          <span className="cross-clan-logo-fallback">
                            {r.tag.slice(0, 2)}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td>
                      <Link
                        className="cross-clan-link"
                        href={`/rating/clan/${encodeURIComponent(r.key)}`}
                      >
                        <strong>[{r.tag}]</strong>
                        {!r.calibrated && !r.isBb ? (
                          <em className="cross-rating-badge">калибровка</em>
                        ) : null}
                      </Link>
                    </td>
                    <td>
                      <Link
                        className="cross-clan-link"
                        href={`/rating/clan/${encodeURIComponent(r.key)}`}
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="ctr">
                      {r.elo == null ? (
                        <span className="muted">—</span>
                      ) : (
                        <strong>{r.elo}</strong>
                      )}
                    </td>
                    <td className="ctr">{r.meetings}</td>
                    <td className="ctr">
                      {r.wins}–{r.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="card cross-rating-panel" role="tabpanel">
          <PwrScale />
          <div className="cross-rating-player-filters">
            <label className="cross-filter">
              <span>Ник</span>
              <input
                type="search"
                value={nickQ}
                onChange={(e) => setNickQ(e.target.value)}
                placeholder="поиск…"
              />
            </label>
            <p className="muted" style={{ margin: 0, lineHeight: 1.4 }}>
              Только соперники (без BB). Пока нет `oppR1`/`oppR2` — таблица
              пустая.
            </p>
          </div>
          <div className="admin-table-wrap cross-rating-table-wrap">
            <table className="admin-table cross-rating-table rating-like-cw">
              <thead>
                <tr>
                  <th className="ctr">Место</th>
                  <th className="ctr">Rank</th>
                  <th className="ctr">PWR</th>
                  <th>Ник</th>
                  <th className="ctr">Клан</th>
                  <th className="ctr">Каток</th>
                  <th className="ctr">% побед</th>
                  <th className="ctr">Ресы</th>
                  <th className="ctr">Ноки</th>
                  <th className="ctr">Килы</th>
                  <th className="ctr">Смерти</th>
                  <th className="ctr">KD</th>
                  <th className="ctr">Боевой счёт</th>
                  <th className="ctr">MVP Medic</th>
                  <th className="ctr">MVP Killer</th>
                  <th className="ctr">MVP War-Score</th>
                  <th className="ctr">Anti-MVP</th>
                </tr>
              </thead>
              <tbody>
                {enemyRows.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="empty-row muted">
                      Нет игроков — залей скрины табло соперника в матчи КВ.
                    </td>
                  </tr>
                ) : (
                  enemyRows.map((r) => (
                    <tr key={r.nick}>
                      <td className="ctr">{r.place}</td>
                      <td className="ctr">
                        <span className={`pwr-pill pwr-${r.rankKey}`}>
                          {r.rankLabel}
                        </span>
                      </td>
                      <td className="ctr">
                        <strong>{r.pwr}</strong>
                      </td>
                      <td>
                        <Link
                          href={`/rating/players/${encodeURIComponent(r.nick)}`}
                        >
                          {r.nick}
                        </Link>
                      </td>
                      <td className="ctr">[{r.clanTag}]</td>
                      <td className="ctr">{r.games}</td>
                      <td className="ctr">
                        {r.winPct != null ? `${r.winPct}%` : "—"}
                      </td>
                      <td className="ctr">{r.res}</td>
                      <td className="ctr">{r.nok}</td>
                      <td className="ctr">{r.kills}</td>
                      <td className="ctr">{r.deaths}</td>
                      <td className="ctr">{r.kd}</td>
                      <td className="ctr">{r.dmg}</td>
                      <td className="ctr">{r.mvpMedic}</td>
                      <td className="ctr">{r.mvpKiller}</td>
                      <td className="ctr">{r.mvpDamage}</td>
                      <td className="ctr">{r.antiDeath}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
