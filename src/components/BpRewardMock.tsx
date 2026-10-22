import type { BpReward, BpRewardKind } from "@/lib/battlePass";
import { BP_L5_PROFILE_BG_ID, profileBgUrl } from "@/lib/profileBg";
import {
  BP_L15_PATCH_ID,
  profilePatchTip,
  profilePatchUrl,
} from "@/lib/profilePatches";

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
  const medalIcon =
    reward.id === "pb1-best-tester"
      ? "/awards/bp-s1-l20-pink-strawberry.png"
      : null;
  return (
    <div className="bp-mock-row">
      <div className="bp-mock-av-col">
        <Avatar player={player} framed={kind === "frame"} />
        {kind === "medal" ? (
          <button
            type="button"
            className={`bp-mock-medal${medalIcon ? " is-image" : ""}`}
            title={reward.hover || reward.name}
            aria-label={reward.hover || reward.name}
          >
            {medalIcon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="bp-mock-medal-image"
                src={medalIcon}
                alt=""
                width={80}
                height={80}
              />
            ) : (
              <span className="bp-mock-medal-face" aria-hidden>
                ★
              </span>
            )}
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

/** L10: пример золотого ника в строке рейтинга. */
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
        <span
          className="public-rating-nick-label is-metallic-gold bp-mock-rating-nick"
          data-text={player.nick}
        >
          {player.nick}
        </span>
      </div>
      {!compact ? (
        <p className="bp-mock-rating-hint">
          Награда L10 · выбирается в кастомизации и видна во всех трёх рейтингах
        </p>
      ) : null}
    </div>
  );
}

/** L15: нашивка у ника, как в рейтингах. */
function RatingPatchMock({
  player,
  reward,
  compact,
}: {
  player: BpPreviewPlayer;
  reward: BpReward;
  compact?: boolean;
}) {
  const url = profilePatchUrl(BP_L15_PATCH_ID);
  const tip = reward.hover || profilePatchTip(BP_L15_PATCH_ID);
  return (
    <div className={`bp-mock-rating bp-mock-patch${compact ? " is-compact" : ""}`}>
      {!compact ? (
        <p className="bp-mock-rating-label">рейтинг · нашивка</p>
      ) : null}
      <div className="bp-mock-rating-row bp-mock-patch-row">
        <span className="bp-mock-rating-nick">{player.nick}</span>
        {url ? (
          <span
            className="nick-patch-mark bp-mock-patch-mark"
            data-patch-id={BP_L15_PATCH_ID}
            title={tip}
            aria-label={tip}
          >
            <span
              className="nick-patch-mark-art"
              style={{ backgroundImage: `url(${url})` }}
              aria-hidden
            />
          </span>
        ) : null}
      </div>
      {!compact ? (
        <p className="bp-mock-rating-hint">
          Видна в паблике, КВ и тренировках — ставится в кастомизации профиля
        </p>
      ) : null}
    </div>
  );
}

/** Полная имитация полки профиля (3 слота), как на /profile. */
function ShelfMedalMock({
  reward,
  compact,
}: {
  reward: BpReward;
  compact?: boolean;
}) {
  const icon =
    reward.id === "pb1-best-tester"
      ? "/awards/bp-s1-l20-pink-strawberry.png"
      : "/bp-previews/l20-medal.png";
  const tip = reward.hover || reward.name;
  return (
    <div className={`bp-shelf-preview${compact ? " is-compact" : ""}`}>
      <div className="bp-shelf-preview-stage">
        <ul className="bp-shelf-preview-row">
          <li className="bp-shelf-preview-slot is-empty">
            <span className="bp-shelf-preview-empty" aria-hidden />
          </li>
          <li className="bp-shelf-preview-slot is-hero">
            <button
              type="button"
              data-medal-id={reward.id}
              className="bp-shelf-preview-item kind-medal"
              title={tip}
              aria-label={tip}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon} alt="" width={768} height={768} />
            </button>
          </li>
          <li className="bp-shelf-preview-slot is-empty">
            <span className="bp-shelf-preview-empty" aria-hidden />
          </li>
        </ul>
        <span className="bp-shelf-preview-badge" aria-hidden>
          BP L{reward.level}
        </span>
      </div>
      {!compact ? (
        <p className="bp-shelf-preview-note">
          Так будет на полке профиля · награда за{" "}
          <strong>{reward.level} уровень</strong> Battle Pass
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
      ) : kind === "customize" ? (
        <RatingPatchMock player={player} reward={reward} compact={compact} />
      ) : kind === "medal" ? (
        <ShelfMedalMock reward={reward} compact={compact} />
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
