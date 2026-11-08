import { cookies } from "next/headers";
import { ProfilePageClient } from "@/components/ProfilePageClient";
import { emptyProfileView, profileView } from "../../fixtures";

export default async function Page() {
  const empty = (await cookies()).get("bb-preview-state")?.value === "empty";
  return <ProfilePageClient initialNick="DemoRaven" initialView={empty ? emptyProfileView : profileView} />;
}
