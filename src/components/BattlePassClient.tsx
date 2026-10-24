"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BP_LEVELS,
  BP_REWARDS,
  BP_SEASON,
  type BpLevel,
  type BpPlayerProgress,
  type BpReward,
} from "@/lib/battlePass";
import {
  BpRewardMock,
  BpRewardMockGallery,
  type BpPreviewPlayer,
} from "@/components/BpRewardMock";
import { CanvasScaleStage } from "@/components/CanvasScaleStage";

type Props = {
  selfNick: string;
  selfName: string;
  selfAvatarUrl: string | null;
  selfProgress: BpPlayerProgress;
  leaderboard: BpPlayerProgress[];
  statusNote?: string;
  scoringEnabled?: boolean;
  /** Подмена сезона/картинок/наград для скрытых превью; живой BP — без этого пропа */
  seasonOverride?: { subtitle: string; startLabel: string; endLabel: string };
  detailBg?: string;
  rewardsOverride?: BpReward[];
};

function podiumClass(place: number) {
  if (place === 1) return "is-podium is-gold";
  if (place === 2) return "is-podium is-silver";
  if (place === 3) return "is-podium is-bronze";
  return "";
}

const BP_BG = "/bp-previews/fruktovy-sad-bg.jpg";

function RewardMark({ reward }: { reward: BpReward }) {
  return (
    <div className={`bp-reward-mark kind-${reward.kind}`} title={reward.name}>
      <span className="bp-reward-mark-short">{reward.short}</span>
      <span className="bp-reward-mark-name">{reward.name}</span>
    </div>
  );
}

