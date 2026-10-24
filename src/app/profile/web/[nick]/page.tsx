import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { NetPageClient } from "@/components/NetPageClient";
import "@/app/net.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ nick: string }> };

export async function generateMetadata({ params }: Props) {
  const { nick } = await params;
  return { title: `Сеть · ${decodeURIComponent(nick)}` };
}

export default async function NetProfilePage({ params }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");
  const { nick: raw } = await params;
  const nick = decodeURIComponent(raw).trim();
  if (!nick) notFound();
  return <NetPageClient nick={nick} />;
}
