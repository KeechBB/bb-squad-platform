/**
 * Majority-кит по залитым тренировочным матчам (не Jensens AFK).
 * spawnedAt в БД — naive timestamp ≈ timeMsk МСК минус 2 часа.
 */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const p = new PrismaClient();
const DB_WALL_OFFSET_MIN = -2 * 60;

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

function naiveFromYmdMinutes(ymd, dayMinutes) {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) + dayMinutes * 60_000);
}

function formatNaive(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
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
    const dayFallback = new Set();
    for (const match of file.matches || []) {
      if (match.status && match.status !== "done") continue;
      if (isJensen(match.map)) continue;
      const day = Number(match.day);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      const ymd = `${ym}-${String(day).padStart(2, "0")}`;
      const t = parseTimeMsk(match.timeMsk);
      const dur = parseDurationSec(match.duration);
      if (!t || !dur || dur < 60) {
        dayFallback.add(ymd);
        continue;
      }
      const startMin = t.h * 60 + t.m + DB_WALL_OFFSET_MIN - 12;
      const endMin =
        t.h * 60 + t.m + DB_WALL_OFFSET_MIN + Math.ceil(dur / 60) + 3;
      windows.push({
        gte: naiveFromYmdMinutes(ymd, startMin),
        lt: naiveFromYmdMinutes(ymd, endMin),
      });
    }
    for (const ymd of dayFallback) {
      windows.push({
        gte: naiveFromYmdMinutes(ymd, 18 * 60 + 30),
        lt: naiveFromYmdMinutes(addDaysYmd(ymd, 1), 60),
      });
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

  const orSql = windows
    .map((w) => {
      const a = formatNaive(w.gte);
      const b = formatNaive(w.lt);
      return `("spawnedAt" >= TIMESTAMP '${a}' AND "spawnedAt" < TIMESTAMP '${b}')`;
    })
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
    source: `uploaded TM windows · ${windows.length} ranges · TR1+TR2 · DB wall MSK-2h`,
    windows: windows.length,
    byNick: by,
  };
  fs.writeFileSync("/tmp/fit-kit-majority.json", JSON.stringify(out));
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
