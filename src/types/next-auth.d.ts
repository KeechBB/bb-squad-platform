import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      steamId: string;
      steamName?: string | null;
      steamAvatar?: string | null;
      avatarUrl?: string | null;
      name?: string | null;
      nick?: string | null;
      age?: number | null;
      profileComplete: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    steamId?: string;
    steamName?: string | null;
    steamAvatar?: string | null;
    avatarUrl?: string | null;
    name?: string | null;
    nick?: string | null;
    age?: number | null;
    profileComplete?: boolean;
  }
}
