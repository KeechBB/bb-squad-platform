"use client";

import { useMemo, useState } from "react";
import {
  BP_LEVELS,
  BP_REWARDS,
  BP_SEASON,
  rewardForLevel,
  type BpLevel,
  type BpPlayerProgress,
  type BpReward,
} from "@/lib/battlePass";
import {
  BpRewardMock,
  BpRewardMockGallery,
  type BpPreviewPlayer,
} from "@/components/BpRewardMock";

type Props = {
  selfNick: string;
  selfName: string;
  selfAvatarUrl: string | null;
  selfProgress: BpPlayerProgress;
  leaderboard: BpPlayerProgress[];
};

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
  selected,
  locked,
  done,
  current,
  onSelect,
}: {
  level: BpLevel;
  selected: boolean;
  locked: boolean;
  done: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const reward = rewardForLevel(level.level);
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
}: Props) {
  const [selected, setSelected] = useState(selfProgress.currentLevel);
  const player: BpPreviewPlayer = {
    nick: selfNick,
    name: selfName,
    avatarUrl: selfAvatarUrl,
  };

  const level = useMemo(
    () => BP_LEVELS.find((l) => l.level === selected) || BP_LEVELS[0],
    [selected]
  );
  const reward = rewardForLevel(level.level);

  const cur = selfProgress.currentLevel;
  const progressCurrent =
    selected === cur ? selfProgress.current : selected < cur ? level.target : 0;
  const progressTarget = level.target;
  const pct = Math.min(
    100,
    Math.round((progressCurrent / Math.max(1, progressTarget)) * 100)
  );

  return (
    <main className="bp-page">
      <header className="bp-hero">
        <p className="bp-hero-eyebrow">{BP_SEASON.subtitle}</p>
        <h1 className="bp-hero-title">{BP_SEASON.title}</h1>
        <p className="bp-hero-dates">
          {BP_SEASON.startLabel} — {BP_SEASON.endLabel}
        </p>
        <p className="bp-hero-note">{BP_SEASON.note}</p>
      </header>

      <section className="bp-track-wrap" aria-label="Уровни Battle Pass">
        <div className="bp-track">
          {BP_LEVELS.map((l) => (
            <LevelNode
              key={l.level}
              level={l}
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
        <section className="bp-detail" aria-live="polite">
          <div className="bp-detail-head">
            <span className="bp-detail-lvl">Уровень {level.level}</span>
            <h2>{level.title}</h2>
          </div>
          <p className="bp-detail-task">{level.task}</p>
          {level.hint ? <p className="bp-detail-hint">{level.hint}</p> : null}

          {reward ? (
            <div className={`bp-detail-reward kind-${reward.kind}`}>
              <span className="bp-detail-reward-tag">Награда</span>
              <strong>{reward.name}</strong>
              <span className="bp-detail-reward-preview">{reward.preview}</span>
              <BpRewardMock reward={reward} player={player} />
            </div>
          ) : null}

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
            {selected === cur ? (
              <p className="bp-progress-foot muted">
                Для {selfNick}: прогресс не считается — ждём включения сезона.
              </p>
            ) : null}
          </div>
        </section>

        <aside className="bp-side">
          <BpRewardMockGallery
            rewards={BP_REWARDS}
            player={player}
            activeLevel={selected}
            onPick={setSelected}
          />

          <section className="bp-board">
            <h3>Рейтинг прохождения</h3>
            {leaderboard.length === 0 ? (
              <p className="bp-board-empty">
                Таблица пустая: подсчёт выключен. После запуска здесь будут
                зарегистрированные игроки и их уровень.
              </p>
            ) : (
              <table className="bp-board-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Игрок</th>
                    <th>Ур.</th>
                    <th>Прогресс</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, i) => (
                    <tr key={row.nick}>
                      <td>{i + 1}</td>
                      <td>{row.nick}</td>
                      <td>{row.currentLevel}</td>
                      <td>
                        {row.current}/{row.target}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
