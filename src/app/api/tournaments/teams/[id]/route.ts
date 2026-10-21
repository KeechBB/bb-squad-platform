import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  TEAM_LOGO_MAX,
  detectClanLogoMime,
  saveTeamLogo,
  deleteTeamLogo,
} from "@/lib/tournamentTeamLogoFile";
import { canChangeLogo, canDeleteTeam } from "@/lib/tournamentTeamPerms";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";
import { personLabel, writeActionLog } from "@/lib/actionLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function actorOnTeam(teamId: string, steamId: string) {
  const me = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  if (!me) return null;
  const m = await prisma.tournamentTeamMember.findFirst({
    where: { teamId, userId: me.id },
  });
  if (!m) return null;
  return { userId: me.id, role: m.role, user: me };
}

/** PATCH — сменить лого (капитан/зам). Имя и тег нельзя. */
export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: teamId } = await ctx.params;
  const actor = await actorOnTeam(teamId, session.user.steamId);
  if (!actor || !canChangeLogo(actor)) {
    return NextResponse.json({ error: "Нет прав менять лого" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Ожидается FormData" }, { status: 400 });
  }
  const remove = String(form.get("removeLogo") || "") === "1";
  const logo = form.get("logo");

  const teamRow = await prisma.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { id: true, tag: true, name: true },
  });
  if (!teamRow) {
    return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
  }
  const nick = personLabel(actor.user);

  if (remove) {
    await deleteTeamLogo(teamId);
    const team = await prisma.tournamentTeam.update({
      where: { id: teamId },
      data: { logoUrl: null },
    });
    await writeActionLog({
      category: "tournament",
      action: "team_logo",
      message: `${nick} снял лого команды [${teamRow.tag}] ${teamRow.name}`,
      actorId: actor.userId,
      actorNick: nick,
      clanId: teamRow.id,
      clanTag: teamRow.tag,
      meta: {
        tournamentId: ACTIVE_TOURNAMENT.id,
        teamId,
        remove: true,
      },
    });
    return NextResponse.json({ ok: true, logoUrl: team.logoUrl });
  }

  if (!logo || typeof logo === "string" || !("arrayBuffer" in logo)) {
    return NextResponse.json({ error: "Нужен файл лого" }, { status: 400 });
  }
  const blob = logo as Blob;
  if (blob.size <= 0) {
    return NextResponse.json({ error: "Пустой файл" }, { status: 400 });
  }
  if (blob.size > TEAM_LOGO_MAX) {
    return NextResponse.json({ error: "Лого до 5 МБ (png/webp)" }, { status: 400 });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  const mime = detectClanLogoMime(buf);
  if (!mime) {
    return NextResponse.json(
      { error: "Лого: только png или webp" },
      { status: 400 }
    );
  }
  const logoUrl = await saveTeamLogo(teamId, buf, mime);
  await prisma.tournamentTeam.update({
    where: { id: teamId },
    data: { logoUrl },
  });
  await writeActionLog({
    category: "tournament",
    action: "team_logo",
    message: `${nick} сменил лого команды [${teamRow.tag}] ${teamRow.name}`,
    actorId: actor.userId,
    actorNick: nick,
    clanId: teamRow.id,
    clanTag: teamRow.tag,
    meta: {
      tournamentId: ACTIVE_TOURNAMENT.id,
      teamId,
      remove: false,
    },
  });
  return NextResponse.json({ ok: true, logoUrl });
}

/** DELETE — распустить команду (только капитан) */
export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: teamId } = await ctx.params;
  const actor = await actorOnTeam(teamId, session.user.steamId);
  if (!actor || !canDeleteTeam(actor)) {
    return NextResponse.json(
      { error: "Удалить команду может только капитан" },
      { status: 403 }
    );
  }

  const teamRow = await prisma.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { id: true, tag: true, name: true },
  });
  if (!teamRow) {
    return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
  }

  await deleteTeamLogo(teamId);
  await prisma.tournamentTeam.delete({ where: { id: teamId } });

  const nick = personLabel(actor.user);
  await writeActionLog({
    category: "tournament",
    action: "team_disband",
    message: `${nick} распустил команду [${teamRow.tag}] ${teamRow.name}`,
    actorId: actor.userId,
    actorNick: nick,
    clanId: teamRow.id,
    clanTag: teamRow.tag,
    meta: {
      tournamentId: ACTIVE_TOURNAMENT.id,
      teamId,
      teamName: teamRow.name,
    },
  });

  return NextResponse.json({ ok: true });
}
