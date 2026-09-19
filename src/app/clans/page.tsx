import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function ClansPage() {
  const session = await getSession();
  if (session?.user?.steamId && !session.user.profileComplete) {
    redirect("/register");
  }

  const clans = await prisma.clan.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { members: true } },
      leader: { select: { nick: true } },
    },
  });

  return (
    <main className="clans-page">
      <section className="hero clans-hero">
        <div>
          <p className="eyebrow">кланы</p>
          <h1>Кланы</h1>
          <p className="lead">Создай клан, зови игроков, смотри состав и стату.</p>
        </div>
        {session?.user?.profileComplete ? (
          <Link className="btn primary" href="/clans/new">
            Создать клан
          </Link>
        ) : (
          <p className="muted">Войди и заверши профиль, чтобы создать клан.</p>
        )}
      </section>

      {clans.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Кланов пока нет. Будь первым — нажми «Создать клан».
          </p>
        </section>
      ) : (
        <div className="clan-list">
          {clans.map((c) => (
            <Link key={c.id} className="clan-row" href={`/clans/${c.id}`}>
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="clan-row-logo" src={c.logoUrl} alt="" width={48} height={48} />
              ) : (
                <div className="clan-row-logo clan-row-logo-empty">{c.tag.slice(0, 2)}</div>
              )}
              <div className="clan-row-body">
                <strong>
                  [{c.tag}] {c.name}
                </strong>
                <span className="muted">
                  Глава: {c.leader.nick || "—"} · игроков: {c._count.members}
                </span>
              </div>
              <span className="clan-row-arrow">→</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
