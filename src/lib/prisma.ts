import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Default pool is cores*2+1. On this host that is 41 per process, and four
 * site copies plus the profile warmer fill Postgres (max_connections=100).
 * A click then waits pool_timeout (default 10s) several times.
 * BB_PRISMA_CONNECTION_LIMIT=1 on the warmer. The site stays at 4.
 */
function pooledDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return undefined;
  const limit = (process.env.BB_PRISMA_CONNECTION_LIMIT || "4").replace(/\D/g, "") || "4";
  const timeout = (process.env.BB_PRISMA_POOL_TIMEOUT || "2").replace(/\D/g, "") || "2";
  const appName =
    process.env.BB_PRISMA_APP_NAME || (limit === "1" ? "bb-warm" : "bb-squad");
  let url = raw;
  const add = (key: string, value: string) => {
    if (new RegExp(`[?&]${key}=`).test(url)) return;
    url += `${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
  };
  add("connection_limit", limit);
  add("pool_timeout", timeout);
  add("application_name", appName);
  return url;
}

const databaseUrl = pooledDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });

// Always pin on globalThis — avoids duplicate PrismaClient under PM2/Next chunk edges.
globalForPrisma.prisma = prisma;
