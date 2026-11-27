import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import { FactionManagementClient } from "@/components/FactionManagementClient";

type Props = { params: Promise<{ slug: string }> };

export default async function FactionManagementPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session?.user?.steamId ?? null,
  );
  if (loaded.error || !loaded.view) notFound();

  const isMember = Boolean(loaded.view.keech || loaded.view.mySeat);

  return (
    <FactionManagementClient
      initial={loaded.view}
      isMember={isMember}
    />
  );
}
