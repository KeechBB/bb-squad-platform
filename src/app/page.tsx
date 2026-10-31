import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getHomeDashboardData } from "@/lib/homePageData";
import { HomePanels } from "@/components/HomePanels";
import { HomeFit } from "@/components/HomeFit";
import { HomeLoginPrompt } from "@/components/HomeLoginPrompt";
import { HomeTournamentAnnounce } from "@/components/HomeTournamentAnnounce";
import type { HomeCwCard } from "@/components/HomeCwAnnounce";
import {
  nextCwAnnounces,
  readyNicks,
  viewerGoing,
  viewerIsBlackberry,
  type CwAnnounce,
} from "@/lib/cwReady";
import { syncCwMails } from "@/lib/cwMailSync";
import { syncTournamentEliminationMails } from "@/lib/tournamentEliminationMail";

export const dynamic = "force-dynamic";

async function toCard(
  slot: CwAnnounce | null,
  userId: string
): Promise<HomeCwCard | null> {
  if (!slot) return null;
  const ready = await readyNicks(slot.id);
  const going = await viewerGoing(slot.id, userId);
  return { ...slot, ready, going };
}

export default async function HomePage() {
  const session = await getSession();
  if (session?.user?.steamId && !session.user.profileComplete) {
    redirect("/register");
  }

  const { publicTop } = await getHomeDashboardData();
  await syncCwMails();
  await syncTournamentEliminationMails();
  const userId = session?.user?.id || "";
  const showCw = await viewerIsBlackberry(userId);
  let cwMain: HomeCwCard | null = null;
  let cwJunior: HomeCwCard | null = null;
  if (showCw) {
    const next = await nextCwAnnounces();
    cwMain = await toCard(next.main, userId);
    cwJunior = await toCard(next.junior, userId);
  }

  return (
    <main className="home-page">
      <Suspense fallback={null}>
        <HomeLoginPrompt />
      </Suspense>
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
          <div className="home-info-row">
            <aside className="home-welcome-plaque" aria-label="О платформе">
              <p className="home-welcome-plaque-title">BLACKBERRY</p>
              <p className="home-welcome-plaque-sub">
                Автоматизированная игровая платформа
              </p>
              <p className="home-welcome-plaque-lead">
                Добро пожаловать на официальный портал сообщества BlackBerry Squad.
              </p>
              <p className="home-welcome-plaque-body">
                Здесь <strong>подробная</strong> аналитика. Игровые серверы полностью{" "}
                <strong>синхронизированы</strong> с платформой:{" "}
                <strong>каждый</strong> фраг, выстрел, время и другие показатели
                фиксируются в <strong>реальном времени</strong> — объективная оценка
                ваших навыков. Цель — прозрачная соревновательная экосистема для всех{" "}
                <strong>игроков</strong> и участников <strong>кланов</strong>.
              </p>
            </aside>
          </div>
          <HomeTournamentAnnounce />
          <HomePanels
            publicTop={publicTop}
            viewerNick={session?.user?.nick || null}
            showCw={showCw}
            cwMain={cwMain}
            cwJunior={cwJunior}
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
