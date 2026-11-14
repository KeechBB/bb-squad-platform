import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { HOME_HUB_WIP_TITLES } from "@/lib/homeHub";

/** Для остальных — WIP; Keech → живая площадка. */
export default async function MarketplaceWipPage() {
  const session = await getServerSession(authOptions);
  if (isBuiltinSuperAdmin(session?.user?.steamId)) {
    redirect("/marketplace");
  }

  const title = HOME_HUB_WIP_TITLES.marketplace;
  return (
    <main className="wip-stub-page">
      <div className="wip-stub-card" role="status">
        <p className="wip-stub-kicker">{title}</p>
        <h1>В РАЗРАБОТКЕ</h1>
        <p className="wip-stub-note">Раздел скоро появится на платформе.</p>
        <Link href="/" className="wip-stub-back">
          ← На главную
        </Link>
      </div>
    </main>
  );
}
