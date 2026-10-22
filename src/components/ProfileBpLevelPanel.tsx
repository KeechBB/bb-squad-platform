"use client";

export type ProfileBpView = {
  season: string;
  level: number;
  title: string;
  task: string;
  unit: string;
  current: number;
  target: number;
  done: boolean;
  maxLevel: number;
};

/** Ступень цвета BP: 1 / 5 / 10 / 15 / 20. */
export function bpTier(level: number): 1 | 5 | 10 | 15 | 20 {
  if (level >= 20) return 20;
  if (level >= 15) return 15;
  if (level >= 10) return 10;
  if (level >= 5) return 5;
  return 1;
}

export function ProfileBpLevelPanel({ bp }: { bp: ProfileBpView | null }) {
  if (!bp) {
    return (
      <div className="profile-bp-panel" data-tier="1" aria-busy="true">
        <p className="profile-bp-wait">Считаем уровень…</p>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((bp.current / Math.max(1, bp.target)) * 100));
  const tier = bpTier(bp.done ? 20 : bp.level);

  return (
    <div className="profile-bp-panel" data-tier={tier}>
      <p className="profile-bp-eyebrow">{bp.season}</p>
      <div className="profile-bp-hero">
        <p className="profile-bp-kicker">Уровень</p>
        <p className="profile-bp-num">{bp.done ? bp.maxLevel : bp.level}</p>
        <h2 className="profile-bp-title">{bp.done ? "Сезон закрыт" : bp.title}</h2>
      </div>
      <p className="profile-bp-task">{bp.done ? "Все 20 уровней пройдены" : bp.task}</p>
      <div className="profile-bp-pips" aria-hidden>
        {Array.from({ length: bp.maxLevel }, (_, i) => {
          const n = i + 1;
          const cls = bp.done || n < bp.level ? "is-done" : n === bp.level ? "is-now" : "";
          return <i key={n} className={cls} />;
        })}
      </div>
      <div className="profile-bp-progress">
        <div className="profile-bp-progress-meta">
          <span>{bp.done ? "Пройдено" : "Текущее задание"}</span>
          <span>
            {bp.done ? `${bp.maxLevel}/${bp.maxLevel}` : `${bp.current}/${bp.target}`} {bp.done ? "" : bp.unit}
          </span>
        </div>
        <div
          className="profile-bp-bar"
          role="progressbar"
          aria-valuenow={bp.done ? bp.maxLevel : bp.current}
          aria-valuemin={0}
          aria-valuemax={bp.done ? bp.maxLevel : bp.target}
          aria-label="Прогресс Battle Pass"
        >
          <i style={{ width: `${bp.done ? 100 : pct}%` }} />
        </div>
      </div>
    </div>
  );
}