function LevelNode({
  level,
  reward,
  selected,
  locked,
  done,
  current,
  onSelect,
}: {
  level: BpLevel;
  reward?: BpReward;
  selected: boolean;
  locked: boolean;
  done: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const cls = [
    "bp-node",
    selected ? "is-selected" : "",
    locked ? "is-locked" : "",
    done ? "is-done" : "",
    current ? "is-current" : "",
    reward ? "has-reward" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={cls} onClick={onSelect}>
      {reward ? (
        <div className="bp-node-reward">
          <RewardMark reward={reward} />
        </div>
      ) : (
        <div className="bp-node-reward bp-node-reward-empty" aria-hidden />
      )}
      <div className="bp-node-disc">
        <span className="bp-node-num">{level.level}</span>
      </div>
      <span className="bp-node-label">{level.title}</span>
    </button>
  );
}

export function BattlePassClient({
  selfNick,
  selfName,
  selfAvatarUrl,
  selfProgress,
  leaderboard,
  statusNote,
  scoringEnabled,
  seasonOverride,
  detailBg,
  rewardsOverride,
}: Props) {
  const [selected, setSelected] = useState(selfProgress.currentLevel);
  const player: BpPreviewPlayer = {
    nick: selfNick,
    name: selfName,
    avatarUrl: selfAvatarUrl,
  };
  const rewardsList = rewardsOverride ?? BP_REWARDS;
  const season = seasonOverride ?? BP_SEASON;

  const level = useMemo(
    () => BP_LEVELS.find((l) => l.level === selected) || BP_LEVELS[0],
    [selected]
  );
  const levelRewards = rewardsList.filter((r) => r.level === level.level);
  const reward = levelRewards[0];
  const top10 = useMemo(() => leaderboard.slice(0, 10), [leaderboard]);

  const cur = selfProgress.currentLevel;
  const progressCurrent =
    selected === cur ? selfProgress.current : selected < cur ? level.target : 0;
  const progressTarget = level.target;
  const pct = Math.min(
    100,
    Math.round((progressCurrent / Math.max(1, progressTarget)) * 100)
  );

  return (
    <CanvasScaleStage contentWidth="full" className="is-bp">
    <main className="bp-page">
      <header className="bp-hero">
        <p className="bp-hero-eyebrow">{season.subtitle}</p>
        <h1 className="bp-hero-title">{BP_SEASON.title}</h1>
        <p className="bp-hero-dates">
          {season.startLabel} — {season.endLabel}
        </p>
        {statusNote ? <p className="bp-hero-status">{statusNote}</p> : null}
      </header>

      <section className="bp-track-wrap" aria-label="Уровни Battle Pass">
        <div className="bp-track">
          {BP_LEVELS.map((l) => (
            <LevelNode
              key={l.level}
              level={l}
              reward={rewardsList.find((r) => r.level === l.level)}
              selected={selected === l.level}
              locked={l.level > cur}
              done={l.level < cur}
              current={l.level === cur}
              onSelect={() => setSelected(l.level)}
            />
          ))}
        </div>
      </section>

      <div className="bp-body">
        <section
          className={`bp-detail${reward ? " has-reward" : ""}`}
          aria-live="polite"
        >
          <div className="bp-detail-bg" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={detailBg ?? BP_BG} alt="" />
          </div>
          <div className="bp-detail-veil" aria-hidden />

          <div className="bp-detail-top">
            <div className="bp-detail-head">
              <span className="bp-detail-lvl">Уровень {level.level}</span>
              <h2>{level.title}</h2>
            </div>
            <p className="bp-detail-task">{level.task}</p>

            {levelRewards.map((r) => (
              <div key={r.id} className={`bp-detail-reward kind-${r.kind}`}>
                <span className="bp-detail-reward-tag">Награда</span>
                <strong>{r.name}</strong>
                <BpRewardMock
                  reward={r}
                  player={player}
                  compact={r.kind !== "medal"}
                />
              </div>
            ))}

            <div className="bp-progress">
              <div className="bp-progress-meta">
                <span>
                  {selected === cur
                    ? "Текущее задание"
                    : selected < cur
                      ? "Выполнено"
                      : "Ещё не открыто"}
                </span>
                <span className="bp-progress-nums">
                  {progressCurrent}/{progressTarget} {level.unit}
                </span>
              </div>
              <div
                className="bp-progress-bar"
                role="progressbar"
                aria-valuenow={progressCurrent}
                aria-valuemin={0}
                aria-valuemax={progressTarget}
              >
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        </section>

        <aside className="bp-side">
          <BpRewardMockGallery
            rewards={rewardsList}
            player={player}
            activeLevel={selected}
            onPick={setSelected}
          />

          <section className="bp-board" aria-label="Топ-10 Battle Pass">
            <h3>Топ-10 прохождения</h3>
            <p className="bp-board-sub">Рейтинг Battle Pass · максимум 10 мест</p>
            {top10.length === 0 ? (
              <p className="bp-board-empty">
                {scoringEnabled
                  ? "Пока никого — ждём следующую карту на Фруктовом Саде (только зарегистрированные)."
                  : "Подсчёт ещё не стартовал."}
              </p>
            ) : (
              <ol className="bp-board-list">
                {top10.map((row, i) => {
                  const place = i + 1;
                  const me =
                    selfNick.trim().toLowerCase() ===
                    String(row.nick || "").trim().toLowerCase();
                  return (
                    <li
                      key={row.nick}
                      className={[
                        "bp-board-row",
                        podiumClass(place),
                        me ? "is-me" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span
                        className={`bp-board-rank${place <= 3 ? " is-medal" : ""}`}
                        aria-label={`${place} место`}
                      >
                        {place <= 3 ? (
                          <span className={`home-podium-medal place-${place}`} />
                        ) : (
                          place
                        )}
                      </span>
                      <Link
                        className="bp-board-nick"
                        href={`/players/${encodeURIComponent(row.nick)}`}
                        title={row.nick}
                      >
                        {row.nick}
                      </Link>
                      <span className="bp-board-lvl">
                        Ур.{" "}
                        <b className="bp-board-lvl-num">{row.currentLevel}</b>
                      </span>
                      <span className="bp-board-score">
                        <b>
                          {row.current}/{row.target}
                        </b>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </main>
    </CanvasScaleStage>
  );
}
