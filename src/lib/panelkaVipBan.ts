import { prisma } from "@/lib/prisma";
import { runPanelka } from "@/lib/panelkaRcon";

const STEAM_RE = /^7656\d{13}$/;

export type VipRow = {
  steamId: string;
  nick: string | null;
  startsAt: string | null;
  endsAt: string | null;
  forever: boolean;
  byNick: string;
  grantedAt: string | null;
  note: string | null;
  source: "db" | "cfg";
  active: boolean;
};

export type BanRow = {
  id: string;
  steamId: string;
  eosId: string;
  forever: boolean;
  endsAt: string | null;
  comment: string;
  nick: string | null;
  byNick: string | null;
  bannedAt: string | null;
  line: string;
};

function clean(raw: string, limit: number): string {
  return String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

async function resolveNicks(steamIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(steamIds.filter((s) => STEAM_RE.test(s)))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const users = await prisma.user.findMany({
    where: { steamId: { in: ids } },
    select: { steamId: true, nick: true, steamName: true },
  });
  for (const u of users) {
    const nick = (u.nick || u.steamName || "").trim();
    if (nick) map.set(u.steamId, nick);
  }
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) {
    const sessions = await prisma.squadServerSession.findMany({
      where: { steamId: { in: missing }, nickAtJoin: { not: null } },
      select: { steamId: true, nickAtJoin: true, joinedAt: true },
      orderBy: { joinedAt: "desc" },
      take: 800,
    });
    for (const s of sessions) {
      if (map.has(s.steamId)) continue;
      const nick = (s.nickAtJoin || "").trim();
      if (nick) map.set(s.steamId, nick);
    }
  }
  return map;
}

/** Drop expired VIP lines from cfg + mark DB inactive. */
export async function expireVipsNow(): Promise<number> {
  const now = new Date();
  const expired = await prisma.panelkaVipGrant.findMany({
    where: { active: true, forever: false, endsAt: { lte: now } },
    select: { id: true, steamId: true },
  });
  let n = 0;
  for (const row of expired) {
    try {
      await runPanelka(["vip-remove", row.steamId], 25000);
    } catch {
      /* cfg may already be clean */
    }
    await prisma.panelkaVipGrant.update({
      where: { id: row.id },
      data: {
        active: false,
        revokedAt: now,
        revokedByNick: "auto-expire",
      },
    });
    n += 1;
  }
  return n;
}

