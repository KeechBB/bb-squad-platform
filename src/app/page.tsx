import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function HomePage() {
  const session = await getSession();
  if (session?.user?.steamId && !session.user.profileComplete) {
    redirect("/register");
  }

  return (
    <main className="home-stub">
      <div className="home-stub-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="home-crest"
          src="/blackberry.png"
          alt="BlackBerry"
          width={200}
          height={200}
        />
        <h1>BLACKBERRY</h1>
        <p className="home-stub-label">В разработке</p>
        {!session?.user ? (
          <p className="muted home-stub-hint">
            Войди через Steam сверху, чтобы открыть профиль и кланы.
          </p>
        ) : (
          <p className="muted home-stub-hint">
            Разделы:{" "}
            <Link href="/cw">Клановые войны</Link>
            {" · "}
            <Link href="/clans">Кланы</Link>
            {" · "}
            <Link href="/profile">Профиль</Link>
          </p>
        )}
      </div>
    </main>
  );
}
