import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { factionPath, factionSlugForSteam } from "@/lib/factions";

export const dynamic = "force-dynamic";

export default async function MyFactionPage() {
  const session = await getSession();
  const slug = await factionSlugForSteam(session?.user?.steamId);
  if (slug) redirect(factionPath(slug));

  return (
    <main className="wip-stub-page">
      <div className="wip-stub-card" role="status">
        <p className="wip-stub-kicker">Моя фракция</p>
        <h1>Ты пока не во фракции</h1>
        <p className="wip-stub-note">
          Когда глава пригласит и ты примешь приглашение в колокольчике, эта кнопка откроет страницу фракции.
        </p>
        <Link href="/" className="wip-stub-back">
          ← На главную
        </Link>
      </div>
    </main>
  );
}
