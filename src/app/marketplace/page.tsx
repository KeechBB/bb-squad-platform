import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { MarketplaceClient } from "@/components/MarketplaceClient";

export const dynamic = "force-dynamic";

/** Пока только Keech — публичный релиз после эквайринга. */
export default async function MarketplacePage() {
  const session = await getServerSession(authOptions);
  const steamId = session?.user?.steamId || null;
  if (!isBuiltinSuperAdmin(steamId)) notFound();

  return (
    <main className="market-shell">
      <MarketplaceClient
        loggedIn={Boolean(steamId && session?.user?.profileComplete)}
      />
    </main>
  );
}
