import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NetSelfPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");
  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { nick: true },
  });
  if (!user?.nick) redirect("/profile");
  redirect(`/profile/web/${encodeURIComponent(user.nick)}`);
}
