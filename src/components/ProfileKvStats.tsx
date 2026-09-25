import Link from "next/link";
import type { PlayerKvStats } from "@/lib/kvStats";

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
};

export function ProfileKvMatchHistory({
  stats,
}: {
  stats: PlayerKvStats | null;
}) {
  const rows = stats?.recentMatches || [];
  return (
    <section className="card profile-hist-card profile-kv-hist-card">
      <h2 className="profile-hist-title">История матчей КВ</h2>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Пока нет сыгранных КВ с этим ником.
        </p>
      ) : (
        <div className="admin-table-wrap profile-hist-table-wrap">
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
              {rows.map((m) => (
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
      )}
    </section>
  );
}

export function ProfileKvStats({
  stats,
  error,
  includeMatchHistory = true,
}: Props) {
  if (error) {
    return (
      <section className="card profile-kv-card">
        <div className="profile-kv-head">
          <h2>Статистика КВ</h2>
          <Link className="kv-link" href="/cw">
            Таблица КВ →
          </Link>
        </div>
        <p className="error" style={{ marginTop: 8 }}>
          {error}
        </p>
      </section>
    );
  }

  if (!stats || (stats.rounds === 0 && stats.awards.length === 0)) {
    return (
      <section className="card profile-kv-card">
        <div className="profile-kv-head">
          <h2>Статистика КВ</h2>
          <Link className="kv-link" href="/cw">
            Таблица КВ →
          </Link>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>
          Пока нет раундов с ником <strong>{stats?.nick || "—"}</strong> в
          таблице игроков КВ. Когда появятся скрины итогов — сюда подтянутся
          K/D, урон и награды.
        </p>
      </section>
    );
  }

  const awardTotal =
    stats.mvpDamage + stats.mvpKiller + stats.mvpMedic + stats.antiDeath;

  return (
    <section className="card profile-kv-card">
      <div className="profile-kv-head">
        <h2>Статистика КВ</h2>
        <Link className="kv-link" href="/cw">
          Таблица КВ →
        </Link>
      </div>

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

      {awardTotal > 0 ? (
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
      ) : null}

      {stats.byStack.length > 0 ? (
        <div className="profile-kv-stacks">
          {stats.byStack.map((s) => (
            <div key={s.name} className="stack-stat-pill">
              <strong>{s.name}</strong>
              <span>
                {s.rounds} р. · {s.kills}K / {s.deaths}D ·{" "}
                {s.dmg.toLocaleString("ru-RU")} dmg
              </span>
            </div>
          ))}
        </div>
      ) : null}

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
    </section>
  );
}
