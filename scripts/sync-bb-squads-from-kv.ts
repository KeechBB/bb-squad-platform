/**
 * VPS / local: sync BB Main/Junior from KV cache via Prisma.
 *   npx tsx scripts/sync-bb-squads-from-kv.ts
 */
import { syncBbSquadsFromKv } from "../src/lib/bbStackAuto";

async function main() {
  const res = await syncBbSquadsFromKv();
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
