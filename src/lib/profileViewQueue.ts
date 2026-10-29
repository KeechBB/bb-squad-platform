import { promises as fs } from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "data", "cache", "profiles", ".stale");

/** Ник, чей файл профиля надо переписать в ближайшем проходе cron. */
export async function markProfileViewStale(nick: string): Promise<void> {
  const name = nick.trim();
  if (!name) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${name}\n`, "utf8");
}

/** Забирает до limit ников из очереди и оставляет хвост на следующий проход. */
export async function takeStaleNicks(limit: number): Promise<string[]> {
  let raw = "";
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const unique: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const name = line.trim();
    if (!name) continue;
    if (unique.some((u) => u.toLowerCase() === name.toLowerCase())) continue;
    unique.push(name);
  }
  const take = unique.slice(0, Math.max(0, limit));
  const rest = unique.slice(take.length);
  if (rest.length) await fs.writeFile(file, `${rest.join("\n")}\n`, "utf8");
  else await fs.unlink(file).catch(() => undefined);
  return take;
}
