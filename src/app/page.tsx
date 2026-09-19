import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { buildUpcomingMatchPreviews } from "@/lib/kvForecast";
import { HomeUpcomingMatches } from "@/components/HomeUpcomingMatches";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (session?.user?.steamId && !session.user.profileComplete) {
    redirect("/register");
  }

  let previews: Awaited<
    ReturnType<typeof buildUpcomingMatchPreviews>
  >["previews"] = [];
  try {
    const data = await buildUpcomingMatchPreviews(5);
    previews = data.previews;
  } catch {
    previews = [];
  }

  return (
    <main className="home-page">
      <HomeUpcomingMatches previews={previews} />

      <div className="home-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="home-crest"
          src="/blackberry.png"
          alt="BlackBerry"
          width={200}
          height={200}
        />
        <h1>BLACKBERRY</h1>
        <p className="home-stub-label">Squad · платформа клана</p>
        {!session?.user ? (
          <p className="muted home-stub-hint">
            Войди через Steam сверху, чтобы открыть профиль и кланы.
          </p>
        ) : (
          <p className="muted home-stub-hint">
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
