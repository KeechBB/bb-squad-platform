#!/usr/bin/env node
/** Поминутный сэмпл CPU / RAM / NVMe → data/sys-load/samples.jsonl (без tsx). */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "data", "sys-load");
const samplesPath = path.join(dir, "samples.jsonl");
const prevCpuPath = path.join(dir, "prev-cpu.json");
const MAX_LINES = 60 * 24 * 40;

function gb(bytes) {
  return Math.round((bytes / 1024 ** 3) * 100) / 100;
}

async function readMem() {
  const raw = await fs.readFile("/proc/meminfo", "utf8");
  const get = (key) => {
    const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return m ? Number(m[1]) : 0;
  };
  return {
    totalKb: get("MemTotal"),
    availableKb: get("MemAvailable") || get("MemFree"),
  };
}

async function readLoad() {
  const raw = await fs.readFile("/proc/loadavg", "utf8");
  const p = raw.trim().split(/\s+/);
  return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
}

async function readCpuTimes() {
  const raw = await fs.readFile("/proc/stat", "utf8");
  const line = raw.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return { idle: 0, total: 0 };
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return { idle, total };
}

async function readDisk() {
  try {
    const { stdout } = await execFileAsync("df", [
      "-B1",
      "--output=used,size,target",
      "/",
    ]);
    const row = (stdout.trim().split("\n")[1] || "").trim().split(/\s+/);
    return {
      used: Number(row[0]) || 0,
      total: Number(row[1]) || 0,
      mount: row[2] || "/",
    };
  } catch {
    return { used: 0, total: 0, mount: "/" };
  }
}

const mem = await readMem();
const load = await readLoad();
const cpuNow = await readCpuTimes();
const disk = await readDisk();

let cpuPct = 0;
try {
  const prev = JSON.parse(await fs.readFile(prevCpuPath, "utf8"));
  const dIdle = cpuNow.idle - prev.idle;
  const dTotal = cpuNow.total - prev.total;
  if (dTotal > 0) {
    cpuPct = Math.round((1 - dIdle / dTotal) * 1000) / 10;
    cpuPct = Math.max(0, Math.min(100, cpuPct));
  }
} catch {
  /* первый запуск */
}
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(prevCpuPath, JSON.stringify(cpuNow), "utf8");

const ramTotalGb = gb(mem.totalKb * 1024);
const ramUsedGb = gb((mem.totalKb - mem.availableKb) * 1024);
const sample = {
  t: Date.now(),
  cpuPct,
  load1: load[0],
  load5: load[1],
  load15: load[2],
  ramUsedGb,
  ramTotalGb,
  ramPct: ramTotalGb > 0 ? Math.round((ramUsedGb / ramTotalGb) * 1000) / 10 : 0,
  diskUsedGb: gb(disk.used),
  diskTotalGb: gb(disk.total),
  diskPct:
    disk.total > 0 ? Math.round((disk.used / disk.total) * 1000) / 10 : 0,
  diskMount: disk.mount,
};

await fs.appendFile(samplesPath, JSON.stringify(sample) + "\n", "utf8");
try {
  const lines = (await fs.readFile(samplesPath, "utf8")).split("\n").filter(Boolean);
  if (lines.length > MAX_LINES) {
    await fs.writeFile(samplesPath, lines.slice(-MAX_LINES).join("\n") + "\n", "utf8");
  }
} catch {
  /* empty */
}
console.log(
  JSON.stringify({
    ok: true,
    t: sample.t,
    cpu: sample.cpuPct,
    ram: sample.ramPct,
    disk: sample.diskPct,
  })
);
