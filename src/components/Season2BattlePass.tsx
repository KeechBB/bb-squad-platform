"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BpLevel, BpPlayerProgress, BpReward } from "@/lib/battlePass";
import { BpRewardMock, type BpPreviewPlayer } from "@/components/BpRewardMock";
import { CanvasScaleStage } from "@/components/CanvasScaleStage";
import {
  BP_S2_HERO_ART,
  BP_S2_IDLE_ART,
  BP_S2_LEVELS,
  BP_S2_REWARDS,
  s2RewardFullImage,
  s2RewardMileImage,
} from "@/lib/battlePassSeason2";

const PAGE_SIZE = 10;
const TOP_CAP = 50;

type Props = {
  selfNick: string;
  selfName: string;
  selfAvatarUrl: string | null;
  selfProgress: BpPlayerProgress;
  leaderboard: BpPlayerProgress[];
  statusNote?: string;
  scoringEnabled?: boolean;
  seasonTitle?: string;
  seasonSubtitle?: string;
  startLabel?: string;
  endLabel?: string;
  levels?: BpLevel[];
  rewards?: BpReward[];
};

function podiumClass(place: number) {
  if (place === 1) return "is-podium is-gold";
  if (place === 2) return "is-podium is-silver";
  if (place === 3) return "is-podium is-bronze";
  return "";
}

/**
 * Раскладка строго по белому вайрфрейму:
 * [шапка]
 * [25 уровней]
 * [задание+5 бойцов | рейтинг]
 * [5 кругов наград | превью награды / halloween-арт]
 */
