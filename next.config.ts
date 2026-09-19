import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/kv-static",
        destination: "http://kv.bb-squad.ru/",
      },
      {
        source: "/kv-static/:path*",
        destination: "http://kv.bb-squad.ru/:path*",
      },
    ];
  },
};

export default nextConfig;
