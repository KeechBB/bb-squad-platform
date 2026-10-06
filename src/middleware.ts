import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  STAGING_GATE_COOKIE,
  isStagingRequestHost,
  stagingGateEnabled,
  stagingGateSecret,
  verifyStagingGateToken,
} from "@/lib/stagingGate";

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

function withPathHeader(req: NextRequest, pathname: string, gatePage = false) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-bb-pathname", pathname);
  if (gatePage) requestHeaders.set("x-bb-staging-gate", "1");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

async function stagingGateOk(req: NextRequest): Promise<boolean> {
  if (!stagingGateEnabled()) return true;
  const token = req.cookies.get(STAGING_GATE_COOKIE)?.value;
  return verifyStagingGateToken(token, stagingGateSecret());
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Staging draft password gate (ONLY on staging host) ---
  const onStagingHost = isStagingRequestHost(req.headers.get("host"));
  if (stagingGateEnabled() && onStagingHost) {
    const unlocked = await stagingGateOk(req);
    const isGatePage = pathname === "/staging-gate";
    const isGateApi = pathname.startsWith("/api/staging-gate");
    const isNextAsset =
      pathname.startsWith("/_next/") ||
      pathname === "/favicon.ico" ||
      pathname === "/favicon-32.png" ||
      pathname === "/icon.png" ||
      pathname === "/apple-icon.png" ||
      pathname.startsWith("/brand/");

    if (!unlocked) {
      if (isGateApi || isNextAsset) {
        return withPathHeader(req, pathname, isGatePage);
      }
      if (isGatePage) {
        return withPathHeader(req, pathname, true);
      }
      // Block APIs / kv / pages — no data leak without password
      if (pathname.startsWith("/api/") || pathname.startsWith("/kv-static")) {
        return NextResponse.json({ error: "staging locked" }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/staging-gate";
      url.search = "";
      url.searchParams.set(
        "from",
        pathname + (req.nextUrl.search || ""),
      );
      return NextResponse.redirect(url);
    }
  }

  if (pathname === "/staging-gate") {
    // Gate page only exists on staging; elsewhere go home
    if (stagingGateEnabled() && onStagingHost) {
      return NextResponse.redirect(new URL("/", req.url));
    }
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
