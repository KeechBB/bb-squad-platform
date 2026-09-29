import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { CLAN_ROLE_LABEL, type ClanRole } from "@/lib/clan";
import { withAvatarCacheBust } from "@/lib/avatarUrl";
import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { TrainingSessionsCard, TrainingMatchHistory } from "@/components/TrainingSessionsCard";
import { LivePageRefresh } from "@/components/LivePageRefresh";
import { ProfileKvMatchHistory } from "@/components/ProfileKvStats";
import { ProfileStatsTabs } from "@/components/ProfileStatsTabs";
import { ProfileHitmapCard } from "@/components/ProfileHitmapCard";
import { ProfileAccountCard } from "@/components/ProfileAccountCard";
import { SitePresenceBadge } from "@/components/SitePresenceBadge";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { buildPlayerKvStats } from "@/lib/kvStats";
import {
  lookupPlayerTrainPwr,
  buildPlayerTrainMatchHistory,
  buildPlayerTrainCombatStats,
} from "@/lib/homeTrainPwr";
import {
  lookupPlayerCwPwr,
  buildPlayerCwMatchHistory,
} from "@/lib/homeCwPwr";
import { ProfileTrainPwrCard } from "@/components/ProfileTrainPwrCard";
import { ProfileCwPwrCard } from "@/components/ProfileCwPwrCard";
import { bonesForUser } from "@/lib/squadHits";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ nick: string }> };

