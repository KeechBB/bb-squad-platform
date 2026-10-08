import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClanMapClient } from "@/components/ClanMapClient";
import { isAnyClanMember } from "@/lib/clanAccess";

export const dynamic = "force-dynamic";

export default async function ClanMapPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isAnyClanMember(session.user.steamId))) {
    redirect("/clans");
  }

  return (
    <main>
      <ClanMapClient />
    </main>
  );
}
