import type { BpReward, BpRewardKind } from "@/lib/battlePass";
import { BP_L5_PROFILE_BG_ID, profileBgUrl } from "@/lib/profileBg";

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

function ProfileHeadMock({
  player,
  kind,
  reward,
  compact,
}: {
  player: BpPreviewPlayer;
  kind: BpRewardKind;
  reward: BpReward;
  compact?: boolean;
}) {
  const goldNick = kind === "nick";
  return (
    <div className="bp-mock-row">
      <div className="bp-mock-av-col">
        <Avatar player={player} framed={kind === "frame"} />
        {kind === "medal" ? (
          <button
            type="button"
            className="bp-mock-medal"
            title={reward.hover || reward.name}
            aria-label={reward.hover || reward.name}
          >
            <span className="bp-mock-medal-face" aria-hidden>
              ★
            </span>
            {!compact ? (
              <span className="bp-mock-medal-tip" role="tooltip">
                {reward.hover || reward.name}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
      <div className="bp-mock-text">
        <p className="bp-mock-eyebrow">профиль</p>
        <div className="bp-mock-title-row">
          <h3 className={goldNick ? "bp-nick-gold" : undefined}>
            {player.nick}
          </h3>
        </div>
        {kind === "badge" ? (
          <span className="bp-mock-badge" title={reward.preview}>
            ✦ Искра
          </span>
        ) : null}
        {player.name && !compact ? (
          <p className="bp-mock-name">{player.name}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Пример строки рейтинга паблика с золотым ником (L15). */
function RatingNickMock({
  player,
  compact,
}: {
  player: BpPreviewPlayer;
  compact?: boolean;
}) {
  return (
    <div className={`bp-mock-rating${compact ? " is-compact" : ""}`}>
      {!compact ? (
        <p className="bp-mock-rating-label">рейтинг паблика · ник</p>
      ) : null}
      <div className="bp-mock-rating-row">
        <span className="bp-mock-rating-rank">5</span>
        <span className="bp-mock-rating-badge">RADIANT I</span>
        <span className="bp-mock-rating-rp">4091</span>
        <span className="bp-mock-rating-tag">BB</span>
        <span className="bp-nick-gold bp-mock-rating-nick">{player.nick}</span>
      </div>
      {!compact ? (
        <p className="bp-mock-rating-hint">
          Так же у всех, кто взял L15 — один золотой цвет ника
        </p>
      ) : null}
    </div>
  );
}

/** Живой пример, где висит награда. */
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
  const bgUrl =
    kind === "bg" ? profileBgUrl(BP_L5_PROFILE_BG_ID) : null;
  return (
    <div
      className={`bp-mock kind-${kind}${compact ? " is-compact" : ""}`}
      aria-label={`Пример: ${reward.name}`}
    >
      {kind === "nick" ? (
        <RatingNickMock player={player} compact={compact} />
      ) : kind === "bg" && bgUrl ? (
        <div
          className="bp-mock-bg"
          style={{ backgroundImage: `url(${bgUrl})` }}
        >
          <span className="bp-mock-bg-nick">{player.nick}</span>
        </div>
      ) : (
        <ProfileHeadMock
          player={player}
          kind={kind}
          reward={reward}
          compact={compact}
        />
      )}
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
    <section className="bp-mock-gallery" aria-label="Примеры наград">
      <h3>Где висят награды</h3>
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
          </button>
        ))}
      </div>
    </section>
  );
}
