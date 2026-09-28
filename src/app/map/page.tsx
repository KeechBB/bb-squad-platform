import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClanMapClient } from "@/components/ClanMapClient";

export const dynamic = "force-dynamic";

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
