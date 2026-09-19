import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { CLAN_ROLE_LABEL, type ClanRole } from "@/lib/clan";
import { withAvatarCacheBust } from "@/lib/avatar";

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
        },
      },
    },
  });

  if (!user) {
    return (
      <main className="profile-grid">
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
        </section>
        <p>
          <Link className="kv-link" href="/cw">
            ← К клановым войнам
          </Link>
        </p>
      </main>
    );
  }

  const isSelf = session.user.steamId === user.steamId;
  if (isSelf) redirect("/profile");

  const avatar = withAvatarCacheBust(user.avatarUrl, user.updatedAt);
  const inReserve = isActiveReserve(user.reserveUntil);

  return (
    <main className="profile-grid">
      <section className="card profile-head-public">
        <div className="profile-head-row">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="admin-user-avatar"
              src={avatar}
              alt=""
              width={96}
              height={96}
            />
          ) : (
            <div className="admin-user-avatar admin-user-avatar-empty">
              {(user.nick || "?").slice(0, 1)}
            </div>
          )}
          <div className="profile-head-text">
            <p className="eyebrow">профиль игрока</p>
            <h1>{user.nick}</h1>
            <p className="muted">{user.name || "—"}</p>
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

      <section className="card">
        <h2>Аккаунт</h2>
        <div className="meta-row">
          <span>Ник</span>
          <span>{user.nick}</span>
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
          <span>Steam</span>
          <span>{user.steamName || "—"}</span>
        </div>
      </section>

      {user.clanMemberships.length > 0 ? (
        <section className="card">
          <h2>Клан</h2>
          <div className="clan-list" style={{ marginTop: 8 }}>
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
                    {inReserve && m.role === "RESERVE" ? " · в резерве" : ""}
                  </span>
                </div>
                <span className="clan-row-arrow">→</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <p>
        <Link className="kv-link" href="/clans">
          ← К кланам
        </Link>
      </p>
    </main>
  );
}
