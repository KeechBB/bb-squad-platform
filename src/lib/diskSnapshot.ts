import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type Envelope<T> = { builtAt: string; data: T };

const inflight = new Map<string, Promise<unknown>>();
const memory = new Map<string, { at: number; data: unknown }>();

export function snapshotFile(rel: string): string {
  return path.join(process.cwd(), "data", "cache", rel);
}

export function snapshotKey(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
}

export async function readSnapshot<T>(
  rel: string
): Promise<{ builtAt: number; data: T } | null> {
  try {
    const raw = await fs.readFile(snapshotFile(rel), "utf8");
    const env = JSON.parse(raw) as Envelope<T>;
    const builtAt = Date.parse(env.builtAt);
    if (!Number.isFinite(builtAt) || env.data == null) return null;
    return { builtAt, data: env.data };
  } catch {
    return null;
  }
}

async function writeSnapshot<T>(rel: string, data: T): Promise<void> {
  const file = snapshotFile(rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const body = JSON.stringify({ builtAt: new Date().toISOString(), data });
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, file);
}

function startBuild<T>(rel: string, build: () => Promise<T>): Promise<T> {
  const pending = inflight.get(rel) as Promise<T> | undefined;
  if (pending) return pending;
  const job = build()
    .then(async (data) => {
      try {
        await writeSnapshot(rel, data);
      } catch {
        /* отдаём посчитанное, даже если диск не записал */
      }
      return data;
    })
    .finally(() => {
      inflight.delete(rel);
    });
  inflight.set(rel, job);
  return job;
}

/**
 * Файл уже есть — отдаём его сразу, даже если он старше freshMs.
 * Пересчёт идёт фоном и подменяет файл. Ждём только самый первый промах.
 */
export async function snapshotOrBuild<T>(
  rel: string,
  freshMs: number,
  build: () => Promise<T>
): Promise<T> {
  const hit = await readSnapshot<T>(rel);
  if (hit) {
    if (Date.now() - hit.builtAt >= freshMs) void startBuild(rel, build);
    return hit.data;
  }
  return startBuild(rel, build);
}

/** Короткий общий кэш внутри процесса для повторных запросов. */
export async function remember<T>(
  key: string,
  freshMs: number,
  build: () => Promise<T>
): Promise<T> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < freshMs) return hit.data as T;
  const data = await build();
  memory.set(key, { at: Date.now(), data });
  if (memory.size > 500) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  return data;
}
