import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { TmSapperRatingClient } from "@/components/TmSapperRatingClient";

export const dynamic = "force-dynamic";

/** Личный рейтинг сапёров BB (логи TR) — только Keech. */
export default async function TmSapperPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!isBuiltinSuperAdmin(session.user.steamId)) redirect("/tm");

  return (
    <main className="tm-sapper-page">
      <TmSapperRatingClient />
    </main>
  );
}
