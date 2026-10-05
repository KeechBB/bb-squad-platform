import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getHomeDashboardData } from "@/lib/homePageData";
import { HomeMonthCalendar } from "@/components/HomeMonthCalendar";
import { HomePanels } from "@/components/HomePanels";
import { HomeFit } from "@/components/HomeFit";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (session?.user?.steamId && !session.user.profileComplete) {
    redirect("/register");
  }

  const { previews, pwrBoard, tierBoard, publicTop } = await getHomeDashboardData();

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

      <HomeFit>
        <div className="home-side">
          <HomeMonthCalendar previews={previews} />
          <HomePanels
            pwrBoard={pwrBoard}
            publicTop={publicTop}
            tierBoard={tierBoard}
          />
        </div>

        <section className="home-hero" aria-label="BlackBerry">
          <div className="home-hero-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="home-crest"
              src="/blackberry.png"
              alt=""
              width={280}
              height={280}
            />
            <p className="home-hero-kicker">Squad - Фруктовый сад</p>
            <h1>BLACKBERRY</h1>
            <p className="home-hero-tag">
              Платформа клана BlackBerry — Рейтинг, Аналитика, статистика.
            </p>
          </div>
        </section>
      </HomeFit>
    </main>
  );
}
