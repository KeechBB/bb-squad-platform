import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function isPublicAsset(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/kv-static")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/ingest")) return true;
  if (pathname.startsWith("/api/sessions/ingest")) return true;
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return true;
  return false;
}

/** Гость: главная, паблик. Кланы/стрельба — страница с окном Steam. */
function guestAllowed(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/public" || pathname.startsWith("/public/")) return true;
  if (pathname === "/clans" || pathname.startsWith("/clans/")) return true;
  if (pathname === "/aim" || pathname.startsWith("/aim/")) return true;
  return false;
}

function withPathHeader(req: NextRequest, pathname: string) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-bb-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/staging-gate" || pathname.startsWith("/api/staging-gate")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isPublicAsset(pathname)) {
    return withPathHeader(req, pathname);
  }

  if (pathname.startsWith("/api/")) {
    return withPathHeader(req, pathname);
  }

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthed = Boolean(token?.steamId);
  const complete = Boolean(token?.profileComplete);

  if (!isAuthed) {
    if (guestAllowed(pathname)) {
      return withPathHeader(req, pathname);
    }
    const url = new URL("/", req.url);
    url.searchParams.set("login", "1");
    return NextResponse.redirect(url);
  }

  if (!complete) {
    if (pathname.startsWith("/register")) {
      return withPathHeader(req, pathname);
    }
    // гости+регистрация: те же публичные страницы + анкета
    if (guestAllowed(pathname)) {
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
