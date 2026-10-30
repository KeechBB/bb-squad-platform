import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAnyClanMember } from "@/lib/clanAccess";
import { liveKvBust } from "@/lib/kvBust";
import { KvAutoHeightFrame } from "@/components/KvAutoHeightFrame";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<{ tab?: string }> };

export default async function TrainingMatchesPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isAnyClanMember(session.user.steamId))) {
    redirect("/clans");
  }

  const sp = searchParams ? await searchParams : {};
  const tab = sp.tab || "";
  const hash =
    tab === "growth"
      ? "#/tm/growth"
      : tab === "rating"
        ? "#/tm/rating"
        : tab === "hits"
          ? "#/tm/hits"
          : "#/tm";

  const bust = await liveKvBust();
  const matchParams = new URLSearchParams({
    embed: "1",
    hideTiers: "1",
    v: bust,
  });
  const iframeSrc = `/kv-static/index.html?${matchParams.toString()}${hash}`;

  return (
    <KvAutoHeightFrame
      src={iframeSrc}
      title="Тренировочные матчи BlackBerry"
    />
  );
}
