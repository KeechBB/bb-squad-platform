import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://keechbb.github.io/blackberry-kv";
/** Fallback if github.io still 301s to the custom domain without SSL */
const UPSTREAM_HTTP = "http://kv.bb-squad.ru";

function targetUrl(pathParts: string[] | undefined, search: string): string {
  const clean = (pathParts ?? []).filter((p) => p && p !== ".." && !p.includes(".."));
  const path = clean.length ? clean.join("/") : "index.html";
  return `${UPSTREAM}/${path}${search}`;
}

async function proxy(req: NextRequest, pathParts: string[] | undefined) {
  const search = req.nextUrl.search || "";
  const url = targetUrl(pathParts, search);

  let res = await fetch(url, {
    redirect: "manual",
    headers: {
      Accept: req.headers.get("accept") || "*/*",
      "User-Agent": "bb-squad-kv-proxy/1",
    },
    cache: "no-store",
  });

  // Follow one hop server-side (never leak Location to the browser — that caused
  // https://bb-squad.ru iframe → http://kv.bb-squad.ru mixed-content blank pages).
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      const next = loc.startsWith("http")
        ? loc
        : new URL(loc, url).toString();
      // Prefer http kv host if github sent us there; fetch from VPS/server OK.
      const follow = next.replace(
        /^https:\/\/kv\.bb-squad\.ru/i,
        UPSTREAM_HTTP
      );
      res = await fetch(follow, {
        redirect: "follow",
        headers: {
          Accept: req.headers.get("accept") || "*/*",
          "User-Agent": "bb-squad-kv-proxy/1",
        },
        cache: "no-store",
      });
    }
  }

  if (!res.ok && res.status === 404) {
    // last resort: try http kv directly
    const clean = (pathParts ?? []).filter((p) => p && p !== "..");
    const path = clean.length ? clean.join("/") : "index.html";
    res = await fetch(`${UPSTREAM_HTTP}/${path}${search}`, {
      redirect: "follow",
      cache: "no-store",
    });
  }

  const buf = await res.arrayBuffer();
  const contentType =
    res.headers.get("content-type") ||
    (url.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : url.endsWith(".css")
        ? "text/css; charset=utf-8"
        : url.endsWith(".json")
          ? "application/json; charset=utf-8"
          : "text/html; charset=utf-8");

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=30, must-revalidate");
  // Explicitly allow framing on same site
  headers.delete("X-Frame-Options");
  headers.delete("Content-Security-Policy");

  return new Response(buf, { status: res.status, headers });
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function HEAD(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const res = await proxy(req, path);
  return new Response(null, { status: res.status, headers: res.headers });
}
