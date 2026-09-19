import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";

export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  return { session, error: null };
}
