import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /kv-static is served by src/app/kv-static/[[...path]]/route.ts
  // (rewrites to github.io forwarded 301→http://kv and blanked HTTPS iframes)

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
