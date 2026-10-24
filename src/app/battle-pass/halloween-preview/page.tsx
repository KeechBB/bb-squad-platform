import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { HalloweenPreviewClient } from "./HalloweenPreviewClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function HalloweenBattlePassPreviewPage() {
  const session = await getSession();
  if (!session?.user?.steamId || session.user.steamId !== SITE_CREATOR_STEAM_ID) {
    notFound();
  }

  const nick = session.user.nick || session.user.steamName || "Keech";
  return <HalloweenPreviewClient selfNick={nick} />;
}
