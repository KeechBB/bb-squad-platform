import type { NextAuthOptions } from "next-auth";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import SteamProvider from "next-auth-steam";
import { prisma } from "@/lib/prisma";

const callbacks: NextAuthOptions["callbacks"] = {
  async signIn({ account, profile }) {
    if (account?.provider !== "steam" || !profile) return false;
    const steamId =
      (profile as { steamid?: string }).steamid || account.providerAccountId;
    if (!steamId) return false;

    const steamName =
      (profile as { personaname?: string }).personaname ?? null;
    const steamAvatar =
      (profile as { avatarfull?: string }).avatarfull ??
      (profile as { avatarmedium?: string }).avatarmedium ??
      null;

    await prisma.user.upsert({
      where: { steamId },
      create: {
        steamId,
        steamName,
        steamAvatar,
        profileComplete: false,
      },
      update: {
        steamName,
        steamAvatar,
      },
    });
    return true;
  },
  async jwt({ token, account, profile, trigger, session }) {
    if (account?.provider === "steam" && profile) {
      const steamId =
        (profile as { steamid?: string }).steamid ||
        account.providerAccountId;
      token.steamId = steamId;
      token.steamName =
        (profile as { personaname?: string }).personaname ?? null;
      token.steamAvatar =
        (profile as { avatarfull?: string }).avatarfull ?? null;
    }

    if (trigger === "update" && session) {
      const s = session as {
        name?: string;
        nick?: string;
        age?: number;
        profileComplete?: boolean;
      };
      if (s.name !== undefined) token.name = s.name;
      if (s.nick !== undefined) token.nick = s.nick;
      if (s.age !== undefined) token.age = s.age;
      if (s.profileComplete !== undefined)
        token.profileComplete = s.profileComplete;
    }

    if (token.steamId) {
      const user = await prisma.user.findUnique({
        where: { steamId: token.steamId },
      });
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.nick = user.nick;
        token.age = user.age;
        token.steamName = user.steamName;
        token.steamAvatar = user.steamAvatar;
        token.profileComplete = user.profileComplete;
      }
    }
    return token;
  },
  async session({ session, token }) {
    if (session.user) {
      session.user.id = token.id || "";
      session.user.steamId = token.steamId || "";
      session.user.steamName = token.steamName;
      session.user.steamAvatar = token.steamAvatar;
      session.user.name = token.name;
      session.user.nick = token.nick;
      session.user.age = token.age ?? null;
      session.user.profileComplete = Boolean(token.profileComplete);
    }
    return session;
  },
};

/** Options for reading session in Server Components (no Steam provider needed). */
export const authOptions: NextAuthOptions = {
  providers: [],
  session: { strategy: "jwt" },
  callbacks,
  secret: process.env.NEXTAUTH_SECRET,
};

export function getAuthOptions(req: NextRequest): NextAuthOptions {
  return {
    providers: [
      SteamProvider(req, {
        clientSecret: process.env.STEAM_API_KEY!,
        callbackUrl: `${process.env.NEXTAUTH_URL}/api/auth/callback/steam`,
      }),
    ],
    session: { strategy: "jwt" },
    pages: {
      signIn: "/",
      error: "/",
    },
    callbacks,
    secret: process.env.NEXTAUTH_SECRET,
  };
}

export function getSession() {
  return getServerSession(authOptions);
}
