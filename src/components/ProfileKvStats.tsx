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
};

export function ProfileKvStats({ stats, error }: Props) {
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
          <em className="stat-sub">ср. {stats.avgDmg} / раунд</em>
        </div>
      </div>

      <div className="profile-kv-extra">
        <div>
          <span className="muted">Ср. киллы</span>
          <strong>{stats.avgKills}</strong>
        </div>
        <div>
          <span className="muted">Revives</span>
          <strong>{stats.res}</strong>
        </div>
        <div>
          <span className="muted">Teamkills / NOK</span>
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

      {stats.awards.length > 0 ? (
        <div className="profile-kv-block">
          <h3 className="stats-h3">Награды</h3>
          <ul className="profile-kv-award-list">
            {stats.awards.map((a, i) => (
              <li key={`${a.matchId}-${a.round}-${a.type}-${i}`}>
                <span className="mono">
                  {String(a.day).padStart(2, "0")}
                </span>
                <span>
                  vs {a.opp} · {a.round.toUpperCase()}
                </span>
                <strong>{a.label}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="profile-kv-block">
        <h3 className="stats-h3">Раунды</h3>
        <div className="admin-table-wrap profile-kv-table-wrap">
          <table className="admin-table profile-kv-table">
            <thead>
              <tr>
                <th>День</th>
                <th>Соперник</th>
                <th>Карта</th>
                <th>Р</th>
                <th>K</th>
                <th>D</th>
                <th>DMG</th>
                <th>RES</th>
                <th>Итог</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent.map((r) => (
                <tr key={`${r.matchId}-${r.round}`}>
                  <td>{String(r.day).padStart(2, "0")}</td>
                  <td>{r.opp}</td>
                  <td title={r.map}>{r.map}</td>
                  <td className="mono">{r.round.toUpperCase()}</td>
                  <td>{r.kills}</td>
                  <td>{r.deaths}</td>
                  <td>{r.dmg}</td>
                  <td>{r.res}</td>
                  <td>
                    <span className={statusClass(r.status)}>
                      {statusLabel(r.status)}
                    </span>
                    <span className="muted" style={{ marginLeft: 6 }}>
                      {r.meeting}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
