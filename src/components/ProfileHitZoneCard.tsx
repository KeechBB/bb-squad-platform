import type { HitZoneTotals } from "@/lib/hitZones";

type Props = {
  stats: HitZoneTotals | null;
};

export function ProfileHitZoneCard({ stats }: Props) {
  if (!stats || stats.total <= 0) {
    return (
      <section className="card profile-hitzone-card">
        <h2>Попадания (TR1)</h2>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
          Ждём мод BBHitZoneLogger на тренировочном сервере — тогда здесь появятся
          % голова / тело / конечности за 30 дней.
        </p>
      </section>
    );
  }

  return (
    <section className="card profile-hitzone-card">
      <h2>Попадания (TR1)</h2>
      <p className="muted" style={{ margin: "2px 0 8px", fontSize: "0.78rem" }}>
        За 30 дней на TR1 · {stats.total} попаданий
      </p>
      <div className="profile-hitzone-bars">
        <div className="profile-hitzone-row">
          <span>Голова</span>
          <div className="profile-hitzone-track">
            <i style={{ width: `${stats.pctHead}%` }} className="is-head" />
          </div>
          <strong>{stats.pctHead}%</strong>
        </div>
        <div className="profile-hitzone-row">
          <span>Тело</span>
          <div className="profile-hitzone-track">
            <i style={{ width: `${stats.pctTorso}%` }} className="is-torso" />
          </div>
          <strong>{stats.pctTorso}%</strong>
        </div>
        <div className="profile-hitzone-row">
          <span>Конечности</span>
          <div className="profile-hitzone-track">
            <i style={{ width: `${stats.pctLimb}%` }} className="is-limb" />
          </div>
          <strong>{stats.pctLimb}%</strong>
        </div>
      </div>
    </section>
  );
}
