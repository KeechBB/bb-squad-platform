import { NextResponse } from "next/server";
import {
  STAGING_GATE_COOKIE,
  createStagingGateToken,
  stagingGateEnabled,
  stagingGatePassword,
  stagingGateSecret,
  timingSafeEqualStr,
} from "@/lib/stagingGate";

export const runtime = "nodejs";

/** POST { password } → set httpOnly cookie */
export async function POST(req: Request) {
  if (!stagingGateEnabled()) {
    return NextResponse.json({ error: "gate off" }, { status: 404 });
  }
  const expected = stagingGatePassword();
  if (!expected) {
    return NextResponse.json(
      { error: "STAGING_GATE_PASSWORD not set" },
      { status: 503 },
    );
  }

  let body: { password?: string } = {};
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const got = String(body.password || "");
  if (!timingSafeEqualStr(got, expected)) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  const token = await createStagingGateToken(stagingGateSecret());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAGING_GATE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

/** DELETE → clear cookie (logout from draft) */
export async function DELETE() {
  if (!stagingGateEnabled()) {
    return NextResponse.json({ error: "gate off" }, { status: 404 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAGING_GATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
