import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import nextDynamic from "next/dynamic";

export const dynamic = "force-dynamic";

const ClanMapClient = nextDynamic(
  () => import("@/components/ClanMapClient").then((m) => m.ClanMapClient),
  {
    ssr: false,
    loading: () => (
      <main className="clan-map-page">
        <div className="clan-map-status">Загрузка карты…</div>
      </main>
    ),
  }
);

export default async function ClanMapPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  return (
    <main>
      <ClanMapClient />
    </main>
  );
}
