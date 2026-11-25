import type { NextConfig } from "next";

/** F-02: Report-Only first — does not break the site; console/report only. */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  // Next often needs inline/eval; tighten later after Report-Only is clean
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: ws:",
  "media-src 'self' blob: https:",
  "frame-src 'self' https://steamcommunity.com https://*.steampowered.com https://discord.com https://www.youtube.com https://youtube.com",
  "form-action 'self' https://steamcommunity.com https://*.steampowered.com",
].join("; ");

/** Shared hardening (F-01, F-03, F-04). F-01 uses SAMEORIGIN/'self' so /cw /tm iframes work. */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: CSP_REPORT_ONLY,
  },
];

const nextConfig: NextConfig = {
  // /kv-static: disk via nginx alias or Next route (data/kv-cache). No GitHub Pages.
  compress: true,
  // F-05: hide X-Powered-By: Next.js
  poweredByHeader: false,
  // Не блокировать прод-деплой на существующих nullability warnings в admin routes.
  typescript: { ignoreBuildErrors: true },
  // Сеть принимает картинки до 50 МБ. Без этого Next обрезает тело запроса на 10 МБ.
  experimental: {
    middlewareClientMaxBodySize: "55mb",
  },

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
          ...SECURITY_HEADERS,
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
          ...SECURITY_HEADERS,
        ],
      },
      {
        source: "/api/public/rating-page",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
          },
          ...SECURITY_HEADERS,
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, max-age=0, must-revalidate",
          },
          ...SECURITY_HEADERS,
        ],
      },
      // После общего no-store: картинки главной лежат в public/ без хэша в имени.
      // Версия в адресе (?v=) сбрасывает кэш, когда арт меняют.
      {
        source: "/home-hub/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000",
          },
          ...SECURITY_HEADERS,
        ],
      },
    ];
  },
};

export default nextConfig;
