import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CreateClanForm } from "@/components/CreateClanForm";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function NewClanPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: {
      clanMemberships: {
        take: 1,
        include: { clan: { select: { id: true, tag: true, name: true } } },
      },
    },
  });
  const current = me?.clanMemberships[0]?.clan;
  if (current) {
    return (
      <main>
        <section className="hero">
          <p className="eyebrow">кланы</p>
          <h1>Создать клан</h1>
          <p className="lead">
            Ты уже в [{current.tag}] {current.name}. Сначала выйди из текущего
            клана — потом можно создать новый.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link className="btn primary" href={`/clans/${current.id}`}>
              Открыть мой клан
            </Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">кланы</p>
        <h1>Создать клан</h1>
        <p className="lead">Название, тег и логотип с прозрачным фоном.</p>
      </section>
      <CreateClanForm />
    </main>
  );
}
