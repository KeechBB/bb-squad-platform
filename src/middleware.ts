import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function isPublicAsset(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/kv-static")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/ingest")) return true;
  if (pathname.startsWith("/api/sessions/ingest")) return true;
  // files with extension (png, css, etc.)
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return true;
  return false;
}

function withPathHeader(req: NextRequest, pathname: string) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-bb-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // EMERGENCY: staging password wall fully disabled (was locking bb-squad.ru).
  if (pathname === "/staging-gate" || pathname.startsWith("/api/staging-gate")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isPublicAsset(pathname)) {
    return withPathHeader(req, pathname);
  }

  // API routes: leave existing route-level auth (except we don't block guests here).
  if (pathname.startsWith("/api/")) {
    return withPathHeader(req, pathname);
  }

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthed = Boolean(token?.steamId);
  const complete = Boolean(token?.profileComplete);

  // Guests: only home. Any other click/deep-link → login.
  if (!isAuthed) {
    if (pathname === "/") {
      return withPathHeader(req, pathname);
    }
    const url = new URL("/", req.url);
    url.searchParams.set("login", "1");
    return NextResponse.redirect(url);
  }

  // Steam ok, анкета не завершена — только регистрация.
  if (!complete) {
    if (pathname.startsWith("/register")) {
      return withPathHeader(req, pathname);
    }
    return NextResponse.redirect(new URL("/register", req.url));
  }

  if (pathname.startsWith("/register")) {
    return NextResponse.redirect(new URL("/profile", req.url));
  }

  return withPathHeader(req, pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
