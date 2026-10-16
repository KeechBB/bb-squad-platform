/**
 * Сэмплы нагрузки plaza: CPU / RAM / NVMe (корневой FS).
 * Пишется cron'ом в data/sys-load/samples.jsonl
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SysLoadSample = {
  t: number; // unix ms
  cpuPct: number;
  load1: number;
  load5: number;
  load15: number;
  ramUsedGb: number;
  ramTotalGb: number;
  ramPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  diskPct: number;
  diskMount: string;
};

export type SysLoadRange = "minutes" | "hours" | "days";

const DIR = () =>
  path.join(process.cwd(), "data", "sys-load");
const SAMPLES = () => path.join(DIR(), "samples.jsonl");
const PREV_CPU = () => path.join(DIR(), "prev-cpu.json");

const MAX_LINES = 60 * 24 * 40; // ~40 суток поминутно

function gb(bytes: number) {
  return Math.round((bytes / 1024 ** 3) * 100) / 100;
}

async function readMem(): Promise<{
  totalKb: number;
  availableKb: number;
}> {
  const raw = await fs.readFile("/proc/meminfo", "utf8");
  const get = (key: string) => {
    const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return m ? Number(m[1]) : 0;
  };
  return {
    totalKb: get("MemTotal"),
    availableKb: get("MemAvailable") || get("MemFree"),
  };
}

async function readLoad(): Promise<[number, number, number]> {
  const raw = await fs.readFile("/proc/loadavg", "utf8");
  const p = raw.trim().split(/\s+/);
  return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
}

async function readCpuTimes(): Promise<{ idle: number; total: number }> {
  const raw = await fs.readFile("/proc/stat", "utf8");
  const line = raw.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return { idle: 0, total: 0 };
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] || 0) + (parts[4] || 0); // idle + iowait
  const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return { idle, total };
}

async function readDisk(): Promise<{
  used: number;
  total: number;
  mount: string;
}> {
  try {
    const { stdout } = await execFileAsync("df", ["-B1", "--output=used,size,target", "/"]);
    const lines = stdout.trim().split("\n");
    const row = (lines[1] || "").trim().split(/\s+/);
    return {
      used: Number(row[0]) || 0,
      total: Number(row[1]) || 0,
      mount: row[2] || "/",
    };
  } catch {
    return { used: 0, total: 0, mount: "/" };
  }
}

async function ensureDir() {
  await fs.mkdir(DIR(), { recursive: true });
}

/** Снять текущий сэмпл и дописать в jsonl. */
export async function takeSysLoadSample(): Promise<SysLoadSample> {
  await ensureDir();
  const [mem, load, cpuNow, disk] = await Promise.all([
    readMem(),
    readLoad(),
    readCpuTimes(),
    readDisk(),
  ]);

  let cpuPct = 0;
  try {
    const prevRaw = await fs.readFile(PREV_CPU(), "utf8");
    const prev = JSON.parse(prevRaw) as { idle: number; total: number };
    const dIdle = cpuNow.idle - prev.idle;
    const dTotal = cpuNow.total - prev.total;
    if (dTotal > 0) {
      cpuPct = Math.round((1 - dIdle / dTotal) * 1000) / 10;
      cpuPct = Math.max(0, Math.min(100, cpuPct));
    }
  } catch {
    /* первый запуск — 0 */
  }
  await fs.writeFile(PREV_CPU(), JSON.stringify(cpuNow), "utf8");

  const ramTotalGb = gb(mem.totalKb * 1024);
  const ramUsedGb = gb((mem.totalKb - mem.availableKb) * 1024);
  const ramPct =
    ramTotalGb > 0
      ? Math.round((ramUsedGb / ramTotalGb) * 1000) / 10
      : 0;
  const diskTotalGb = gb(disk.total);
  const diskUsedGb = gb(disk.used);
  const diskPct =
    diskTotalGb > 0
      ? Math.round((diskUsedGb / diskTotalGb) * 1000) / 10
      : 0;

  const sample: SysLoadSample = {
    t: Date.now(),
    cpuPct,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    ramUsedGb,
    ramTotalGb,
    ramPct,
    diskUsedGb,
    diskTotalGb,
    diskPct,
    diskMount: disk.mount,
  };

  await fs.appendFile(SAMPLES(), JSON.stringify(sample) + "\n", "utf8");
  await trimSamplesFile();
  return sample;
}

async function trimSamplesFile() {
  try {
    const raw = await fs.readFile(SAMPLES(), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length <= MAX_LINES) return;
    const keep = lines.slice(-MAX_LINES);
    await fs.writeFile(SAMPLES(), keep.join("\n") + "\n", "utf8");
  } catch {
    /* empty */
  }
}

async function readAllSamples(): Promise<SysLoadSample[]> {
  try {
    const raw = await fs.readFile(SAMPLES(), "utf8");
    const out: SysLoadSample[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as SysLoadSample);
      } catch {
        /* skip bad */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/** Агрегация для дней — почасовые точки. */
function aggregateHourly(samples: SysLoadSample[]): SysLoadSample[] {
  const buckets = new Map<number, SysLoadSample[]>();
  for (const s of samples) {
    const hour = Math.floor(s.t / 3_600_000) * 3_600_000;
    const arr = buckets.get(hour) || [];
    arr.push(s);
    buckets.set(hour, arr);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, arr]) => {
      const last = arr[arr.length - 1];
      return {
        t: hour,
        cpuPct: avg(arr.map((x) => x.cpuPct)),
        load1: avg(arr.map((x) => x.load1)),
        load5: avg(arr.map((x) => x.load5)),
        load15: avg(arr.map((x) => x.load15)),
        ramUsedGb: avg(arr.map((x) => x.ramUsedGb)),
        ramTotalGb: last.ramTotalGb,
        ramPct: avg(arr.map((x) => x.ramPct)),
        diskUsedGb: avg(arr.map((x) => x.diskUsedGb)),
        diskTotalGb: last.diskTotalGb,
        diskPct: avg(arr.map((x) => x.diskPct)),
        diskMount: last.diskMount,
      };
    });
}

export async function querySysLoad(range: SysLoadRange): Promise<{
  range: SysLoadRange;
  now: SysLoadSample | null;
  series: SysLoadSample[];
  sampleCount: number;
}> {
  const all = await readAllSamples();
  const now = all.length ? all[all.length - 1] : null;
  const tNow = Date.now();
  let from = tNow;
  if (range === "minutes") from = tNow - 60 * 60_000; // 60 мин
  else if (range === "hours") from = tNow - 24 * 3_600_000; // 24 ч
  else from = tNow - 14 * 24 * 3_600_000; // 14 дней

  let series = all.filter((s) => s.t >= from);
  if (range === "days") series = aggregateHourly(series);

  return {
    range,
    now,
    series,
    sampleCount: series.length,
  };
}
