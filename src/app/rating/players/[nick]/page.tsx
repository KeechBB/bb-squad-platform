import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getEnemyPlayer } from "@/lib/crossRating";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ nick: string }> };

export default async function EnemyPlayerPage({ params }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const { nick: raw } = await params;
  const nick = decodeURIComponent(raw || "").trim();
  if (!nick) notFound();

  const profile = await getEnemyPlayer(nick);
  if (!profile) notFound();

  return (
    <main className="cross-rating-page">
      <div className="cross-rating-shell">
        <header className="cross-rating-top">
          <div className="profile-head-row" style={{ gap: 14 }}>
            <div className="admin-user-avatar admin-user-avatar-empty">
              {profile.nick.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="eyebrow">игрок соперника</p>
              <h1>{profile.nick}</h1>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                [{profile.clanTag}] · не аккаунт сайта · ник как на табло
              </p>
            </div>
          </div>
          <Link className="kv-link" href="/rating">
            ← к рейтингу кланов
          </Link>
        </header>

        <section className="card cross-rating-panel profile-kv-card">
          <div className="profile-kv-summary">
            <div>
              <span className="muted">PWR</span>
              <strong>{profile.pwr}</strong>
              <em className="stat-sub">
                <span className={`pwr-pill pwr-${profile.rankKey}`}>
                  {profile.rankLabel}
                </span>
              </em>
            </div>
            <div>
              <span className="muted">Катки</span>
              <strong>{profile.games}</strong>
              <em className="stat-sub">
                W–L {profile.wins}–{profile.losses}
              </em>
            </div>
            <div>
              <span className="muted">K / D</span>
              <strong>
                {profile.kills}
                <em> / {profile.deaths}</em>
              </strong>
              <em className="stat-sub">KD {profile.kd}</em>
            </div>
            <div>
              <span className="muted">Урон</span>
              <strong>{profile.dmg.toLocaleString("ru-RU")}</strong>
              <em className="stat-sub">ср. {profile.avgDmg}</em>
            </div>
          </div>
          <div className="profile-kv-extra">
            <div>
              <span className="muted">Ср. киллы</span>
              <strong>{profile.avgKills}</strong>
            </div>
            <div>
              <span className="muted">Revives</span>
              <strong>{profile.res}</strong>
            </div>
            <div>
              <span className="muted">Ноки</span>
              <strong>{profile.nok}</strong>
            </div>
          </div>
        </section>

        <section className="card cross-rating-panel" style={{ marginTop: 12 }}>
          <h2 className="stats-h3">История vs BB</h2>
          <div className="admin-table-wrap cross-rating-table-wrap">
            <table className="admin-table cross-rating-table">
              <thead>
                <tr>
                  <th>День</th>
                  <th>Клан</th>
                  <th>Карта</th>
                  <th>RES</th>
                  <th>Ноки</th>
                  <th>K</th>
                  <th>D</th>
                  <th>DMG</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {profile.history.map((h) => (
                  <tr key={h.matchId}>
                    <td>{String(h.day).padStart(2, "0")}</td>
                    <td>{h.opp}</td>
                    <td title={h.map}>{h.map}</td>
                    <td>{h.res}</td>
                    <td>{h.nok}</td>
                    <td>{h.kills}</td>
                    <td>{h.deaths}</td>
                    <td>{h.dmg}</td>
                    <td>
                      <Link
                        className="kv-link"
                        href={`/rating/match/${encodeURIComponent(h.matchId)}`}
                      >
                        матч →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
