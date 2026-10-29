import { getSession } from "@/lib/auth";
import { ProfilePageClient } from "@/components/ProfilePageClient";
import { readStoredProfileView } from "@/lib/profileViewSnapshot";

/**
 * Первый кадр берёт готовый файл профиля. Пересчёт живёт в cron, не в этом запросе.
 */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getSession();
  const nick = session?.user?.nick?.trim() || "";
  const initialView = nick
    ? await readStoredProfileView(nick).catch(() => null)
    : null;
  return (
    <ProfilePageClient
      initialNick={nick || undefined}
      initialView={initialView}
    />
  );
}
