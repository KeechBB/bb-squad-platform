import { redirect } from "next/navigation";
import { AdminPanelka } from "@/components/AdminPanelka";
import { getSession } from "@/lib/auth";
import { getUserRole, isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import { canViewSiteVisits } from "@/lib/requireAdmin";
import "./panelka.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Панель серверов · BlackBerry Squad",
};

export default async function PanelkaPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) redirect("/profile");
  const role = await getUserRole(session.user.steamId);
  if (!canViewSiteVisits(role)) redirect("/admin");
  return (
    <main className="panelka-page">
      <AdminPanelka />
    </main>
  );
}
