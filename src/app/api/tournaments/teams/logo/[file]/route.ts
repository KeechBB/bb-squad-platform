import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { TEAM_LOGO_DIR } from "@/lib/tournamentTeamLogoFile";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

function contentTypeFor(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "webp") return "image/webp";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "svg") return "image/svg+xml";
  return "image/png";
}

function fileResponse(buf: Buffer, ext: string) {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentTypeFor(ext),
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

function placeholderSvg(tag: string) {
  const label = (tag || "?").slice(0, 4).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="18" fill="#1a1524"/>
  <rect x="4" y="4" width="120" height="120" rx="14" fill="none" stroke="#d4a84b" stroke-width="3"/>
  <text x="64" y="74" text-anchor="middle" font-family="Arial,sans-serif" font-size="${label.length > 2 ? 28 : 36}" font-weight="700" fill="#f0d078">${label}</text>
</svg>`;
  return Buffer.from(svg, "utf8");
}

async function tryRead(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const { file } = await ctx.params;
  if (!/^[a-z0-9_-]+\.(png|webp|jpe?g|svg)$/i.test(file)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const primary = await tryRead(path.join(TEAM_LOGO_DIR, file));
  if (primary) {
    return fileResponse(primary, path.extname(file).slice(1));
  }

  const teamId = file.replace(/\.(png|webp|jpe?g|svg)$/i, "");
  let tag = "";
  try {
    const team = await prisma.tournamentTeam.findUnique({
      where: { id: teamId },
      select: { tag: true },
    });
    tag = String(team?.tag || "").trim().toUpperCase();
  } catch {
    /* ignore */
  }

  const alias: Record<string, string> = { A: "ALPHA" };
  const ratingTag = alias[tag] || tag;
  if (ratingTag) {
    for (const ext of ["png", "jpg", "webp"] as const) {
      const cand = path.join(
        process.cwd(),
        "public",
        "rating-logos",
        `${ratingTag}.${ext}`
      );
      if (existsSync(cand)) {
        const buf = await tryRead(cand);
        if (buf) return fileResponse(buf, ext);
      }
    }
  }

  if (tag) {
    try {
      const clan = await prisma.clan.findFirst({
        where: { tag: { equals: tag, mode: "insensitive" } },
        select: { logoUrl: true },
      });
      const logo = String(clan?.logoUrl || "");
      const fname = logo.split("/").pop()?.split("?")[0] || "";
      if (fname && /^[a-z0-9_-]+\.(png|webp|jpe?g)$/i.test(fname)) {
        const cand = path.join(process.cwd(), "storage", "clans", fname);
        const buf = await tryRead(cand);
        if (buf) return fileResponse(buf, path.extname(fname).slice(1));
      }
    } catch {
      /* ignore */
    }
  }

  // Не 404 — иначе в UI битая картинка. Буква-заглушка по тегу.
  return fileResponse(placeholderSvg(tag || teamId.slice(-3)), "svg");
}
