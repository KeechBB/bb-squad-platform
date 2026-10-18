import { ProfilePageClient } from "@/components/ProfilePageClient";

/**
 * Лёгкий shell: HTML отдаётся сразу, данные — /api/profile/shell + view-data.
 * Тяжёлый SSR (ladders/combat/histories в page) убран — он давал 3–5с TTFB.
 */
export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return <ProfilePageClient />;
}