export default async function PlayerProfilePage({ params }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const { nick: raw } = await params;
  const nick = decodeURIComponent(raw).trim();
  if (!nick) notFound();

  const user = await prisma.user.findFirst({
    where: {
      nick: { equals: nick, mode: "insensitive" },
      profileComplete: true,
    },
    include: {
      clanMemberships: {
        include: {
          clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
          title: { select: { name: true } },
        },
      },
    },
  });

  if (!user) {
    return (
      <main className="profile-page profile-page-empty">
        <section className="card profile-head-public">
          <div className="profile-head-row">
            <div className="admin-user-avatar admin-user-avatar-empty">
              {nick.slice(0, 1).toUpperCase()}
            </div>
            <div className="profile-head-text">
              <p className="eyebrow">профиль игрока</p>
              <h1>{nick}</h1>
              <p className="muted">Игрок не зареган на платформе</p>
            </div>
          </div>
        </section>
        <section className="card">
          <h2>Пустой профиль</h2>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
            Ник <strong>{nick}</strong> есть в таблице КВ, но аккаунта на
            bb-squad.ru ещё нет. Когда игрок войдёт через Steam и завершит
            регистрацию — здесь появятся аватар, клан и резерв.
          </p>
          <p style={{ marginTop: 12 }}>
            <Link className="kv-link" href="/cw">
              ← К клановым войнам
            </Link>
          </p>
        </section>
      </main>
    );
  }

  const isSelf = session.user.steamId === user.steamId;
  if (isSelf) redirect("/profile");

  const avatar = withAvatarCacheBust(user.avatarUrl, user.updatedAt);
  const inReserve = isActiveReserve(user.reserveUntil);
  const nickForKv = user.nick || "";

  const clans = user.clanMemberships.map((m) => ({
    id: m.clan.id,
    tag: m.clan.tag,
    name: m.clan.name,
    logoUrl: m.clan.logoUrl,
    membershipLabel: [
      CLAN_ROLE_LABEL[m.role as ClanRole],
      m.title?.name || null,
      inReserve && m.role === "RESERVE" ? "в резерве" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const [
    training,
    kvBundle,
    trainPwr,
    matchHistory,
    cwPwr,
    cwMatchHistory,
    trainCombat,
    hitmap,
  ] = await Promise.all([
    loadUserTrainingStats(user.id),
    nickForKv
      ? buildPlayerKvStats(nickForKv)
          .then((stats) => ({ stats, error: null as string | null }))
          .catch(() => ({
            stats: null,
            error: "Не удалось загрузить стату КВ" as string | null,
          }))
      : Promise.resolve({
          stats: null,
          error: null as string | null,
        }),
    nickForKv
      ? lookupPlayerTrainPwr(nickForKv).catch(() => null)
      : Promise.resolve(null),
    nickForKv
      ? buildPlayerTrainMatchHistory(nickForKv).catch(() => [])
      : Promise.resolve([]),
    nickForKv
      ? lookupPlayerCwPwr(nickForKv).catch(() => null)
      : Promise.resolve(null),
    nickForKv
      ? buildPlayerCwMatchHistory(nickForKv).catch(() => [])
      : Promise.resolve([]),
    nickForKv
      ? buildPlayerTrainCombatStats(nickForKv).catch(() => null)
      : Promise.resolve(null),
    bonesForUser(user.id).catch(() => ({ bones: {}, total: 0 })),
  ]);

  const kvStats = kvBundle.stats;
  const kvError = kvBundle.error;

  return (
    <main className="profile-page">
      <div className="profile-area-head">
        <div className="profile-head-cluster">
          <section className="card profile-head-public">
            <div className="profile-head-row">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="profile-avatar"
                  src={avatar}
                  alt=""
                  width={176}
                  height={176}
                />
              ) : (
                <div className="profile-avatar profile-avatar-fallback">
                  {(user.nick || "?").slice(0, 1)}
                </div>
              )}
              <div className="profile-head-text">
                <p className="eyebrow">профиль игрока</p>
                <div className="profile-head-title-row">
                  <h1>{user.nick}</h1>
                  <SitePresenceBadge lastSeenAt={user.lastSeenAt} />
                </div>
                <p className="muted">{user.name || "—"}</p>
                <p style={{ marginTop: 10 }}>
                  <Link className="kv-link" href="/clans" style={{ marginTop: 0 }}>
                    ← К кланам
                  </Link>
                </p>
              </div>
            </div>
          </section>
          {inReserve ? (
            <section className="card reserve-banner">
              <h2>В резерве</h2>
              <p className="reserve-status">
                До <strong>{formatRuDate(user.reserveUntil!)}</strong>
                {user.reserveReason ? (
                  <>
                    .<br />
                    <span className="muted">Причина: {user.reserveReason}</span>
                  </>
                ) : null}
              </p>
            </section>
          ) : null}
          <ProfileTrainPwrCard stats={trainPwr} />
          <ProfileCwPwrCard stats={cwPwr} />
        </div>
      </div>

      <div className="profile-area-account">
        <ProfileAccountCard
          data={{
            nick: user.nick || "",
            regNo: user.regNo,
            siteRole: roleLabel(
              effectiveRole(user.steamId, user.role as AppRole)
            ),
            name: user.name || "",
            age: user.age,
            birthDate: user.birthDate ? formatRuDate(user.birthDate) : null,
            discordTag: user.discordTag,
            discordId: user.discordId,
            telegram: user.telegram,
            steamId: user.steamId,
            steamName: user.steamName,
            clans,
          }}
        />
        <ProfileStatsTabs
          kvStats={kvStats}
          kvError={kvError}
          trainStats={trainCombat}
        />
      </div>

      <div className="profile-area-hitmap">
        <ProfileHitmapCard
          bones={hitmap.bones}
          subtitle={hitmap.total > 0 ? "TR1" : undefined}
        />
      </div>

      <div className="profile-area-training">
        <LivePageRefresh intervalMs={15000} />
        <TrainingSessionsCard
          sessions={training.sessions}
          presentDays={training.presentDays}
          lateDays={training.lateDays}
          visitBounds={training.visitBounds}
          minutes30d={training.minutes30d}
          sessions30d={training.sessions30d}
          openNow={training.openNow}
          includeMatchHistory={false}
        />
      </div>

      <div className="profile-area-kv-hist">
        <ProfileKvMatchHistory
          matchHistory={cwMatchHistory}
          highlightNick={nickForKv}
        />
      </div>
      <div className="profile-area-train-hist">
        <TrainingMatchHistory
          matchHistory={matchHistory}
          highlightNick={nickForKv}
        />
      </div>
    </main>
  );
}
