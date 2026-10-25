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
import {
  canChangeLogo,
  canDeleteTeam,
  canRenameTeam,
} from "@/lib/tournamentTeamPerms";
import {
  ACTIVE_TOURNAMENT,
  normalizeTeamTag,
  teamIdentityError,
} from "@/lib/tournaments";
import { Prisma } from "@prisma/client";
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

/** PATCH — название и тег (капитан, JSON) или лого (капитан/зам, FormData). */
export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: teamId } = await ctx.params;
  const actor = await actorOnTeam(teamId, session.user.steamId);
  if (!actor) {
    return NextResponse.json({ error: "Нет прав" }, { status: 403 });
  }

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    if (!canRenameTeam(actor)) {
      return NextResponse.json(
        { error: "Название и тег меняет только капитан" },
        { status: 403 }
      );
    }
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      tag?: string;
    };
    const name = String(body.name || "").trim();
    const tag = normalizeTeamTag(String(body.tag || ""));
    const identityError = teamIdentityError(name, tag);
    if (identityError) {
      return NextResponse.json({ error: identityError }, { status: 400 });
    }
    const teamRow = await prisma.tournamentTeam.findUnique({
      where: { id: teamId },
      select: { id: true, tag: true, name: true },
    });
    if (!teamRow) {
      return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
    }
    if (teamRow.name === name && teamRow.tag === tag) {
      return NextResponse.json({ ok: true, name, tag });
    }
    const taken = await prisma.tournamentTeam.findUnique({ where: { tag } });
    if (taken && taken.id !== teamId) {
      return NextResponse.json({ error: "Тег занят" }, { status: 409 });
    }
    try {
      await prisma.tournamentTeam.update({
        where: { id: teamId },
        data: { name, tag },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return NextResponse.json({ error: "Тег занят" }, { status: 409 });
      }
      throw err;
    }
    const nick = personLabel(actor.user);
    await writeActionLog({
      category: "tournament",
      action: "team_rename",
      message: `${nick} переименовал команду [${teamRow.tag}] ${teamRow.name} → [${tag}] ${name}`,
      actorId: actor.userId,
      actorNick: nick,
      clanId: teamRow.id,
      clanTag: tag,
      meta: {
        tournamentId: ACTIVE_TOURNAMENT.id,
        teamId,
        fromName: teamRow.name,
        fromTag: teamRow.tag,
        teamName: name,
      },
    });
    return NextResponse.json({ ok: true, name, tag });
  }

  if (!canChangeLogo(actor)) {
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
    return NextResponse.json(
      { error: "Лого до 20 МБ (png/webp/jpeg)" },
      { status: 400 }
    );
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  const mime = detectClanLogoMime(buf);
  if (!mime) {
    return NextResponse.json(
      {
        error:
          "Лого не распознано. Нужен настоящий png, webp или jpeg (не переименованный файл)",
      },
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
