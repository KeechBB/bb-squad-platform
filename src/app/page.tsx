import Link from "next/link";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

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
          Нажми «Войти через Steam» сверху. После первого входа заполним имя,
          ник и возраст — и ты в системе.
        </p>
        <Link className="kv-link" href="https://kv.bb-squad.ru/">
          Таблица КВ (публичная) →
        </Link>
      </section>
    </main>
  );
}
