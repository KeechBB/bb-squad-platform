import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Providers } from "@/components/Providers";
import { AuthBar } from "@/components/AuthBar";
import { SiteNav } from "@/components/SiteNav";
import { SiteOnlineBadge } from "@/components/SiteOnlineBadge";
import { getSession } from "@/lib/auth";
import { isAnyClanMember } from "@/lib/clanAccess";
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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
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
    (await isAnyClanMember(session?.user?.steamId));
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
