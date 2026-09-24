import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /kv-static is served by src/app/kv-static/[[...path]]/route.ts
  // (rewrites to github.io forwarded 301→http://kv and blanked HTTPS iframes)
};

export default nextConfig;
