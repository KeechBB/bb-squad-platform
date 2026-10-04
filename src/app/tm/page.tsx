import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isBlackberryClanMember } from "@/lib/blackberryClan";

/** Меняй при обновлении KV, чтобы iframe не брал старый кэш */
const KV_CACHE = "20261005-harju";

export default async function TrainingMatchesPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isBlackberryClanMember(session.user.steamId))) {
    redirect("/");
  }

  const params = new URLSearchParams({ embed: "1", v: KV_CACHE });
  const q = `?${params.toString()}#/tm`;

  return (
    <div className="cw-embed">
      <iframe
        className="cw-frame"
        src={`/kv-static/index.html${q}`}
        title="Тренировочные матчи BlackBerry"
        allow="fullscreen"
      />
    </div>
  );
}
