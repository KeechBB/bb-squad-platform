import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /kv-static: disk via nginx alias or Next route (data/kv-cache). No GitHub Pages.
  compress: true,

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
