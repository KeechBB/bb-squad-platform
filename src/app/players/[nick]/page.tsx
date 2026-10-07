import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { CLAN_ROLE_LABEL, type ClanRole } from "@/lib/clan";
import { withAvatarCacheBust } from "@/lib/avatarUrl";
import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { TrainingSessionsCard } from "@/components/TrainingSessionsCard";
import { ProfilePublicRatingCard } from "@/components/ProfilePublicRatingCard";
import { ProfileHitmapCard } from "@/components/ProfileHitmapCard";
import { ProfileAccountCard } from "@/components/ProfileAccountCard";
import { SitePresenceBadge } from "@/components/SitePresenceBadge";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { loadUserPublicAttendanceStats } from "@/lib/publicAttendance";
import { lookupPlayerPublicRp } from "@/lib/publicRp";
import { lookupPlayerTrainPwr } from "@/lib/homeTrainPwr";
import { getEnemyPlayer } from "@/lib/crossRating";
import { ProfileTrainPwrCard } from "@/components/ProfileTrainPwrCard";
import { ProfileKitsCard } from "@/components/ProfileKitsCard";
import { ProfileCareerCard } from "@/components/ProfileCareerCard";
import {
  ProfileHeavyFallback,
  ProfileHeavySection,
} from "@/components/ProfileHeavySection";
import { isBlackberryClanMember } from "@/lib/blackberryClan";
import {
  resolveGuestPlayerIdentity,
  loadGuestTrainingStats,
  loadGuestHitBones,
} from "@/lib/guestPlayer";

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

  // Синтетические «главы» чужих кланов (7656119900001…) — не живые аккаунты;
  // для них показываем guest-профиль со статуй с табло.
  const EXTERNAL_LEADER_STEAM_PREFIX = "7656119900001";
  const user = await prisma.user.findFirst({
    where: {
      nick: { equals: nick, mode: "insensitive" },
      profileComplete: true,
      NOT: { steamId: { startsWith: EXTERNAL_LEADER_STEAM_PREFIX } },
    },
    include: {
      clanMemberships: {
        include: {
          clan: {
            select: {
              id: true,
              name: true,
              tag: true,
              logoUrl: true,
              isExternal: true,
            },
          },
          title: { select: { name: true } },
        },
      },
    },
  });

  if (!user) {
    const identity = await resolveGuestPlayerIdentity(nick);
    const displayNick0 = identity.nick || nick;
    const primarySteam = identity.steamIds[0] || null;

    const [enemy, training, hits] = await Promise.all([
      getEnemyPlayer(displayNick0).catch(() => null),
      loadGuestTrainingStats(identity.steamIds).catch(() => null),
      primarySteam
        ? loadGuestHitBones(identity.steamIds).catch(() => ({
            bones: {},
            total: 0,
            lastBone: null as string | null,
          }))
        : Promise.resolve({
            bones: {},
            total: 0,
            lastBone: null as string | null,
          }),
    ]);
    const displayNick = enemy?.nick || displayNick0;
    const clanTag = enemy?.clanTag || null;
    const clanKey = enemy?.clanKey || null;
    const tr1 = training?.tr1;
    const tr2 = training?.tr2;

    return (
      <main className="profile-page">
        <div className="profile-area-head">
          <div className="profile-head-cluster">
            <section className="card profile-head-public">
              <div className="profile-head-row">
                <div className="admin-user-avatar admin-user-avatar-empty">
                  {displayNick.slice(0, 1).toUpperCase()}
                </div>
                <div className="profile-head-text">
                  <p className="eyebrow">
                    {clanTag ? `игрок [${clanTag}]` : "профиль игрока"}
                  </p>
                  <h1>{displayNick}</h1>
                  <p className="muted">
                    Не зареган на bb-squad.ru · стата с КВ и логов TR1/TR2
                  </p>
                  <p style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {clanKey ? (
                      <Link
                        className="kv-link"
                        href={`/rating/clan/${encodeURIComponent(clanKey)}`}
                      >
                        клан [{clanTag}] →
                      </Link>
                    ) : null}
                    {enemy ? (
                      <Link
                        className="kv-link"
                        href={`/rating/players/${encodeURIComponent(displayNick)}`}
                      >
                        кросс-рейтинг →
                      </Link>
                    ) : null}
                    <Link className="kv-link" href="/cw">
                      ← КВ
                    </Link>
                  </p>
                </div>
              </div>
            </section>
            {primarySteam ? (
              <ProfileKitsCard
                steamId={primarySteam}
                allowTr1
                initialLane="TR1"
                combatWindow={false}
              />
            ) : null}
          </div>
        </div>

        <div className="profile-area-account">
          <Suspense fallback={<ProfileHeavyFallback label="Загрузка вкладок статы…" />}>
            <ProfileHeavySection nick={displayNick} mode="stats-only" />
          </Suspense>
        </div>

        <div className="profile-area-hitmap">
          {primarySteam ? (
            <ProfileHitmapCard
              steamId={primarySteam}
              nick={displayNick}
              bones={hits.bones}
              lastBone={hits.lastBone}
              subtitle="TR1+TR2"
              matchHistory={[]}
            />
          ) : (
            <section className="card">
              <h2>Попадания</h2>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Steam ещё не связан с ником в логах — попадания появятся после
                захода на TR1/TR2.
              </p>
            </section>
          )}
        </div>

        <div className="profile-area-training">
          {tr1 && tr2 ? (
            <TrainingSessionsCard
              sessions={tr1.sessions}
              presentDays={tr1.presentDays}
              lateDays={tr1.lateDays}
              reserveDays={tr1.reserveDays}
              visitBounds={tr1.visitBounds}
              minutes30d={tr1.minutes30d}
              sessions30d={tr1.sessions30d}
              openNow={tr1.openNow}
              includeMatchHistory={false}
              tr2Lane={{
                sessions: tr2.sessions,
                presentDays: tr2.presentDays,
                lateDays: tr2.lateDays,
                reserveDays: tr2.reserveDays,
                visitBounds: tr2.visitBounds,
                minutes30d: tr2.minutes30d,
                sessions30d: tr2.sessions30d,
                openNow: tr2.openNow,
              }}
            />
          ) : (
            <section className="card">
              <h2>Посещаемость</h2>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Нет сессий TR1/TR2 по этому нику в логах.
              </p>
            </section>
          )}
        </div>

        <Suspense fallback={<ProfileHeavyFallback label="Загрузка истории КВ…" />}>
          <ProfileHeavySection nick={displayNick} mode="histories-only" />
        </Suspense>
      </main>
    );
  }

  const isSelf = session.user.steamId === user.steamId;
  if (isSelf) redirect("/profile");

  const avatar = withAvatarCacheBust(user.avatarUrl, user.updatedAt);
  const inReserve = isActiveReserve(user.reserveUntil);
  const nickForKv = user.nick || "";
  const isBb = await isBlackberryClanMember(user.steamId);
  const isExternalClan = user.clanMemberships.some((m) => m.clan.isExternal);
  // BB и соперники (DCAI…) — TR1+TR2; остальные паблик
  const kitsAllowTr = isBb || isExternalClan;
  const kitsLane = kitsAllowTr ? "TR1" : "PB1";

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

  // Slim critical path — combat/histories stream via Suspense.
  const [training, publicAtt, publicRp, trainPwr] = await Promise.all([
    loadUserTrainingStats(user.id),
    loadUserPublicAttendanceStats(user.id).catch(() => ({
      sessions: [],
      presentDays: [] as string[],
      lateDays: [] as string[],
      visitBounds: {} as Record<
        string,
        { joinHm: string; leaveHm: string | null }
      >,
      minutes30d: 0,
      sessions30d: 0,
      openNow: false,
    })),
    nickForKv
      ? lookupPlayerPublicRp(nickForKv).catch(() => null)
      : Promise.resolve(null),
    nickForKv
      ? lookupPlayerTrainPwr(nickForKv).catch(() => null)
      : Promise.resolve(null),
  ]);

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
          <ProfilePublicRatingCard
            nick={nickForKv}
            rp={publicRp?.rp ?? null}
            rankLabel={publicRp?.rankLabel ?? null}
            rankKey={publicRp?.rankKey ?? null}
            combat={null}
            matches={publicRp?.matches ?? []}
          />
          <ProfileKitsCard
            userId={user.id}
            allowTr1={kitsAllowTr}
            initialLane={kitsLane}
            combatWindow={isBb}
          />
          {nickForKv ? <ProfileCareerCard nick={nickForKv} /> : null}
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
        {nickForKv ? (
          <Suspense fallback={<ProfileHeavyFallback label="Загрузка вкладок статы…" />}>
            <ProfileHeavySection nick={nickForKv} mode="stats-only" />
          </Suspense>
        ) : null}
      </div>

      <div className="profile-area-hitmap">
        <ProfileHitmapCard
          userId={user.id}
          nick={nickForKv || user.nick || undefined}
          subtitle="TR1+TR2"
          matchHistory={[]}
        />
      </div>

      <div className="profile-area-training">
        <TrainingSessionsCard
          sessions={training.tr1.sessions}
          presentDays={training.tr1.presentDays}
          lateDays={training.tr1.lateDays}
          reserveDays={training.tr1.reserveDays}
          visitBounds={training.tr1.visitBounds}
          minutes30d={training.tr1.minutes30d}
          sessions30d={training.tr1.sessions30d}
          openNow={training.tr1.openNow}
          includeMatchHistory={false}
          tr2Lane={{
            sessions: training.tr2.sessions,
            presentDays: training.tr2.presentDays,
            lateDays: training.tr2.lateDays,
            reserveDays: training.tr2.reserveDays,
            visitBounds: training.tr2.visitBounds,
            minutes30d: training.tr2.minutes30d,
            sessions30d: training.tr2.sessions30d,
            openNow: training.tr2.openNow,
          }}
          publicLane={{
            sessions: publicAtt.sessions,
            presentDays: publicAtt.presentDays,
            lateDays: publicAtt.lateDays,
            visitBounds: publicAtt.visitBounds,
            minutes30d: publicAtt.minutes30d,
            sessions30d: publicAtt.sessions30d,
            openNow: publicAtt.openNow,
          }}
        />
      </div>

      {nickForKv ? (
        <Suspense fallback={<ProfileHeavyFallback label="Загрузка историй матчей…" />}>
          <ProfileHeavySection
            nick={nickForKv}
            mode="histories-only"
            defaultHistTab={isBb ? "train" : "public"}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
