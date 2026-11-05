import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { detectClanLogoMime, CLAN_LOGO_MAX } from "@/lib/clanLogoFile";
import { saveFactionLogo } from "@/lib/factionLogoFile";
import { loadFactionView } from "@/lib/factions";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view?.canEditIdentity) {
    return NextResponse.json({ error: "Логотип ставишь только ты" }, { status: 404 });
  }
  const form = await req.formData();
  const blob = form.get("logo");
  if (!(blob instanceof Blob)) {
    return NextResponse.json({ error: "Нет файла" }, { status: 400 });
  }
  if (blob.size > CLAN_LOGO_MAX) {
    return NextResponse.json({ error: "Логотип больше 5 МБ" }, { status: 400 });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  const mime = detectClanLogoMime(buf);
  if (!mime) {
    return NextResponse.json({ error: "Нужен PNG, JPG или WebP" }, { status: 400 });
  }
  const logoUrl = await saveFactionLogo(loaded.view.id, buf, mime);
  await prisma.faction.update({ where: { id: loaded.view.id }, data: { logoUrl } });
  return NextResponse.json({ ok: true, logoUrl });
}
