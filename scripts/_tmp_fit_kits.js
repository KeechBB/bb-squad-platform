/**
 * Majority-кит по залитым тренировочным матчам (не Jensens AFK).
 * Пишет /tmp/fit-kit-majority.json → копируется в KV run_tier_autonomy.sh
 */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const p = new PrismaClient();

function isJensen(map) {
  return String(map || "")
    .toLowerCase()
    .includes("jensen");
}

function parseDurationSec(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "—" || s === "-") return null;
  const parts = s.split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function parseTimeMsk(raw) {
  const s = String(raw || "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return { h, m: min };
}

/** MSK wall → UTC Date (UTC+3). */
function mskWallToUtc(ymd, hour, minute) {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, hour, minute, 0) - 3 * 3600_000);
}

function kvRoots() {
  const roots = [];
  if (process.env.BB_KV_PUBLIC) roots.push(process.env.BB_KV_PUBLIC);
  if (process.env.KV_LOCAL_DIR) roots.push(process.env.KV_LOCAL_DIR);
  roots.push(
    "/var/www/blackberry-kv",
    "/var/www/bb-squad-platform/data/kv-cache",
    path.join(__dirname, "..", "data", "kv-cache"),
    path.join(__dirname, "..", "..", "KV", "public")
  );
  return roots;
}

function readJson(rel) {
  for (const root of kvRoots()) {
    const fp = path.join(root, rel);
    try {
      if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      /* next */
    }
  }
  return null;
}

function loadWindows() {
  const idx = readJson("data/training-index.json");
  const months = (idx && idx.months) || [];
  const windows = [];
  for (const ref of months) {
    const monthId = String((ref && (ref.id || ref.month)) || "").trim();
    let rel = String((ref && ref.url) || "").trim();
    if (rel.startsWith("/kv-static/")) rel = rel.slice("/kv-static/".length);
    if (!rel && monthId) rel = `data/training/${monthId}.json`;
    if (!rel) continue;
    const file = readJson(rel);
    if (!file) continue;
    const ym = String(file.month || monthId || "").trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    for (const match of file.matches || []) {
      if (match.status && match.status !== "done") continue;
      if (isJensen(match.map)) continue;
      const day = Number(match.day);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      const t = parseTimeMsk(match.timeMsk);
      const dur = parseDurationSec(match.duration);
      if (!t || !dur || dur < 60) continue;
      const ymd = `${ym}-${String(day).padStart(2, "0")}`;
      const gte = mskWallToUtc(ymd, t.h, t.m);
      const lt = new Date(gte.getTime() + (dur + 90) * 1000);
      windows.push({ gte, lt });
    }
  }
  return windows;
}

(async () => {
  const windows = loadWindows();
  if (!windows.length) {
    console.error("no uploaded training windows — abort");
    process.exit(1);
  }

  // OR-фрагменты параметризованно через Prisma.join неудобны в rawUnsafe —
  // собираем ISO timestamps (безопасны: только Date.toISOString).
  const orSql = windows
    .map(
      (w) =>
        `("spawnedAt" >= '${w.gte.toISOString()}'::timestamptz AND "spawnedAt" < '${w.lt.toISOString()}'::timestamptz)`
    )
    .join(" OR ");

  const rows = await p.$queryRawUnsafe(`
    SELECT COALESCE(NULLIF(u.nick,''), NULLIF(u."steamName",''), u.name, r."nickAtSpawn") AS nick,
           r.kit, COUNT(*)::int AS n
    FROM "SquadRoleEvent" r
    JOIN "User" u ON u.id = r."userId"
    WHERE r."serverKey" IN ('TR1', 'TR2')
      AND (${orSql})
    GROUP BY 1, 2
    ORDER BY 1, n DESC
  `);

  const by = {};
  for (const row of rows) {
    const k = String(row.nick || "")
      .trim()
      .toLowerCase();
    if (!k) continue;
    if (!by[k]) by[k] = [];
    by[k].push({ kit: row.kit, n: row.n });
  }

  const out = {
    updatedAt: new Date().toISOString(),
    source: `uploaded TM windows · ${windows.length} matches · TR1+TR2`,
    windows: windows.length,
    byNick: by,
  };
  fs.writeFileSync("/tmp/fit-kit-majority.json", JSON.stringify(out));
  // локальный бэкап рядом со скриптом (для git/KV push)
  try {
    const localKv = path.join(__dirname, "..", "..", "KV", "public", "data");
    if (fs.existsSync(localKv)) {
      fs.writeFileSync(
        path.join(localKv, "fit-kit-majority.json"),
        JSON.stringify(out, null, 2) + "\n"
      );
    }
  } catch {
    /* ignore */
  }

  const c = {};
  for (const arr of Object.values(by)) c[arr[0].kit] = (c[arr[0].kit] || 0) + 1;
  console.log(
    "nicks",
    Object.keys(by).length,
    "windows",
    windows.length,
    JSON.stringify(c)
  );
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
