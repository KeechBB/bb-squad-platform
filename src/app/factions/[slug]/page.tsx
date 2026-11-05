import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import { readUserFactionPageLayout, defaultFactionPageLayout } from "@/lib/factionPageLayout";
import { FactionPageClient } from "@/components/FactionPageClient";

type Props = { params: Promise<{ slug: string }> };

export default async function FactionPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session?.user?.steamId ?? null
  );
  if (loaded.error || !loaded.view) notFound();
  const personal = loaded.view.keech || loaded.view.canManage;
  const layout =
    personal && loaded.me?.id
      ? await readUserFactionPageLayout(loaded.view.id, loaded.me.id, {
          keech: loaded.view.keech,
        })
      : defaultFactionPageLayout();
  return <FactionPageClient initial={loaded.view} initialLayout={layout} />;
}
