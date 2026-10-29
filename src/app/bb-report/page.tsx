import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** Публичный URL закрыт — отчёт только во вкладке Админ → Посещения → Отчет. */
export default async function BbReportPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (await isAdmin(session.user.steamId)) redirect("/admin");
  redirect("/profile");
}
