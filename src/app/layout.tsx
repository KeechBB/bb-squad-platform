import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";
import { AuthBar } from "@/components/AuthBar";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { isBlackberryClanMember } from "@/lib/blackberryClan";
import { getCurrentBetaLabel } from "@/lib/siteReleases";
import "@fontsource/oxanium/400.css";
import "@fontsource/oxanium/600.css";
import "@fontsource/oxanium/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlackBerry Squad",
  description: "Платформа клана BlackBerry — Squad",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const showClanMap =
    Boolean(session?.user?.steamId) &&
    Boolean(session?.user?.profileComplete) &&
    (await isBlackberryClanMember(session?.user?.steamId));
  const betaLabel = getCurrentBetaLabel();

  return (
    <html lang="ru">
      <body>
        <Providers>
          <header className="site-top">
            <div className="site-top-inner">
              <div className="top-left">
                <Link className="brand" href="/" title="Главная">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/blackberry.png" alt="BlackBerry" width={56} height={56} />
                  <strong>BLACKBERRY</strong>
                </Link>
                <nav className="top-nav" aria-label="Разделы">
                  <Link href="/">
                    <span className="nav-full">Главная</span>
                    <span className="nav-short">Глав</span>
                  </Link>
                  <Link href="/cw" title="Клановые войны">
                    <span className="nav-full">Клановые войны</span>
                    <span className="nav-short">КВ</span>
                  </Link>
                  <Link href="/rating" title="Рейтинг кланов">
                    <span className="nav-full">Рейтинг кланов</span>
                    <span className="nav-short">Рейтинг</span>
                  </Link>
                  <Link href="/tm" title="Тренировочные матчи">
                    <span className="nav-full">Тренировочные матчи</span>
                    <span className="nav-short">Трен.</span>
                  </Link>
                  <Link href="/clans">
                    <span className="nav-full">Кланы</span>
                    <span className="nav-short">Кланы</span>
                  </Link>
                  <Link href="/aim" title="Тренировка стрельбы">
                    <span className="nav-full">Тренировка стрельбы</span>
                    <span className="nav-short">Стрельба</span>
                  </Link>
                  {showClanMap ? (
                    <Link href="/map" title="Карта клана">
                      <span className="nav-full">Карта клана</span>
                      <span className="nav-short">Карта</span>
                    </Link>
                  ) : null}
                </nav>
              </div>
              <AuthBar betaLabel={betaLabel} />
            </div>
          </header>
          <div className="shell">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
