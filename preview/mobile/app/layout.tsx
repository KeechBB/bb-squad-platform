import type { Viewport } from "next";
import { cookies } from "next/headers";
import { PreviewShell } from "../shell";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/oxanium/400.css";
import "@fontsource/oxanium/600.css";
import "@fontsource/oxanium/700.css";
import "../../../src/app/globals.css";
import "../../../src/app/profile-v2.css";
import "../../../src/app/mobile.css";
import "../preview.css";

// Match the production viewport until the mobile viewport is implemented there.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true, viewportFit: "cover" };
export const metadata = { title: "BlackBerry · Local UI preview" };

export default async function Layout({ children }: { children: React.ReactNode }) {
  const empty = (await cookies()).get("bb-preview-state")?.value === "empty";
  return <html lang="ru"><body><PreviewShell empty={empty}>{children}</PreviewShell></body></html>;
}
