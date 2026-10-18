import type { BpReward, BpRewardKind } from "@/lib/battlePass";

export type BpPreviewPlayer = {
  nick: string;
  name: string;
  avatarUrl: string | null;
};

function Avatar({
  player,
  framed,
}: {
  player: BpPreviewPlayer;
  framed?: boolean;
}) {
  return (
    <div className={`bp-mock-av-wrap${framed ? " is-framed" : ""}`}>
      {player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="bp-mock-avatar"
          src={player.avatarUrl}
          alt=""
          width={72}
          height={72}
        />
      ) : (
        <div className="bp-mock-avatar bp-mock-avatar-fallback" aria-hidden>
          {(player.nick || "?").slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function HeadText({
  player,
  kind,
  rewardName,
}: {
  player: BpPreviewPlayer;
  kind: BpRewardKind;
  rewardName: string;
}) {
  return (
    <div className="bp-mock-text">
      <p className="bp-mock-eyebrow">профиль</p>
      <div className="bp-mock-title-row">
        <h3>{player.nick}</h3>
        {kind === "title" ? (
          <span className="bp-mock-title-award">{rewardName}</span>
        ) : null}
      </div>
      {kind === "badge" ? (
        <span className="bp-mock-badge">✦ {rewardName}</span>
      ) : null}
      {player.name ? <p className="bp-mock-name">{player.name}</p> : null}
    </div>
  );
}

/** Живой пример шапки профиля с наградой BP. */
export function BpRewardMock({
  reward,
  player,
  compact,
}: {
  reward: BpReward;
  player: BpPreviewPlayer;
  compact?: boolean;
}) {
  const kind = reward.kind;
  return (
    <div
      className={`bp-mock kind-${kind}${compact ? " is-compact" : ""}`}
      aria-label={`Пример: ${reward.name}`}
    >
      {kind === "banner" ? (
        <div className="bp-mock-banner">
          <span>◆ Гвардия прохода · PB1</span>
        </div>
      ) : null}
      <div className="bp-mock-row">
        <Avatar player={player} framed={kind === "frame"} />
        <HeadText
          player={player}
          kind={kind}
          rewardName={reward.name}
        />
      </div>
      {!compact ? (
        <p className="bp-mock-cap">
          L{reward.level} · так будет в профиле
        </p>
      ) : null}
    </div>
  );
}

export function BpRewardMockGallery({
  rewards,
  player,
  activeLevel,
  onPick,
}: {
  rewards: BpReward[];
  player: BpPreviewPlayer;
  activeLevel?: number;
  onPick?: (level: number) => void;
}) {
  return (
    <section className="bp-mock-gallery" aria-label="Примеры наград в профиле">
      <h3>Как награды выглядят в профиле</h3>
      <div className="bp-mock-grid">
        {rewards.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`bp-mock-card${activeLevel === r.level ? " is-on" : ""}`}
            onClick={() => onPick?.(r.level)}
          >
            <span className="bp-mock-card-lvl">L{r.level}</span>
            <BpRewardMock reward={r} player={player} compact />
            <strong className="bp-mock-card-name">{r.name}</strong>
            <em className="bp-mock-card-kind">{r.short}</em>
          </button>
        ))}
      </div>
    </section>
  );
}
