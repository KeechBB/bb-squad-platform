import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function HomePage() {
  const session = await getSession();
  if (session?.user?.steamId && !session.user.profileComplete) {
    redirect("/register");
  }
  if (session?.user?.profileComplete) {
    redirect("/profile");
  }

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">bbsquad · platform</p>
        <h1>BLACKBERRY</h1>
        <p className="lead">
          Клановая платформа Squad. Войди через Steam, укажи ник латиницей —
          аккаунт сразу готов. Статистика профиля появится позже.
        </p>
      </section>

      <section className="card">
        <h2>Как начать</h2>
        <p className="muted">
          Нажми «Войти» сверху. После первого входа заполним имя, ник и возраст —
          и ты в системе. Таблица КВ смотришь уже из аккаунта.
        </p>
        <Link className="kv-link" href="/cw">
          Таблица КВ →
        </Link>
      </section>
    </main>
  );
}
