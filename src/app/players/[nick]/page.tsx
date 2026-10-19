import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ProfilePageClient } from "@/components/ProfilePageClient";
import { TrainingSessionsCard } from "@/components/TrainingSessionsCard";
import { ProfileHitmapCard } from "@/components/ProfileHitmapCard";
import { getEnemyPlayer } from "@/lib/crossRating";
import { ProfileKitsCard } from "@/components/ProfileKitsCard";
import {
  ProfileHeavyFallback,
  ProfileHeavySection,
} from "@/components/ProfileHeavySection";
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
              dayOffDays={tr1.dayOffDays}
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
                dayOffDays: tr2.dayOffDays,
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

  return <ProfilePageClient subjectNick={user.nick || nick} />;
}
