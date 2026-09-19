import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AvatarEditor } from "@/components/AvatarEditor";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { ClanInvites } from "@/components/ClanInvites";
import { ReservePanel } from "@/components/ReservePanel";
import { AdminPanelLink } from "@/components/AdminPanelLink";
import { ProfileEditForm } from "@/components/ProfileEditForm";
import { formatRuDate, isActiveReserve } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfilePage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const u = session.user;
  const displayAvatar = u.avatarUrl || null;
  await syncBuiltinAdmins();
  const admin = await isAdmin(u.steamId);

  const me = await prisma.user.findUnique({
    where: { steamId: u.steamId },
    include: {
      clanMemberships: {
        include: { clan: { select: { id: true, name: true, tag: true, logoUrl: true } } },
      },
      clanInvites: {
        where: { status: "PENDING" },
        include: {
          clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
          inviter: { select: { nick: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!me) redirect("/");

  const invites =
    me.clanInvites.map((inv) => ({
      id: inv.id,
      clan: inv.clan,
      inviter: inv.inviter,
    })) || [];

  const clans = me.clanMemberships.map((m) => m.clan) || [];
  const reserveActive = isActiveReserve(me.reserveUntil);
  const reserveUntilLabel =
    me.reserveUntil && reserveActive ? formatRuDate(me.reserveUntil) : null;

  const birthRu = me.birthDate ? formatRuDate(me.birthDate) : null;

  return (
    <main className="profile-grid">
      <AvatarEditor
        nick={me.nick || u.nick || "Игрок"}
        name={me.name || u.name || ""}
        initialAvatar={displayAvatar}
        steamAvatar={u.steamAvatar || null}
      />

      <ClanInvites initial={invites} />

      <ReservePanel
        active={reserveActive}
        untilLabel={reserveUntilLabel}
        reason={reserveActive ? me.reserveReason || null : null}
      />

      {clans.length > 0 ? (
        <section className="card">
          <h2>Клан</h2>
          <div className="clan-list" style={{ marginTop: 8 }}>
            {clans.map((c) => (
              <Link key={c.id} className="clan-row" href={`/clans/${c.id}`}>
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="clan-row-logo" src={c.logoUrl} alt="" width={40} height={40} />
                ) : (
                  <div className="clan-row-logo clan-row-logo-empty">{c.tag.slice(0, 2)}</div>
                )}
                <div className="clan-row-body">
                  <strong>
                    [{c.tag}] {c.name}
                  </strong>
                  <span className="muted">Открыть страницу клана</span>
                </div>
                <span className="clan-row-arrow">→</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <ProfileEditForm
        initial={{
          nick: me.nick || "",
          name: me.name || "",
          birthDate: birthRu,
          age: me.age,
          discordTag: me.discordTag,
          discordId: me.discordId,
          telegram: me.telegram,
          steamId: me.steamId,
          steamName: me.steamName,
        }}
        adminLink={<AdminPanelLink initialAdmin={admin} />}
      />

      <section className="stats-stub">
        <strong style={{ color: "var(--ink)" }}>Статистика</strong>
        <p style={{ margin: "8px 0 0" }}>
          Скоро: КВ, тренировки, K/D. Пока смотри таблицу слотов в аккаунте.
        </p>
        <Link className="kv-link" href="/cw">
          Таблица КВ →
        </Link>
      </section>
    </main>
  );
}
