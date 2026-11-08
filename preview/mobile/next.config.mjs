import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default {
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias["@"] = path.join(root, "src");
    return config;
  },
};
