import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /kv-static: disk via nginx alias or Next route (data/kv-cache). No GitHub Pages.
  compress: true,
  // Не блокировать прод-деплой на существующих nullability warnings в admin routes.
  typescript: { ignoreBuildErrors: true },

  // После деплоя браузер не должен держать старый HTML/RSC.
  // Хэшированные /_next/static/* по-прежнему можно кешировать надолго.
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Guest-facing public rating shell + JSON API (disk snapshot is source of truth).
      {
        source: "/public",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
          },
        ],
      },
      {
        source: "/api/public/rating-page",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