export function Season2BattlePass({
  selfNick,
  selfName,
  selfAvatarUrl,
  selfProgress,
  leaderboard,
  statusNote,
  scoringEnabled,
  seasonTitle = "SEASON 2",
  seasonSubtitle = "Halloween · Фруктовый Сад",
  startLabel = "03.11.2026",
  endLabel = "30.11.2026",
  levels = BP_S2_LEVELS,
  rewards = BP_S2_REWARDS,
}: Props) {
  const [selected, setSelected] = useState(selfProgress.currentLevel);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [boardPage, setBoardPage] = useState(0);

  const player: BpPreviewPlayer = {
    nick: selfNick,
    name: selfName,
    avatarUrl: selfAvatarUrl,
  };

  const milestoneRewards = useMemo(
    () =>
      [5, 10, 15, 20, 25]
        .map((lv) => rewards.find((r) => r.level === lv))
        .filter(Boolean) as BpReward[],
    [rewards]
  );

  const level = useMemo(
    () => levels.find((l) => l.level === selected) || levels[0],
    [selected, levels]
  );

  const previewReward = useMemo(
    () => (previewId ? rewards.find((r) => r.id === previewId) || null : null),
    [previewId, rewards]
  );
  const hoverReward = useMemo(
    () => (hoverId ? rewards.find((r) => r.id === hoverId) || null : null),
    [hoverId, rewards]
  );
  /** Правое окно: ховер → клик-превью → idle-арт */
  const sideReward = hoverReward || previewReward;

  const cur = selfProgress.currentLevel;
  const progressCurrent =
    selected === cur ? selfProgress.current : selected < cur ? level.target : 0;
  const progressTarget = level.target;
  const pct = Math.min(
    100,
    Math.round((progressCurrent / Math.max(1, progressTarget)) * 100)
  );

  const boardRows = useMemo(
    () => leaderboard.slice(0, TOP_CAP),
    [leaderboard]
  );
  const pageCount = Math.max(1, Math.ceil(boardRows.length / PAGE_SIZE) || 1);
  const pageSafe = Math.min(boardPage, pageCount - 1);
  const pageSlice = boardRows.slice(
    pageSafe * PAGE_SIZE,
    pageSafe * PAGE_SIZE + PAGE_SIZE
  );

  function openReward(r: BpReward) {
    setPreviewId(r.id);
    setSelected(r.level);
  }

  function pickLevel(lv: number) {
    setSelected(lv);
    const hit = rewards.find((r) => r.level === lv);
    if (hit) setPreviewId(hit.id);
  }

  return (
    <CanvasScaleStage contentWidth="full" className="is-bp">
      <main className="bp-page bp-s2">
        {/* 1 — шапка */}
        <header className="bp-s2-hero">
          <p className="bp-s2-hero-eyebrow">{seasonSubtitle}</p>
          <h1 className="bp-s2-hero-title">{seasonTitle}</h1>
          <p className="bp-s2-hero-dates">
            {startLabel} — {endLabel}
          </p>
          {statusNote ? <p className="bp-s2-hero-status">{statusNote}</p> : null}
        </header>

        {/* 2 — 25 уровней в одну полосу */}
        <section className="bp-s2-track" aria-label="Уровни Season 2">
          <div className="bp-s2-track-line" aria-hidden />
          {levels.map((l) => {
            const rew = rewards.find((r) => r.level === l.level);
            return (
              <button
                key={l.level}
                type="button"
                className={[
                  "bp-s2-node",
                  selected === l.level ? "is-on" : "",
                  l.level > cur ? "is-locked" : "",
                  l.level < cur ? "is-done" : "",
                  l.level === cur ? "is-current" : "",
                  rew ? "has-reward" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={rew ? `${l.title} · ${rew.name}` : l.title}
                onClick={() => pickLevel(l.level)}
              >
                {rew ? (
                  <span className="bp-s2-node-tip">{rew.short}</span>
                ) : (
                  <span className="bp-s2-node-tip is-empty" aria-hidden />
                )}
                <span className="bp-s2-node-disc">{l.level}</span>
              </button>
            );
          })}
        </section>

        {/* 3+4 — середина: задание+арт | рейтинг */}
        <div className="bp-s2-mid">
          <section className="bp-s2-stage" aria-live="polite">
            <div className="bp-s2-task">
              <div className="bp-s2-task-head">
                <span>Уровень {level.level}</span>
                <h2>{level.title}</h2>
              </div>
              <p className="bp-s2-task-body">{level.task}</p>
              <div className="bp-s2-task-progress">
                <div className="bp-s2-task-meta">
                  <span>
                    {selected === cur
                      ? "Текущее задание"
                      : selected < cur
                        ? "Выполнено"
                        : "Ещё не открыто"}
                  </span>
                  <span>
                    {progressCurrent}/{progressTarget} {level.unit}
                  </span>
                </div>
                <div
                  className="bp-s2-task-bar"
                  role="progressbar"
                  aria-valuenow={progressCurrent}
                  aria-valuemin={0}
                  aria-valuemax={progressTarget}
                >
                  <i style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="bp-s2-task-art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BP_S2_HERO_ART} alt="" />
              </div>
            </div>
          </section>

          <aside className="bp-s2-board" aria-label="Рейтинг игроков">
            <h3>Рейтинги игроков</h3>
            <p className="bp-s2-board-sub">
              Топ-{TOP_CAP} · по {PAGE_SIZE} на странице
            </p>
            {boardRows.length === 0 ? (
              <p className="bp-s2-board-empty">
                {scoringEnabled
                  ? "Пока никого в рейтинге."
                  : "Подсчёт ещё не стартовал."}
              </p>
            ) : (
              <>
                <ol
                  className="bp-s2-board-list"
                  start={pageSafe * PAGE_SIZE + 1}
                >
                  {pageSlice.map((row, i) => {
                    const place = pageSafe * PAGE_SIZE + i + 1;
                    const me =
                      selfNick.trim().toLowerCase() ===
                      String(row.nick || "").trim().toLowerCase();
                    return (
                      <li
                        key={row.nick}
                        className={[
                          "bp-s2-board-row",
                          podiumClass(place),
                          me ? "is-me" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className="bp-s2-board-rank">{place}</span>
                        <Link
                          className="bp-s2-board-nick"
                          href={`/players/${encodeURIComponent(row.nick)}`}
                        >
                          {row.nick}
                        </Link>
                        <span className="bp-s2-board-lvl">
                          Ур. <b>{row.currentLevel}</b>
                        </span>
                        <span className="bp-s2-board-maps" title="Карт с старта BP">
                          —
                        </span>
                      </li>
                    );
                  })}
                </ol>
                {pageCount > 1 ? (
                  <div className="bp-s2-board-pager">
                    <button
                      type="button"
                      disabled={pageSafe <= 0}
                      onClick={() => setBoardPage((p) => Math.max(0, p - 1))}
                    >
                      ←
                    </button>
                    <span>
                      {pageSafe + 1}/{pageCount}
                    </span>
                    <button
                      type="button"
                      disabled={pageSafe >= pageCount - 1}
                      onClick={() =>
                        setBoardPage((p) => Math.min(pageCount - 1, p + 1))
                      }
                    >
                      →
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </aside>
        </div>

        {/* 5+6 — низ: 5 кругов | правое окно награды */}
        <div className="bp-s2-bottom">
          <section className="bp-s2-milestones" aria-label="Награды сезона">
            {milestoneRewards.map((r) => {
              const isBg = r.kind === "bg";
              const iconSrc = s2RewardMileImage(r);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={[
                    "bp-s2-mile",
                    isBg ? "is-bg" : "is-clean",
                    previewId === r.id ? "is-on" : "",
                    hoverId === r.id ? "is-hover" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => openReward(r)}
                  onMouseEnter={() => setHoverId(r.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onFocus={() => setHoverId(r.id)}
                  onBlur={() => setHoverId(null)}
                  title={`L${r.level} · ${r.name}`}
                >
                  <span className="bp-s2-mile-ring">
                    <span className="bp-s2-mile-lvl">L{r.level}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={iconSrc} alt="" />
                  </span>
                  <span className="bp-s2-mile-name">{r.short}</span>
                </button>
              );
            })}
          </section>

          <aside
            className={`bp-s2-side-art${sideReward ? " has-preview" : ""}${
              hoverReward ? " is-hovering" : ""
            }`}
            aria-label="Превью награды"
          >
            {sideReward ? (
              <div className="bp-s2-side-preview">
                {previewReward && !hoverReward ? (
                  <button
                    type="button"
                    className="bp-s2-preview-close"
                    aria-label="Закрыть"
                    onClick={() => setPreviewId(null)}
                  >
                    ×
                  </button>
                ) : null}
                <p className="bp-s2-side-preview-lvl">
                  Уровень {sideReward.level} · {sideReward.short}
                </p>
                <strong className="bp-s2-side-preview-name">
                  {sideReward.name}
                </strong>
                <p className="bp-s2-side-preview-desc">{sideReward.preview}</p>
                <div className="bp-s2-side-preview-art">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s2RewardFullImage(sideReward)} alt="" />
                </div>
                <div className="bp-s2-side-preview-mock">
                  <BpRewardMock
                    reward={sideReward}
                    player={player}
                    compact={false}
                  />
                </div>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bp-s2-side-idle" src={BP_S2_IDLE_ART} alt="" />
            )}
          </aside>
        </div>
      </main>
    </CanvasScaleStage>
  );
}
