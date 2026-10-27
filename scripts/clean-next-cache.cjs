/**
 * npm run build always drops the webpack cache first.
 * A warm cache once republished the old training table (Δ RP)
 * even though the source file already had personal columns.
 */
const fs = require("node:fs");
const path = require("node:path");

const cache = path.join(__dirname, "..", ".next", "cache");
fs.rmSync(cache, { recursive: true, force: true });
console.log("==> cleared .next/cache");
