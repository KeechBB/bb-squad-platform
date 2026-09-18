import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { getAuthOptions } from "@/lib/auth";

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ nextauth: string[] }> }
) {
  // next-auth v4 App Router expects params as sync in some versions
  const params = await ctx.params;
  return NextAuth(req, { params } as never, getAuthOptions(req));
}

export { handler as GET, handler as POST };
