import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canEditOwnClanIdentity,
  isValidClanName,
  isValidClanTag,
  type ClanRole,
} from "@/lib/clan";
import { canEditAnyClanIdentity, getUserRole } from "@/lib/admin";
import {
  CLAN_LOGO_MAX,
  deleteClanLogo,
  detectClanLogoMime,
  saveClanLogo,
} from "@/lib/clanLogoFile";
import { clanLiveChannel, livePublish } from "@/lib/liveBus";
import { personLabel, writeActionLog } from "@/lib/actionLog";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { id: clanId } = await ctx.params;
  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true, name: true, steamName: true, role: true },
  });
  if (!me) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const appRole = await getUserRole(session.user.steamId);
  const membership = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: me.id } },
    select: { role: true },
  });
  const asLeader = canEditOwnClanIdentity(membership?.role as ClanRole | undefined);
  const asSite = canEditAnyClanIdentity(appRole);
  if (!asSite && !asLeader) {
    return NextResponse.json({ error: "Нет прав менять карточку клана" }, { status: 403 });
  }

  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, name: true, logoUrl: true },
  });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const name = String(form.get("name") || "").trim();
  const tag = String(form.get("tag") || "")
    .trim()
    .toUpperCase();
  const removeLogo =
    String(form.get("removeLogo") || "") === "1" ||
    String(form.get("removeLogo") || "").toLowerCase() === "true";
  const logo = form.get("logo");

  if (!isValidClanName(name)) {
    return NextResponse.json({ error: "Название: 2–40 символов" }, { status: 400 });
  }
  if (!isValidClanTag(tag)) {
    return NextResponse.json(
      { error: "Тег: 1–7 символов без пробелов" },
      { status: 400 }
    );
  }

  if (tag !== clan.tag) {
    const taken = await prisma.clan.findFirst({
      where: { tag, NOT: { id: clanId } },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json({ error: "Такой тег уже занят" }, { status: 409 });
    }
  }

  let logoUrl: string | null | undefined = undefined;
  if (removeLogo) {
    await deleteClanLogo(clanId);
    logoUrl = null;
  } else if (logo && typeof logo !== "string" && "arrayBuffer" in logo) {
    const blob = logo as Blob;
    if (blob.size > 0) {
      if (blob.size > CLAN_LOGO_MAX) {
        return NextResponse.json({ error: "Лого до 5 МБ (png/webp)" }, { status: 400 });
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      const mime = detectClanLogoMime(buf);
      if (!mime) {
        return NextResponse.json(
          { error: "Лого: только png или webp (с прозрачностью)" },
          { status: 400 }
        );
      }
      logoUrl = await saveClanLogo(clanId, buf, mime);
    }
  }

  const updated = await prisma.clan.update({
    where: { id: clanId },
    data: {
      name,
      tag,
      ...(logoUrl !== undefined ? { logoUrl } : {}),
    },
  });

  const actorNick = personLabel(me);
  const changed: string[] = [];
  if (clan.name !== name) changed.push(`название «${clan.name}» → «${name}»`);
  if (clan.tag !== tag) changed.push(`тег [${clan.tag}] → [${tag}]`);
  if (logoUrl === null) changed.push("лого удалено");
  else if (typeof logoUrl === "string") changed.push("лого обновлено");

  await writeActionLog({
    category: "clan",
    action: "clan_profile",
    message:
      changed.length > 0
        ? `${actorNick} изменил карточку [${updated.tag}] ${updated.name}: ${changed.join("; ")}`
        : `${actorNick} сохранил карточку [${updated.tag}] ${updated.name}`,
    actorId: me.id,
    actorNick,
    clanId,
    clanTag: updated.tag,
    meta: {
      from: { name: clan.name, tag: clan.tag, logoUrl: clan.logoUrl },
      to: { name: updated.name, tag: updated.tag, logoUrl: updated.logoUrl },
      via: asSite ? "site" : "leader",
    },
  });

  livePublish(
    clanLiveChannel(clanId),
    JSON.stringify({ type: "profile", tag: updated.tag, name: updated.name })
  );

  return NextResponse.json({ ok: true, clan: updated });
}
