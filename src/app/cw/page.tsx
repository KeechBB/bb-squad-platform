import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { sessionIsClanMember } from "@/lib/clanAccess";
import { liveKvBust } from "@/lib/kvBust";
import { KvAutoHeightFrame } from "@/components/KvAutoHeightFrame";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ clan?: string; tab?: string }>;
};

export default async function CwPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await sessionIsClanMember(session))) {
    redirect("/clans");
  }

  const sp = searchParams ? await searchParams : {};
  const clan = sp.clan ? String(sp.clan) : "";
  const tab = sp.tab ? String(sp.tab) : "";
  const hash =
    tab === "rating" ? "#/cw/rating" : tab === "analytics" ? "#/cw/analytics" : "#/cw";
  const bust = await liveKvBust("20261103-cw-map-all");
  const params = new URLSearchParams({ embed: "1", v: bust });
  if (clan) params.set("clan", clan);
  const q = `?${params.toString()}${hash}`;

  return (
    <div className="cw-page-shell">
      {clan ? (
        <p className="cw-clan-filter muted">
          Фильтр клана в календаре: <strong>[{clan}]</strong> — введи в поиск
          клана на таблице.
        </p>
      ) : null}
      <KvAutoHeightFrame
        src={`/kv-static/index.html${q}`}
        title="Клановые войны BlackBerry"
      />
    </div>
  );
}
