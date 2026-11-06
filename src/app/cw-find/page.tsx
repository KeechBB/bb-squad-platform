import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { sessionIsClanMember } from "@/lib/clanAccess";
import { ClanCwRegistrationPanel } from "@/components/ClanCwRegistrationPanel";

export const dynamic = "force-dynamic";

export default async function CwFindPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await sessionIsClanMember(session))) {
    redirect("/clans");
  }

  return (
    <main className="cw-find-page">
      <section className="hero" style={{ marginBottom: 16 }}>
        <p className="eyebrow">клановые войны</p>
        <h1>Поиск КВ</h1>
        <p className="lead">Создай заявку или прими вызов другого клана.</p>
      </section>
      <ClanCwRegistrationPanel />
    </main>
  );
}
