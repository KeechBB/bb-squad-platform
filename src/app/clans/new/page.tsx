import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CreateClanForm } from "@/components/CreateClanForm";

export default async function NewClanPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

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
