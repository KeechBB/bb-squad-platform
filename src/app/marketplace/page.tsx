import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { MarketplaceClient } from "@/components/MarketplaceClient";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const session = await getServerSession(authOptions);
  const steamId = session?.user?.steamId || null;

  return (
    <main className="market-shell">
      <MarketplaceClient
        loggedIn={Boolean(steamId && session?.user?.profileComplete)}
      />
    </main>
  );
}
