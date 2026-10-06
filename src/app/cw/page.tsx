import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isBlackberryClanMember } from "@/lib/blackberryClan";
import { liveKvBust } from "@/lib/kvBust";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ clan?: string }>;
};

export default async function CwPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isBlackberryClanMember(session.user.steamId))) {
    redirect("/");
  }

  const sp = searchParams ? await searchParams : {};
  const clan = sp.clan ? String(sp.clan) : "";
  const bust = await liveKvBust("20261006-fox-r2");
  const params = new URLSearchParams({ embed: "1", v: bust });
  if (clan) params.set("clan", clan);
  const q = `?${params.toString()}#/cw`;

  return (
    <div className="cw-embed">
      {clan ? (
        <p className="cw-clan-filter muted">
          Фильтр клана в календаре: <strong>[{clan}]</strong> — введи в поиск клана на таблице.
        </p>
      ) : null}
      <iframe
        className="cw-frame"
        src={`/kv-static/index.html${q}`}
        title="Клановые войны BlackBerry"
        allow="fullscreen"
      />
    </div>
  );
}
