import type { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { kvLocalRoots } from "@/lib/kvLocal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve KV UI + JSON from VPS disk only (data/kv-cache). No GitHub Pages. */

function safeRel(pathParts: string[] | undefined): string {
  const clean = (pathParts ?? []).filter(
    (p) => p && p !== ".." && !p.includes("..") && !p.includes("\\") && !p.includes("\0")
  );
  return clean.length ? clean.join("/") : "index.html";
}

function contentTypeFor(rel: string): string {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".html") || lower.endsWith(".htm"))
    return "text/html; charset=utf-8";
  return "application/octet-stream";
}

async function readFromDisk(rel: string): Promise<Buffer | null> {
  for (const root of kvLocalRoots()) {
    const full = path.resolve(root, rel);
    const rootResolved = path.resolve(root);
    if (!full.startsWith(rootResolved + path.sep) && full !== rootResolved) {
      continue;
    }
    try {
      return await fs.readFile(full);
    } catch {
      /* try next root */
    }
  }
  return null;
}

function diskHeaders(rel: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentTypeFor(rel));
  const lower = rel.toLowerCase();
  // JSON + app shell must refresh right after collector auto-ingest
  if (
    lower.endsWith(".json") ||
    lower.endsWith("app.js") ||
    lower.endsWith("index.html")
  ) {
    headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  } else {
    headers.set("Cache-Control", "public, max-age=60, must-revalidate");
  }
  headers.set("X-KV-Source", "vps-disk");
  return headers;
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { path: parts } = await ctx.params;
  const rel = safeRel(parts);
  const buf = await readFromDisk(rel);
  if (!buf) {
    return new Response(
      `KV file not on VPS cache: ${rel}\nRun scripts/sync_kv_cache.sh on the server.`,
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: diskHeaders(rel),
  });
}

export async function HEAD(_req: NextRequest, ctx: Ctx) {
  const { path: parts } = await ctx.params;
  const rel = safeRel(parts);
  const buf = await readFromDisk(rel);
  if (!buf) {
    return new Response(null, { status: 404 });
  }
  return new Response(null, { status: 200, headers: diskHeaders(rel) });
}
