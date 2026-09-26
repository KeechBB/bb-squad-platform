import Link from "next/link";
import type { HomeCwPwrRow } from "@/lib/homeCwPwr";

type Props = {
  stats: HomeCwPwrRow | null;
};

export function ProfileCwPwrCard({ stats }: Props) {
  if (!stats) {
    return (
      <section className="card profile-pwr-card profile-cw-pwr-card">
        <div className="profile-kv-head">
          <h2>Ранг КВ</h2>
          <Link className="kv-link" href="/cw#/cw/rating">
            Рейтинг →
          </Link>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>
          Пока нет статы в клановых войнах — PWR появится после каток с табло.
        </p>
      </section>
    );
  }

  return (
    <section className="card profile-pwr-card profile-cw-pwr-card">
      <div className="profile-kv-head">
        <h2>Ранг КВ</h2>
        <Link className="kv-link" href="/cw#/cw/rating">
          Рейтинг →
        </Link>
      </div>

      <div className="profile-pwr-hero">
        <span
          className={`home-pwr-badge rank-${stats.rankKey} profile-pwr-badge`}
          title={stats.rankLabel}
        >
          {stats.rankLabel}
        </span>
        <div className="profile-pwr-hero-nums">
          <strong>{stats.pwr}</strong>
          <span className="muted">PWR</span>
        </div>
      </div>

      <div className="profile-kv-extra profile-pwr-meta">
        <div>
          <span className="muted">Место</span>
          <strong>#{stats.place}</strong>
        </div>
        <div>
          <span className="muted">Каток</span>
          <strong>{stats.games}</strong>
        </div>
        <div>
          <span className="muted">Ник в рейтинге</span>
          <strong>{stats.nick}</strong>
        </div>
      </div>
    </section>
  );
}
