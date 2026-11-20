import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Providers } from "@/components/Providers";
import { AuthBar } from "@/components/AuthBar";
import { SiteNav } from "@/components/SiteNav";
import { SiteOnlineBadge } from "@/components/SiteOnlineBadge";
import { SiteProfileBg } from "@/components/SiteProfileBg";
import { getSession } from "@/lib/auth";
import { sessionIsClanMember } from "@/lib/clanAccess";
import { getCurrentBetaLabel } from "@/lib/siteReleases";
import { YandexMetrika } from "@/components/YandexMetrika";
import { SiteFooter } from "@/components/SiteFooter";
import { TouchCompact } from "@/components/TouchCompact";
import { prisma } from "@/lib/prisma";
import { normalizeProfileBg } from "@/lib/profileBg";
import "@fontsource/oxanium/400.css";
import "@fontsource/oxanium/600.css";
import "@fontsource/oxanium/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./globals.css";
import "./profile-v2.css";
import "./mobile.css";

const yandexVerification = (
  process.env.NEXT_PUBLIC_YANDEX_WEBMASTER_VERIFICATION || ""
).trim();

export const metadata: Metadata = {
  title: "BlackBerry Squad",
  description: "Платформа клана BlackBerry — Squad",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  ...(yandexVerification
    ? { verification: { yandex: yandexVerification } }
    : {}),
};

/** Ширина экрана телефона, не канва 1440. Иначе мобильные правила не включаются. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const h = await headers();
  const gateOnly = h.get("x-bb-staging-gate") === "1";

  if (gateOnly) {
    return (
      <html lang="ru">
        <body className="stg-gate-body">{children}</body>
      </html>
    );
  }

  const session = await getSession();
  const showClanSections =
    Boolean(session?.user?.steamId) &&
    Boolean(session?.user?.profileComplete) &&
    (await sessionIsClanMember(session));
  const betaLabel = getCurrentBetaLabel();

  let siteProfileBgId: string | null = null;
  if (session?.user?.steamId && session.user.profileComplete) {
    const row = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
      select: { profileBg: true },
    });
    siteProfileBgId = normalizeProfileBg(row?.profileBg);
  }

  return (
    <html lang="ru">
      <body>
        <Providers>
          <SiteProfileBg initialBgId={siteProfileBgId} />
          <TouchCompact />
          <header className="site-top">
            <div className="site-top-inner">
              <div className="top-left">
                <SiteOnlineBadge />
                <SiteNav showClanSections={showClanSections} />
              </div>
              <AuthBar />
            </div>
          </header>
          <div className="shell">{children}</div>
          <SiteFooter betaLabel={betaLabel} />
          <YandexMetrika />
        </Providers>
      </body>
    </html>
  );
}
