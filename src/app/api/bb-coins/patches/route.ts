import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import {
  buyMarketPatch,
  loadMarketPatchCatalog,
  sellMarketPatch,
} from "@/lib/bbCoinPatchMarket";

export const dynamic = "force-dynamic";

async function requireKeechUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return { error: NextResponse.json({ ok: false, error: "auth" }, { status: 401 }) };
  }
  if (!isBuiltinSuperAdmin(session.user.steamId)) {
    return {
      error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }),
    };
  }
  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, profileComplete: true, steamId: true },
  });
  if (!user?.profileComplete) {
    return {
      error: NextResponse.json({ ok: false, error: "profile" }, { status: 403 }),
    };
  }
  return { user };
}

export async function GET() {
  const gate = await requireKeechUser();
  if ("error" in gate && gate.error) return gate.error;
  const { user } = gate as {
    user: { id: string; steamId: string; profileComplete: boolean };
  };
  const patches = await loadMarketPatchCatalog({
    userId: user.id,
    steamId: user.steamId,
  });
  return NextResponse.json({ ok: true, patches });
}

export async function POST(req: Request) {
  const gate = await requireKeechUser();
  if ("error" in gate && gate.error) return gate.error;
  const { user } = gate as {
    user: { id: string; steamId: string; profileComplete: boolean };
  };

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    patchId?: string;
  };
  const action = String(body.action || "");
  const patchId = String(body.patchId || "");

  if (action === "buy") {
    const res = await buyMarketPatch({
      userId: user.id,
      steamId: user.steamId,
      patchId,
    });
    if (!res.ok) {
      const status =
        res.error === "insufficient"
          ? 402
          : res.error === "owned"
            ? 409
            : 400;
      return NextResponse.json(res, { status });
    }
    return NextResponse.json(res);
  }

  if (action === "sell") {
    const res = await sellMarketPatch({
      userId: user.id,
      steamId: user.steamId,
      patchId,
    });
    if (!res.ok) {
      const status = res.error === "not_owned" ? 409 : 400;
      return NextResponse.json(res, { status });
    }
    return NextResponse.json(res);
  }

  return NextResponse.json({ ok: false, error: "action" }, { status: 400 });
}
