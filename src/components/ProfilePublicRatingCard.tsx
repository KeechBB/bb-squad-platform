import Link from "next/link";
import type { PlayerPublicCombatStats } from "@/lib/publicCombat";

type Props = {
  nick?: string | null;
  rp?: number | null;
  rankLabel?: string | null;
  rankKey?: string | null;
  combat?: PlayerPublicCombatStats | null;
};

/** Кнопка под аватаром → рейтинг паблика + краткие MVP. */
export function ProfilePublicRatingCard({
  nick,
  rp,
  rankLabel,
  rankKey,
  combat,
}: Props) {
  const href = nick
    ? `/public#player-${encodeURIComponent(nick)}`
    : "/public";
  const medals =
    (combat?.mvpDamage || 0) +
    (combat?.mvpKiller || 0) +
    (combat?.mvpMedic || 0);
  const hasAny =
    rp != null ||
    (combat &&
      (combat.matches > 0 ||
        combat.days > 0 ||
        medals > 0 ||
        combat.antiDeath > 0));

  return (
    <section className="card profile-pwr-card profile-public-rating-card">
      <div className="profile-kv-head">
        <h2>Рейтинг паблика</h2>
        <Link className="kv-link" href={href}>
          Открыть →
        </Link>
      </div>

      {hasAny ? (
        <>
          <div className="profile-pwr-hero">
            <span
              className={`home-pwr-badge rank-${rankKey || "iron"} profile-pwr-badge`}
              title={rankLabel || "PB1"}
            >
              {rankLabel || "PB1"}
            </span>
            <div className="profile-pwr-hero-nums">
              <strong>{rp != null ? Math.round(rp) : "—"}</strong>
              <span className="muted">RP</span>
            </div>
          </div>
          <div className="profile-kv-extra profile-pwr-meta profile-pwr-meta-2">
            <div>
              <span className="muted">Каток</span>
              <strong>{combat?.matches ?? 0}</strong>
            </div>
            <div>
              <span className="muted">MVP</span>
              <strong>{medals}</strong>
            </div>
            <div>
              <span className="muted">Дней PB1</span>
              <strong>{combat?.days ?? 0}</strong>
            </div>
          </div>
          <div className="profile-kv-awards">
            <span className="profile-kv-award">
              War <b>{combat?.mvpDamage ?? 0}</b>
            </span>
            <span className="profile-kv-award">
              Killer <b>{combat?.mvpKiller ?? 0}</b>
            </span>
            <span className="profile-kv-award">
              Medic <b>{combat?.mvpMedic ?? 0}</b>
            </span>
            <span className="profile-kv-award">
              Anti <b>{combat?.antiDeath ?? 0}</b>
            </span>
          </div>
        </>
      ) : (
        <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>
          PB1 · RP и MVP появятся после каток паблика (без SEED).
        </p>
      )}

      <p style={{ marginTop: 12 }}>
        <Link className="btn primary" href={href}>
          Рейтинг паблика
        </Link>
      </p>
    </section>
  );
}
