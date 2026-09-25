import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { CLAN_ROLE_LABEL, type ClanRole } from "@/lib/clan";
import { withAvatarCacheBust } from "@/lib/avatarUrl";
import {
  discordProfileUrl,
  formatDiscordDisplay,
  formatTelegramDisplay,
  telegramProfileUrl,
} from "@/lib/social";
import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { TrainingSessionsCard } from "@/components/TrainingSessionsCard";
import { LivePageRefresh } from "@/components/LivePageRefresh";
import { ProfileKvStats } from "@/components/ProfileKvStats";
import { SitePresenceBadge } from "@/components/SitePresenceBadge";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { buildPlayerKvStats } from "@/lib/kvStats";
import { lookupPlayerTrainPwr, buildPlayerTrainMatchHistory } from "@/lib/homeTrainPwr";
import { ReactionBestCard } from "@/components/ReactionBestCard";
import { ProfileTrainPwrCard } from "@/components/ProfileTrainPwrCard";

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
  const training = await loadUserTrainingStats(user.id);
  let kvStats = null as Awaited<ReturnType<typeof buildPlayerKvStats>> | null;
  let kvError: string | null = null;
  if (user.nick) {
    try {
      kvStats = await buildPlayerKvStats(user.nick);
    } catch {
      kvError = "Не удалось загрузить стату КВ";
    }
  }

  let trainPwr = null as Awaited<ReturnType<typeof lookupPlayerTrainPwr>>;
  let matchHistory: Awaited<ReturnType<typeof buildPlayerTrainMatchHistory>> = [];
  if (user.nick) {
    try {
      trainPwr = await lookupPlayerTrainPwr(user.nick);
    } catch {
      trainPwr = null;
    }
    try {
      matchHistory = await buildPlayerTrainMatchHistory(user.nick);
    } catch {
      matchHistory = [];
    }
  }

  const [reactionBest, reactionBestL1, reactionBestL2, reactionHistory] =
    await Promise.all([
      prisma.reactionRun.findFirst({
        where: { userId: user.id, level: 1 },
        orderBy: { avgMs: "asc" },
        select: { avgMs: true },
      }),
      prisma.reactionRun.findFirst({
        where: { userId: user.id, level: 1 },
        orderBy: { avgMs: "asc" },
        select: { avgMs: true },
      }),
      prisma.reactionRun.findFirst({
        where: { userId: user.id, level: 2 },
        orderBy: { avgMs: "desc" },
        select: { avgMs: true },
      }),
      prisma.reactionRun.findMany({
        where: { userId: user.id, level: { in: [1, 2] } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, avgMs: true, level: true, createdAt: true },
      }),
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
          {user.clanMemberships.length > 0 ? (
            <section className="card profile-clan-card">
              <h2>Клан</h2>
              <div className="clan-list profile-clan-list">
                {user.clanMemberships.map((m) => (
                  <Link key={m.id} className="clan-row" href={`/clans/${m.clan.id}`}>
                    {m.clan.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="clan-row-logo"
                        src={m.clan.logoUrl}
                        alt=""
                        width={40}
                        height={40}
                      />
                    ) : (
                      <div className="clan-row-logo clan-row-logo-empty">
                        {m.clan.tag.slice(0, 2)}
                      </div>
                    )}
                    <div className="clan-row-body">
                      <strong>
                        [{m.clan.tag}] {m.clan.name}
                      </strong>
                      <span className="muted">
                        {CLAN_ROLE_LABEL[m.role as ClanRole]}
                        {m.title?.name ? ` · ${m.title.name}` : ""}
                        {inReserve && m.role === "RESERVE" ? " · в резерве" : ""}
                      </span>
                    </div>
                    <span className="clan-row-arrow">→</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          <ProfileTrainPwrCard stats={trainPwr} />
        </div>
      </div>

      <div className="profile-area-account">
        <section className="card">
          <h2>Аккаунт</h2>
          <div className="profile-account-meta">
            <div className="meta-row">
              <span>Ник</span>
              <span>{user.nick}</span>
            </div>
            <div className="meta-row">
              <span>№ регистрации</span>
              <span>{user.regNo ?? "—"}</span>
            </div>
            <div className="meta-row">
              <span>Роль на сайте</span>
              <span>
                {roleLabel(effectiveRole(user.steamId, user.role as AppRole))}
              </span>
            </div>
            <div className="meta-row">
              <span>Имя</span>
              <span>{user.name || "—"}</span>
            </div>
            <div className="meta-row">
              <span>Возраст</span>
              <span>{user.age ?? "—"}</span>
            </div>
            <div className="meta-row">
              <span>Discord</span>
              <span>
                {(() => {
                  const label = formatDiscordDisplay(user.discordTag, user.discordId);
                  const url = discordProfileUrl(user.discordId);
                  if (!label) return "—";
                  if (url) {
                    return (
                      <a className="contact-link" href={url} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    );
                  }
                  return label;
                })()}
              </span>
            </div>
            <div className="meta-row">
              <span>Telegram</span>
              <span>
                {(() => {
                  const label = formatTelegramDisplay(user.telegram);
                  const url = telegramProfileUrl(user.telegram);
                  if (!label || !url) return label || "—";
                  return (
                    <a className="contact-link" href={url} target="_blank" rel="noreferrer">
                      {label}
                    </a>
                  );
                })()}
              </span>
            </div>
            <div className="meta-row">
              <span>Steam</span>
              <span>{user.steamId || "—"}</span>
            </div>
          </div>
        </section>
        <ProfileKvStats stats={kvStats} error={kvError} />
      </div>

      <div className="profile-area-training">
        <ReactionBestCard
          bestAvgMs={reactionBest?.avgMs ?? null}
          bestL1={reactionBestL1?.avgMs ?? null}
          bestL2={reactionBestL2?.avgMs ?? null}
          history={reactionHistory.map((h) => ({
            id: h.id,
            avgMs: h.avgMs,
            level: h.level,
            createdAt: h.createdAt.toISOString(),
          }))}
        />
        <LivePageRefresh intervalMs={15000} />
        <TrainingSessionsCard
          sessions={training.sessions}
          presentDays={training.presentDays}
          lateDays={training.lateDays}
          visitBounds={training.visitBounds}
          minutes30d={training.minutes30d}
          sessions30d={training.sessions30d}
          openNow={training.openNow}
          matchHistory={matchHistory}
        />
      </div>
    </main>
  );
}
