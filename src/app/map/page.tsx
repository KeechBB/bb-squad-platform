import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClanMapClient } from "@/components/ClanMapClient";
import { isBlackberryClanMember } from "@/lib/blackberryClan";

export const dynamic = "force-dynamic";

export default async function ClanMapPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isBlackberryClanMember(session.user.steamId))) {
    redirect("/");
  }

  return (
    <main>
      <ClanMapClient />
    </main>
  );
}
