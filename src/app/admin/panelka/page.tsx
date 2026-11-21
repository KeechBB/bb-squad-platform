import { redirect } from "next/navigation";
import { AdminPanelka } from "@/components/AdminPanelka";
import { getSession } from "@/lib/auth";
import {
  getUserRole,
  isAdmin,
  isPublicPanelRole,
  syncBuiltinAdmins,
} from "@/lib/admin";
import { canAccessPanelka } from "@/lib/roles";
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
  if (!canAccessPanelka(role)) redirect("/admin");
  const panelkaOnly = isPublicPanelRole(role);
  return (
    <main className="panelka-page">
      <AdminPanelka
        backHref={panelkaOnly ? "/profile" : "/admin"}
        backLabel={panelkaOnly ? "В профиль" : "К админке"}
      />
    </main>
  );
}
