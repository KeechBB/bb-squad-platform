import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";
import { AuthBar } from "@/components/AuthBar";
import { SiteNav } from "@/components/SiteNav";
import { SiteOnlineBadge } from "@/components/SiteOnlineBadge";
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
  const showClanSections =
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
                <SiteOnlineBadge />
                <SiteNav showClanSections={showClanSections} />
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
