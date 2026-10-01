"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlayerKvStats } from "@/lib/kvStats";
import type { PlayerTrainCombatStats } from "@/lib/homeTrainPwr";
import { ProfileKvStats } from "@/components/ProfileKvStats";

type Tab = "train" | "cw";

type Props = {
  kvStats: PlayerKvStats | null;
  kvError?: string | null;
  trainStats: PlayerTrainCombatStats | null;
  trainError?: string | null;
};

function TrainCombatBody({
  stats,
  error,
}: {
  stats: PlayerTrainCombatStats | null;
  error?: string | null;
}) {
  if (error) {
    return (
      <p className="error" style={{ marginTop: 8 }}>
        {error}
      </p>
    );
  }
  if (!stats || stats.matches === 0) {
    return (
      <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>
        Пока нет раундов с ником <strong>{stats?.nick || "—"}</strong> в
        тренировочных матчах. Когда появятся скрины итогов — сюда подтянутся
        K/D и урон.
      </p>
    );
  }

  const awardTotal =
    stats.mvpDamage + stats.mvpKiller + stats.mvpMedic + stats.antiDeath;

  return (
    <>
      <div className="profile-kv-summary">
        <div>
          <span className="muted">Катки</span>
          <strong>{stats.matches}</strong>
        </div>
        <div>
          <span className="muted">W–L</span>
          <strong>
            {stats.wins}–{stats.losses}
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
          <em className="stat-sub">ср. {stats.avgDmg} / катка</em>
        </div>
      </div>
      <div className="profile-kv-extra">
        <div>
          <span className="muted">Ср. киллы / катка</span>
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
    </>
  );
}

export function ProfileStatsTabs({
  kvStats,
  kvError,
  trainStats,
  trainError,
}: Props) {
  const [tab, setTab] = useState<Tab>("cw");

  return (
    <section className="card profile-kv-card profile-stats-tabs-card">
      <div className="profile-kv-head profile-stats-tabs-head">
        <div className="profile-stats-tablist" role="tablist" aria-label="Тип статистики">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "train"}
            className={`profile-stats-tab${tab === "train" ? " active" : ""}`}
            onClick={() => setTab("train")}
          >
            Статистика тренировок
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "cw"}
            className={`profile-stats-tab${tab === "cw" ? " active" : ""}`}
            onClick={() => setTab("cw")}
          >
            Статистика КВ
          </button>
        </div>
        {tab === "cw" ? (
          <Link className="kv-link" href="/cw">
            Таблица КВ →
          </Link>
        ) : (
          <Link className="kv-link" href="/tm">
            Тренировки →
          </Link>
        )}
      </div>

      {tab === "cw" ? (
        <div className="profile-stats-tabpanel" role="tabpanel">
          <ProfileKvStats
            stats={kvStats}
            error={kvError}
            includeMatchHistory={false}
            hideOuterCard
          />
        </div>
      ) : (
        <div className="profile-stats-tabpanel" role="tabpanel">
          <TrainCombatBody stats={trainStats} error={trainError} />
        </div>
      )}
    </section>
  );
}
