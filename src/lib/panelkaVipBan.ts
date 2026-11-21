import { prisma } from "@/lib/prisma";
import { runPanelka } from "@/lib/panelkaRcon";

const STEAM_RE = /^7656\d{13}$/;

export type VipRow = {
  steamId: string;
  nick: string | null;
  startsAt: string | null;
  endsAt: string | null;
  forever: boolean;
  /** Human term for UI — never lie with «навсегда» if unknown */
  termLabel: string;
  byNick: string;
  grantedAt: string | null;
  note: string | null;
  source: "db" | "cfg";
  active: boolean;
};

export type BanRow = {
  /** Primary id for unban (prefer Steam). */
  id: string;
  steamId: string;
  eosId: string;
  /** All cfg ids to strip on unban (steam + paired eos). */
  unbanIds: string[];
  forever: boolean;
  endsAt: string | null;
  duration: string | null;
  termLabel: string;
  comment: string;
  nick: string | null;
  byNick: string | null;
  bannedAt: string | null;
  /** Order in Bans.cfg (higher = newer append). */
  lineNo: number;
  line: string;
};

function fmtMsk(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function vipTermLabel(opts: {
  forever: boolean;
  endsAt: string | null;
  untilRaw?: string;
}): string {
  if (opts.forever) return "навсегда";
  if (opts.endsAt) return `до ${fmtMsk(opts.endsAt)}`;
  if (opts.untilRaw && opts.untilRaw !== "forever") return `до ${opts.untilRaw}`;
  return "срок не указан";
}

function banTermLabel(opts: {
  forever: boolean;
  endsAt: string | null;
  duration: string | null;
  comment: string;
}): string {
  if (opts.endsAt) return `до ${fmtMsk(opts.endsAt)}`;
  if (opts.duration && opts.duration !== "0") return `срок ${opts.duration}`;
  if (opts.forever) return "навсегда";
  const c = opts.comment.toLowerCase();
  if (c.includes("навсегда") || /\bforever\b/.test(c)) return "навсегда";
  return "срок не указан";
}

function clean(raw: string, limit: number): string {
  return String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** Squad AdminBan comment: `[Keech] reason` or `[Навсегда] …` — not bb-ban meta. */
const COMMENT_BRACKET_RE = /^\[([^\]]{1,48})\]\s*(.*)$/i;
const NOT_BY_BRACKET_RE =
  /^(навсегда|forever|perm|permanent|0|\d+\s*[mhd]|срок)$/i;

export function parseBanComment(comment: string): {
  byNick: string;
  reason: string;
  foreverHint: boolean;
} {
  const raw = clean(comment, 240);
  const m = COMMENT_BRACKET_RE.exec(raw);
  if (!m) return { byNick: "", reason: raw, foreverHint: false };
  const tag = m[1].trim();
  const rest = clean(m[2] || "", 200);
  if (NOT_BY_BRACKET_RE.test(tag) || /навсегда|forever/i.test(tag)) {
    return {
      byNick: "",
      reason: rest || raw,
      foreverHint: true,
    };
  }
  return { byNick: tag, reason: rest || raw, foreverHint: false };
}

function staffStampIso(date: string, clock: string): string | null {
  const d = String(date || "").trim();
  const c = String(clock || "").trim() || "00:00:00";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = new Date(`${d}T${c}+03:00`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

type StaffBanHit = {
  steamId: string;
  name: string;
  reason: string;
  duration: string;
  byNick: string;
  bannedAt: string | null;
};

async function loadStaffBanHits(): Promise<StaffBanHit[]> {
  try {
    const data = (await runPanelka(["staff-log"], 25000, { limit: 600 })) as {
      ok?: boolean;
      entries?: {
        kind?: string;
        date?: string;
        clock?: string;
        steamId?: string;
        name?: string;
        reason?: string;
        duration?: string;
        byNick?: string;
      }[];
    };
    if (!data?.ok || !Array.isArray(data.entries)) return [];
    const out: StaffBanHit[] = [];
    for (const e of data.entries) {
      if (e.kind !== "ban") continue;
      const reason = clean(String(e.reason || ""), 200);
      const parsed = parseBanComment(reason);
      out.push({
        steamId: STEAM_RE.test(String(e.steamId || ""))
          ? String(e.steamId)
          : "",
        name: clean(String(e.name || ""), 64),
        reason: parsed.reason || reason,
        duration: clean(String(e.duration || ""), 16),
        byNick: clean(String(e.byNick || parsed.byNick || ""), 32),
        bannedAt: staffStampIso(String(e.date || ""), String(e.clock || "")),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function normReason(s: string): string {
  return clean(s, 200).toLowerCase();
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
      note?: string;
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
    const untilRaw = (v.until || "").trim();
    const endsAt =
      db?.endsAt?.toISOString() ||
      (untilRaw && untilRaw !== "forever" ? untilRaw : null);
    // Only «навсегда» when DB/cfg explicitly says so — bare QueuePriority ≠ forever
    const forever = db
      ? db.forever
      : untilRaw === "forever" || /навсегда|forever/i.test(v.comment || "");
    rows.push({
      steamId: v.steamId,
      nick: db?.nick || nickMap.get(v.steamId) || null,
      startsAt: db?.startsAt?.toISOString() || v.grantedAt || null,
      endsAt,
      forever,
      termLabel: vipTermLabel({ forever, endsAt, untilRaw }),
      byNick: db?.byNick || v.byNick || "—",
      grantedAt: db?.createdAt?.toISOString() || v.grantedAt || null,
      note: db?.note || (v.note || "").trim() || null,
      source: db ? "db" : "cfg",
      active: true,
    });
  }
  // DB active but missing from cfg (desync) — still show
  for (const db of dbActive) {
    if (seen.has(db.steamId)) continue;
    const endsAt = db.endsAt?.toISOString() || null;
    rows.push({
      steamId: db.steamId,
      nick: db.nick || nickMap.get(db.steamId) || null,
      startsAt: db.startsAt.toISOString(),
      endsAt,
      forever: db.forever,
      termLabel: vipTermLabel({ forever: db.forever, endsAt }),
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
    note: clean(opts.note || "", 120),
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
      duration?: string;
      byNick?: string;
      bannedAt?: string;
      comment?: string;
      lineNo?: number;
      line?: string;
    }[];
    error?: string;
  };
  if (!cfg?.ok) throw new Error(cfg?.error || "не удалось прочитать Bans.cfg");
  const bans = cfg.bans || [];

  // Collapse Steam + next EOS twin into one player row so Steam ID is always visible.
  type Raw = (typeof bans)[number];
  const merged: {
    id: string;
    steamId: string;
    eosId: string;
    unbanIds: string[];
    forever: boolean;
    endsAt: string;
    duration: string;
    byNick: string;
    bannedAt: string;
    comment: string;
    lineNo: number;
    line: string;
  }[] = [];
  for (let i = 0; i < bans.length; i += 1) {
    const cur = bans[i] as Raw;
    const steamId = cur.steamId || (STEAM_RE.test(cur.id) ? cur.id : "");
    const eosId = cur.eosId || (!steamId && cur.id.length === 32 ? cur.id : "");
    const next = bans[i + 1] as Raw | undefined;
    const nextSteam = next?.steamId || (next && STEAM_RE.test(next.id) ? next.id : "");
    const nextEos =
      next?.eosId || (next && !nextSteam && next.id.length === 32 ? next.id : "");
    if (steamId && nextEos && !nextSteam) {
      merged.push({
        id: steamId,
        steamId,
        eosId: nextEos,
        unbanIds: [steamId, nextEos],
        forever: Boolean(cur.forever),
        endsAt: cur.endsAt || "",
        duration: cur.duration || next?.duration || "",
        byNick: cur.byNick || next?.byNick || "",
        bannedAt: cur.bannedAt || next?.bannedAt || "",
        comment: cur.comment || next?.comment || "",
        lineNo: Math.max(cur.lineNo || 0, next?.lineNo || 0),
        line: cur.line || "",
      });
      i += 1;
      continue;
    }
    if (eosId && !steamId && nextSteam) {
      // eos then steam (rare) — still one row
      merged.push({
        id: nextSteam,
        steamId: nextSteam,
        eosId,
        unbanIds: [eosId, nextSteam],
        forever: Boolean(cur.forever ?? next?.forever),
        endsAt: cur.endsAt || next?.endsAt || "",
        duration: cur.duration || next?.duration || "",
        byNick: cur.byNick || next?.byNick || "",
        bannedAt: cur.bannedAt || next?.bannedAt || "",
        comment: cur.comment || next?.comment || "",
        lineNo: Math.max(cur.lineNo || 0, next?.lineNo || 0),
        line: next?.line || cur.line || "",
      });
      i += 1;
      continue;
    }
    merged.push({
      id: steamId || cur.id,
      steamId,
      eosId,
      unbanIds: [cur.id],
      forever: Boolean(cur.forever),
      endsAt: cur.endsAt || "",
      duration: cur.duration || "",
      byNick: cur.byNick || "",
      bannedAt: cur.bannedAt || "",
      comment: cur.comment || "",
      lineNo: cur.lineNo || 0,
      line: cur.line || "",
    });
  }

  const staffHits = await loadStaffBanHits();
  const staffBySteam = new Map<string, StaffBanHit>();
  const staffByReasonBy: StaffBanHit[] = [];
  for (const h of staffHits) {
    if (h.steamId && !staffBySteam.has(h.steamId)) staffBySteam.set(h.steamId, h);
    staffByReasonBy.push(h);
  }

  // Pull steam from staff onto EOS-only cfg rows (same reason + who).
  for (const b of merged) {
    if (b.steamId) continue;
    const parsed = parseBanComment(b.comment);
    const by = (b.byNick || parsed.byNick).toLowerCase();
    const reason = normReason(parsed.reason || b.comment);
    if (!reason) continue;
    const hit = staffByReasonBy.find((h) => {
      if (!h.steamId) return false;
      if (by && h.byNick && h.byNick.toLowerCase() !== by) return false;
      return normReason(h.reason) === reason || reason.includes(normReason(h.reason));
    });
    if (hit?.steamId) {
      b.steamId = hit.steamId;
      if (!b.unbanIds.includes(hit.steamId)) b.unbanIds.push(hit.steamId);
      if (!b.id || b.id === b.eosId) b.id = hit.steamId;
    }
  }

  const steamIds = merged.map((b) => b.steamId).filter((s) => STEAM_RE.test(s));
  const nickMap = await resolveNicks(steamIds);
  const audits = await prisma.panelkaBanAudit.findMany({
    where: { action: "ban" },
    orderBy: { createdAt: "desc" },
    take: 3000,
  });
  const auditByTarget = new Map<string, (typeof audits)[number]>();
  for (const a of audits) {
    if (!auditByTarget.has(a.targetId)) auditByTarget.set(a.targetId, a);
    if (a.steamId && !auditByTarget.has(a.steamId)) {
      auditByTarget.set(a.steamId, a);
    }
  }

  const usedStaff = new Set<string>();
  const rows: BanRow[] = merged.map((b) => {
    const parsed = parseBanComment(b.comment);
    const audit =
      auditByTarget.get(b.id) ||
      (b.steamId ? auditByTarget.get(b.steamId) : undefined) ||
      (b.eosId ? auditByTarget.get(b.eosId) : undefined);
    let staff =
      (b.steamId && staffBySteam.get(b.steamId)) || undefined;
    if (!staff) {
      const by = (b.byNick || parsed.byNick || "").toLowerCase();
      const reason = normReason(parsed.reason || b.comment);
      staff = staffByReasonBy.find((h) => {
        const key = `${h.steamId}|${h.bannedAt}|${h.reason}`;
        if (usedStaff.has(key)) return false;
        if (by && h.byNick && h.byNick.toLowerCase() !== by) return false;
        const hr = normReason(h.reason);
        return Boolean(reason) && (hr === reason || reason.includes(hr) || hr.includes(reason));
      });
    }
    if (staff) {
      usedStaff.add(`${staff.steamId}|${staff.bannedAt}|${staff.reason}`);
    }

    const steamId = b.steamId || staff?.steamId || "";
    const endsAt = b.endsAt || audit?.endsAt?.toISOString() || null;
    const duration =
      (b.duration || staff?.duration || audit?.duration || "").trim() || null;
    const forever = Boolean(
      audit?.forever ?? b.forever ?? parsed.foreverHint
    );
    const reasonText =
      clean(parsed.reason || "", 200) ||
      clean(staff?.reason || "", 200) ||
      clean(audit?.reason || "", 200) ||
      clean(b.comment || "", 200);
    const bannedAt =
      audit?.createdAt?.toISOString() ||
      staff?.bannedAt ||
      (b.bannedAt
        ? b.bannedAt.includes("T")
          ? b.bannedAt
          : `${b.bannedAt}T00:00:00`
        : null);
    const byNick =
      b.byNick ||
      parsed.byNick ||
      staff?.byNick ||
      audit?.byNick ||
      null;
    const nick =
      (steamId ? nickMap.get(steamId) : null) ||
      staff?.name ||
      null;

    return {
      id: steamId || b.id,
      steamId,
      eosId: b.eosId,
      unbanIds: b.unbanIds,
      forever,
      endsAt,
      duration,
      termLabel: banTermLabel({
        forever,
        endsAt,
        duration,
        comment: reasonText,
      }),
      comment: reasonText,
      nick,
      byNick,
      bannedAt,
      lineNo: b.lineNo || 0,
      line: b.line || "",
    };
  });
  // Newest first: bannedAt desc, then Bans.cfg line order (append = newer).
  rows.sort((a, b) => {
    const at = a.bannedAt ? Date.parse(a.bannedAt) : 0;
    const bt = b.bannedAt ? Date.parse(b.bannedAt) : 0;
    if (at !== bt) return bt - at;
    return (b.lineNo || 0) - (a.lineNo || 0);
  });
  return rows;
}

export async function unbanServerTarget(opts: {
  targetId: string;
  unbanIds?: string[];
  byNick: string;
  bySteamId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ids = [
    ...new Set(
      (opts.unbanIds?.length ? opts.unbanIds : [opts.targetId])
        .map((x) => clean(x, 64))
        .filter((x) => x.length >= 10)
    ),
  ];
  if (!ids.length) return { ok: false, error: "плохой id" };
  let anyOk = false;
  let lastErr = "";
  for (const id of ids) {
    const cfg = (await runPanelka(["ban-remove", id], 25000)) as {
      ok?: boolean;
      error?: string;
    };
    if (cfg?.ok) anyOk = true;
    else lastErr = cfg?.error || lastErr;
  }
  if (!anyOk) return { ok: false, error: lastErr || "не удалось снять бан" };
  const primary = ids.find((id) => STEAM_RE.test(id)) || ids[0];
  await prisma.panelkaBanAudit.create({
    data: {
      targetId: primary,
      steamId: STEAM_RE.test(primary) ? primary : null,
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
