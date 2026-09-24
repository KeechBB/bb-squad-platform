import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/kv-static",
        destination: "https://keechbb.github.io/blackberry-kv/",
      },
      {
        source: "/kv-static/:path*",
        destination: "https://keechbb.github.io/blackberry-kv/:path*",
      },
    ];
  },
};

export default nextConfig;
