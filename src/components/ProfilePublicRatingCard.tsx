"use client";

import { useState } from "react";
import type { PlayerPublicCombatStats } from "@/lib/publicCombat";
import { RpPlayerDrilldown } from "@/components/RpPlayerDrilldown";

type Props = {
  nick?: string | null;
  rp?: number | null;
  rankLabel?: string | null;
  rankKey?: string | null;
  combat?: PlayerPublicCombatStats | null;
  /** @deprecated slim ladder stubs — drilldown loads full ledger via API */
  matches?: unknown;
};

/** Карточка паблика + детальный разбор RP по матчам (полный ledger через API). */
export function ProfilePublicRatingCard({
  nick,
  rp,
  rankLabel,
  rankKey,
  combat,
}: Props) {
  const [open, setOpen] = useState(false);
  const medals =
    (combat?.mvpDamage || 0) +
    (combat?.mvpKiller || 0) +
    (combat?.mvpMedic || 0);
  const hasAny =
    rp != null ||
    (combat &&
      (combat.matches > 0 ||
        combat.days > 0 ||
        combat.kills > 0 ||
        combat.deaths > 0 ||
        medals > 0 ||
        combat.antiDeath > 0));
  const winPct =
    combat?.winrate != null ? Math.round(combat.winrate) : null;
  const kd =
    combat?.kd != null
      ? Number(combat.kd).toLocaleString("ru-RU", {
          maximumFractionDigits: 2,
        })
      : "—";
  const rpShow = rp != null ? Math.round(rp) : null;
  const rankShow = rankLabel || "PB1";

  return (
    <>
      <section className="card profile-pwr-card profile-public-rating-card">
        <div className="profile-kv-head">
          <h2>Рейтинг паблика</h2>
        </div>

        {hasAny ? (
          <>
            <div className="profile-pwr-hero">
              <span
                className={`home-pwr-badge rank-${rankKey || "iron"} profile-pwr-badge`}
                title={rankShow}
              >
                {rankShow}
              </span>
              <div className="profile-pwr-hero-nums">
                <strong>{rpShow == null ? "—" : rpShow}</strong>
                <span className="muted">RP</span>
              </div>
            </div>
            <div className="profile-kv-extra profile-pwr-meta profile-pwr-meta-2">
              <div>
                <span className="muted">Убийства</span>
                <strong>{combat?.kills ?? 0}</strong>
              </div>
              <div>
                <span className="muted">Смерти</span>
                <strong>{combat?.deaths ?? 0}</strong>
              </div>
              <div>
                <span className="muted">KD</span>
                <strong>{kd}</strong>
              </div>
              <div>
                <span className="muted">% побед</span>
                <strong>{winPct == null ? "—" : `${winPct}%`}</strong>
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
            PB1 · RP и стата появятся после каток паблика (без SEED).
          </p>
        )}

        <button
          type="button"
          className="profile-rp-detail-btn"
          onClick={() => setOpen(true)}
          disabled={!nick}
        >
          детальный разбор
        </button>
      </section>

      {nick ? (
        <RpPlayerDrilldown
          nick={nick}
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
