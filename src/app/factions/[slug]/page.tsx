import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import { readFactionPageLayout } from "@/lib/factionPageLayout";
import { FactionPageClient } from "@/components/FactionPageClient";

type Props = { params: Promise<{ slug: string }> };

export default async function FactionPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const [loaded, layout] = await Promise.all([
    loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null),
    readFactionPageLayout(),
  ]);
  if (loaded.error || !loaded.view) notFound();
  return <FactionPageClient initial={loaded.view} initialLayout={layout} />;
}
