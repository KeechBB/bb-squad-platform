import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { buildUpcomingMatchPreviews } from "@/lib/kvForecast";
import { buildHomeMvpBoard } from "@/lib/homeMvp";
import { HomeUpcomingMatches } from "@/components/HomeUpcomingMatches";
import { HomeMvpBoard } from "@/components/HomeMvpBoard";

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
    const data = await buildUpcomingMatchPreviews(8);
    previews = data.previews;
  } catch {
    previews = [];
  }

  let mvpBoard: Awaited<ReturnType<typeof buildHomeMvpBoard>> = {
    train: [],
    main: [],
    junior: [],
    source: "",
    updatedAt: new Date().toISOString(),
  };
  try {
    mvpBoard = await buildHomeMvpBoard();
  } catch {
    /* empty board */
  }

  const loggedIn = Boolean(session?.user);

  return (
    <main className="home-page">
      <div className="home-stage" aria-hidden="true">
        <div className="home-stage-photo" />
        <div className="home-stage-veil" />
        <div className="home-stage-topo" />
        <div className="home-stage-rays" />
        <div className="home-stage-scan" />
        <div className="home-stage-dust">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <svg
          className="home-stage-grid"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="homeGridFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0" />
              <stop offset="45%" stopColor="#a78bfa" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#d946ef" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="url(#homeGridFade)" strokeWidth="0.15" fill="none">
            {Array.from({ length: 12 }, (_, i) => (
              <line
                key={`h${i}`}
                x1="0"
                y1={(i + 1) * (100 / 13)}
                x2="100"
                y2={(i + 1) * (100 / 13)}
              />
            ))}
            {Array.from({ length: 18 }, (_, i) => (
              <line
                key={`v${i}`}
                x1={(i + 1) * (100 / 19)}
                y1="0"
                x2={(i + 1) * (100 / 19)}
                y2="100"
              />
            ))}
          </g>
        </svg>
      </div>

      <div className="home-layout">
        <HomeUpcomingMatches previews={previews} />
        <HomeMvpBoard initial={mvpBoard} />

        <section className="home-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="home-crest"
            src="/blackberry.png"
            alt=""
            width={220}
            height={220}
          />
          <p className="home-hero-kicker">Squad · BlackBerry</p>
          <h1>BLACKBERRY</h1>
          <p className="home-hero-tag">
            Платформа клана — КВ, тренировки, свои.
          </p>
          <div className="home-hero-cta">
            {loggedIn ? (
              <Link className="btn primary" href="/cw">
                Клановые войны
              </Link>
            ) : (
              <p className="home-hero-hint">
                Войди через Steam сверху — откроется профиль и кланы.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
