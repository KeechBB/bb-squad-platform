"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlayerKvStats } from "@/lib/kvStats";
import type { PlayerTrainCombatStats } from "@/lib/homeTrainPwr";
import type { PlayerPublicCombatStats } from "@/lib/publicCombat";
import { ProfileKvStats } from "@/components/ProfileKvStats";

type Tab = "train" | "cw" | "public";

type Props = {
  kvStats: PlayerKvStats | null;
  kvError?: string | null;
  trainStats: PlayerTrainCombatStats | null;
  trainError?: string | null;
  publicStats?: PlayerPublicCombatStats | null;
  publicError?: string | null;
};

function CombatBody({
  stats,
  error,
  emptyHint,
}: {
  stats: PlayerTrainCombatStats | PlayerPublicCombatStats | null;
  error?: string | null;
  emptyHint: string;
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
        {emptyHint}
      </p>
    );
  }

  const awardTotal = stats.mvpKiller + stats.mvpMedic + stats.antiDeath;
  const days =
    "days" in stats && typeof stats.days === "number" ? stats.days : null;

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
          <span className="muted">Ср. киллы / катка</span>
          <strong>{stats.avgKills}</strong>
        </div>
      </div>
      <div className="profile-kv-extra">
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
        {days != null ? (
          <div>
            <span className="muted">Дней на PB1</span>
            <strong>{days}</strong>
          </div>
        ) : null}
      </div>
      <div className="profile-kv-awards">
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
  publicStats = null,
  publicError = null,
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
          <button
            type="button"
            role="tab"
            aria-selected={tab === "public"}
            className={`profile-stats-tab${tab === "public" ? " active" : ""}`}
            onClick={() => setTab("public")}
          >
            Статистика паблика
          </button>
        </div>
        {tab === "cw" ? (
          <Link className="kv-link" href="/cw">
            Таблица КВ →
          </Link>
        ) : tab === "train" ? (
          <Link className="kv-link" href="/tm">
            Тренировки →
          </Link>
        ) : (
          <Link className="kv-link" href="/public">
            Рейтинг паблика →
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
      ) : tab === "train" ? (
        <div className="profile-stats-tabpanel" role="tabpanel">
          <CombatBody
            stats={trainStats}
            error={trainError}
            emptyHint={`Пока нет раундов с ником ${trainStats?.nick || "—"} в тренировочных матчах.`}
          />
        </div>
      ) : (
        <div className="profile-stats-tabpanel" role="tabpanel">
          <CombatBody
            stats={publicStats}
            error={publicError}
            emptyHint={`Пока нет каток паблика с ником ${publicStats?.nick || "—"}. MVP и стата появятся после заливки (без SEED). Дней на PB1: ${publicStats?.days ?? 0}.`}
          />
        </div>
      )}
    </section>
  );
}
