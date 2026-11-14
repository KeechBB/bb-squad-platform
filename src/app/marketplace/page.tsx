import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isBuiltinSuperAdmin, isSuperAdmin } from "@/lib/admin";
import { MarketplaceClient } from "@/components/MarketplaceClient";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const session = await getServerSession(authOptions);
  const steamId = session?.user?.steamId || null;
  const captain =
    isBuiltinSuperAdmin(steamId) || (await isSuperAdmin(steamId));

  return (
    <main className="market-shell">
      <MarketplaceClient
        loggedIn={Boolean(steamId && session?.user?.profileComplete)}
        isCaptain={captain}
      />
    </main>
  );
}
