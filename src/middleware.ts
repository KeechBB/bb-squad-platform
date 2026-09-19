import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthed = Boolean(token?.steamId);
  const complete = Boolean(token?.profileComplete);

  if (pathname.startsWith("/register")) {
    if (!isAuthed) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    if (complete) {
      return NextResponse.redirect(new URL("/profile", req.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/profile")) {
    if (!isAuthed) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    if (!complete) {
      return NextResponse.redirect(new URL("/register", req.url));
    }
  }

  if (pathname.startsWith("/admin")) {
    if (!isAuthed) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (pathname.startsWith("/clans/new")) {
    if (!isAuthed) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    if (!complete) {
      return NextResponse.redirect(new URL("/register", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/register", "/profile", "/admin/:path*", "/clans/new"],
};