export async function listPublicVips(): Promise<VipRow[]> {
  await expireVipsNow().catch(() => 0);
  const cfg = (await runPanelka(["vips-list"], 25000)) as {
    ok?: boolean;
    vips?: {
      steamId: string;
      until?: string;
      byNick?: string;
      grantedAt?: string;
      comment?: string;
    }[];
    error?: string;
  };
  if (!cfg?.ok) throw new Error(cfg?.error || "не удалось прочитать VIP");
  const cfgList = cfg.vips || [];
  const dbActive = await prisma.panelkaVipGrant.findMany({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  const bySteam = new Map(dbActive.map((r) => [r.steamId, r]));
  const nickMap = await resolveNicks([
    ...cfgList.map((v) => v.steamId),
    ...dbActive.map((v) => v.steamId),
  ]);

  const rows: VipRow[] = [];
  const seen = new Set<string>();
  for (const v of cfgList) {
    seen.add(v.steamId);
    const db = bySteam.get(v.steamId);
    rows.push({
      steamId: v.steamId,
      nick: db?.nick || nickMap.get(v.steamId) || null,
      startsAt: db?.startsAt?.toISOString() || v.grantedAt || null,
      endsAt: db?.endsAt?.toISOString() || (v.until && v.until !== "forever" ? v.until : null),
      forever: db ? db.forever : !v.until || v.until === "forever",
      byNick: db?.byNick || v.byNick || "—",
      grantedAt: db?.createdAt?.toISOString() || v.grantedAt || null,
      note: db?.note || null,
      source: db ? "db" : "cfg",
      active: true,
    });
  }
  // DB active but missing from cfg (desync) — still show
  for (const db of dbActive) {
    if (seen.has(db.steamId)) continue;
    rows.push({
      steamId: db.steamId,
      nick: db.nick || nickMap.get(db.steamId) || null,
      startsAt: db.startsAt.toISOString(),
      endsAt: db.endsAt?.toISOString() || null,
      forever: db.forever,
      byNick: db.byNick,
      grantedAt: db.createdAt.toISOString(),
      note: db.note,
      source: "db",
      active: true,
    });
  }
  rows.sort((a, b) => String(b.grantedAt || "").localeCompare(String(a.grantedAt || "")));
  return rows;
}

export async function grantPublicVip(opts: {
  steamId: string;
  nick?: string;
  startsAt: Date;
  endsAt: Date | null;
  forever: boolean;
  byNick: string;
  bySteamId?: string;
  byUserId?: string | null;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!STEAM_RE.test(opts.steamId)) return { ok: false, error: "плохой Steam ID" };
  if (!opts.forever && (!opts.endsAt || opts.endsAt.getTime() <= opts.startsAt.getTime())) {
    return { ok: false, error: "дата «до» должна быть позже «от»" };
  }
  const until = opts.forever
    ? "forever"
    : opts.endsAt!.toISOString().slice(0, 10);
  const granted = opts.startsAt.toISOString().slice(0, 19);
  const cfg = (await runPanelka(["vip-add", opts.steamId], 25000, {
    byNick: opts.byNick,
    until,
    granted,
  })) as { ok?: boolean; error?: string };
  if (!cfg?.ok) return { ok: false, error: cfg?.error || "не удалось записать Admins.cfg" };

  // deactivate previous active grants for same steam
  await prisma.panelkaVipGrant.updateMany({
    where: { steamId: opts.steamId, active: true },
    data: {
      active: false,
      revokedAt: new Date(),
      revokedByNick: opts.byNick,
    },
  });
  await prisma.panelkaVipGrant.create({
    data: {
      steamId: opts.steamId,
      nick: clean(opts.nick || "", 48) || null,
      startsAt: opts.startsAt,
      endsAt: opts.forever ? null : opts.endsAt,
      forever: opts.forever,
      byNick: clean(opts.byNick, 32) || "штаб",
      bySteamId: opts.bySteamId || null,
      byUserId: opts.byUserId || null,
      note: clean(opts.note || "", 200) || null,
      active: true,
    },
  });
  return { ok: true };
}

export async function revokePublicVip(opts: {
  steamId: string;
  byNick: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!STEAM_RE.test(opts.steamId)) return { ok: false, error: "плохой Steam ID" };
  const cfg = (await runPanelka(["vip-remove", opts.steamId], 25000)) as {
    ok?: boolean;
    error?: string;
  };
  if (!cfg?.ok && !String(cfg?.error || "").includes("нет")) {
    return { ok: false, error: cfg?.error || "не удалось снять VIP" };
  }
  await prisma.panelkaVipGrant.updateMany({
    where: { steamId: opts.steamId, active: true },
    data: {
      active: false,
      revokedAt: new Date(),
      revokedByNick: clean(opts.byNick, 32) || "штаб",
    },
  });
  return { ok: true };
}

export async function listServerBans(): Promise<BanRow[]> {
  const cfg = (await runPanelka(["bans-list"], 45000)) as {
    ok?: boolean;
    bans?: {
      id: string;
      steamId?: string;
      eosId?: string;
      forever?: boolean;
      endsAt?: string;
      comment?: string;
      line?: string;
    }[];
    error?: string;
  };
  if (!cfg?.ok) throw new Error(cfg?.error || "не удалось прочитать Bans.cfg");
  const bans = cfg.bans || [];
  const steamIds = bans.map((b) => b.steamId || "").filter((s) => STEAM_RE.test(s));
  const nickMap = await resolveNicks(steamIds);
  const audits = await prisma.panelkaBanAudit.findMany({
    where: {
      action: "ban",
      OR: [
        { targetId: { in: bans.map((b) => b.id) } },
        { steamId: { in: steamIds } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const auditByTarget = new Map<string, (typeof audits)[number]>();
  for (const a of audits) {
    if (!auditByTarget.has(a.targetId)) auditByTarget.set(a.targetId, a);
    if (a.steamId && !auditByTarget.has(a.steamId)) auditByTarget.set(a.steamId, a);
  }

  return bans.map((b) => {
    const steamId = b.steamId || (STEAM_RE.test(b.id) ? b.id : "");
    const audit = auditByTarget.get(b.id) || (steamId ? auditByTarget.get(steamId) : undefined);
    return {
      id: b.id,
      steamId,
      eosId: b.eosId || (!steamId ? b.id : ""),
      forever: Boolean(b.forever),
      endsAt: b.endsAt || audit?.endsAt?.toISOString() || null,
      comment: b.comment || "",
      nick: steamId ? nickMap.get(steamId) || null : null,
      byNick: audit?.byNick || null,
      bannedAt: audit?.createdAt?.toISOString() || null,
      line: b.line || "",
    };
  });
}

export async function unbanServerTarget(opts: {
  targetId: string;
  byNick: string;
  bySteamId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = clean(opts.targetId, 64);
  if (id.length < 10) return { ok: false, error: "плохой id" };
  const cfg = (await runPanelka(["ban-remove", id], 25000)) as {
    ok?: boolean;
    error?: string;
  };
  if (!cfg?.ok) return { ok: false, error: cfg?.error || "не удалось снять бан" };
  await prisma.panelkaBanAudit.create({
    data: {
      targetId: id,
      steamId: STEAM_RE.test(id) ? id : null,
      action: "unban",
      byNick: clean(opts.byNick, 32) || "штаб",
      bySteamId: opts.bySteamId || null,
    },
  });
  return { ok: true };
}

/** Convert date range to Squad AdminBan duration token. */
export function durationFromRange(startsAt: Date, endsAt: Date | null, forever: boolean): string {
  if (forever || !endsAt) return "0";
  const ms = endsAt.getTime() - Date.now();
  if (ms <= 0) return "1h";
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  if (hours % 24 === 0 && hours >= 24) return `${hours / 24}d`;
  if (hours >= 48) return `${Math.ceil(hours / 24)}d`;
  return `${hours}h`;
}

export async function recordBanAudit(opts: {
  steamId: string;
  reason: string;
  duration: string;
  endsAt: Date | null;
  forever: boolean;
  byNick: string;
  bySteamId?: string;
}): Promise<void> {
  await prisma.panelkaBanAudit.create({
    data: {
      targetId: opts.steamId,
      steamId: opts.steamId,
      action: "ban",
      reason: clean(opts.reason, 200),
      duration: opts.duration,
      endsAt: opts.endsAt,
      forever: opts.forever,
      byNick: clean(opts.byNick, 32) || "штаб",
      bySteamId: opts.bySteamId || null,
    },
  });
}
