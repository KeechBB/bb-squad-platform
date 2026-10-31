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
              <p className="home-welcome-plaque-note">
                Стартовал первый <strong>турнир</strong> Fruit Strike — регистрация
                открыта для всех желающих.
              </p>
            </aside>
            <a
              className="home-discord-link"
              href="https://discord.gg/UptthuJ3a"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord сервер BlackBerry"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
                />
              </svg>
              <span className="home-discord-link-title">DISCORD</span>
              <span className="home-discord-link-hint">наш сервер</span>
            </a>
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
