import type { Metadata } from "next";
import { Oxanium, Manrope } from "next/font/google";
import { Providers } from "@/components/Providers";
import { AuthBar } from "@/components/AuthBar";
import Link from "next/link";
import "./globals.css";

const oxanium = Oxanium({
  subsets: ["latin", "latin-ext"],
  variable: "--font-oxanium",
  weight: ["400", "600", "700"],
});

const manrope = Manrope({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "BlackBerry Squad",
  description: "Платформа клана BlackBerry — Squad",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${oxanium.variable} ${manrope.variable}`}>
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
                  <Link href="/">Главная</Link>
                  <Link href="/cw">Клановые войны</Link>
                  <Link href="/clans">Кланы</Link>
                </nav>
              </div>
              <AuthBar />
            </div>
          </header>
          <div className="shell">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
