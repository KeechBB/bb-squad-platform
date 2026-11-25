/**
 * Post-grant / health check: VIP QueuePriority, bans, cameras really in cfg.
 * Call after every VIP / ban / camera write.
 */
import { prisma } from "@/lib/prisma";
import { runPanelka } from "@/lib/panelkaRcon";
import { STAFF_QUEUE_ROLES } from "@/lib/panelkaVipBan";

const STEAM_RE = /^7656\d{13}$/;

export type PanelkaCfgVerifyKind = "vip" | "ban" | "camera" | "all";

export type PanelkaCfgVerifyResult = {
  ok: boolean;
  error?: string;
  focusSteamId?: string;
  kind: PanelkaCfgVerifyKind;
  vip: {
    dbActive: number;
    cfgCount: number;
    missingFromCfg: string[];
    focusInCfg: boolean | null;
    staffMissing: { steamId: string; nick: string; role: string }[];
  };
  ban: {
    focusInCfg: boolean | null;
    recentAuditMissing: string[];
  };
  camera: {
    cfgCount: number;
    focusInCfg: boolean | null;
  };
  checkedAt: string;
};

async function listVipSteamIds(): Promise<{ ok: true; ids: Set<string> } | { ok: false; error: string }> {
  const cfg = (await runPanelka(["vips-list"], 25000)) as {
    ok?: boolean;
    vips?: { steamId?: string }[];
    error?: string;
  };
  if (!cfg?.ok) return { ok: false, error: cfg?.error || "vips-list fail" };
  return {
    ok: true,
    ids: new Set(
      (cfg.vips || [])
        .map((v) => String(v.steamId || ""))
        .filter((s) => STEAM_RE.test(s))
    ),
  };
}

async function banHasSteam(steamId: string): Promise<boolean> {
  const cfg = (await runPanelka(["bans-list"], 45000)) as {
    ok?: boolean;
    bans?: { id?: string; steamId?: string }[];
  };
  if (!cfg?.ok) return false;
  return (cfg.bans || []).some(
    (b) => b.steamId === steamId || b.id === steamId
  );
}

async function cameraHasSteam(steamId: string): Promise<boolean> {
  const cfg = (await runPanelka(["camera-has", steamId], 25000)) as {
    ok?: boolean;
    has?: boolean;
  };
  if (cfg?.ok && typeof cfg.has === "boolean") return cfg.has;
  const list = (await runPanelka(["cameras-list"], 25000)) as {
    ok?: boolean;
    cameras?: { steamId?: string }[];
  };
  if (!list?.ok) return false;
  return (list.cameras || []).some((c) => c.steamId === steamId);
}

export async function verifyPanelkaCfgs(opts?: {
  focusSteamId?: string;
  kind?: PanelkaCfgVerifyKind;
}): Promise<PanelkaCfgVerifyResult> {
  const kind = opts?.kind || "all";
  const focus = STEAM_RE.test(opts?.focusSteamId || "")
    ? String(opts!.focusSteamId)
    : undefined;

  const vipList = await listVipSteamIds();
  if (!vipList.ok) {
    return {
      ok: false,
      error: vipList.error,
      focusSteamId: focus,
      kind,
      vip: {
        dbActive: 0,
        cfgCount: 0,
        missingFromCfg: [],
        focusInCfg: null,
        staffMissing: [],
      },
      ban: { focusInCfg: null, recentAuditMissing: [] },
      camera: { cfgCount: 0, focusInCfg: null },
      checkedAt: new Date().toISOString(),
    };
  }

  const dbActive = await prisma.panelkaVipGrant.findMany({
    where: { active: true },
    select: { steamId: true },
  });
  const missingFromCfg = dbActive
    .map((r) => r.steamId)
    .filter((sid) => !vipList.ids.has(sid));

  const staff = await prisma.user.findMany({
    where: { role: { in: [...STAFF_QUEUE_ROLES] } },
    select: { steamId: true, nick: true, steamName: true, role: true },
  });
  const staffMissing = staff
    .filter((u) => !vipList.ids.has(u.steamId))
    .map((u) => ({
      steamId: u.steamId,
      nick: (u.nick || u.steamName || "").trim() || u.steamId,
      role: u.role,
    }));

  let focusVip: boolean | null = null;
  let focusBan: boolean | null = null;
  let focusCam: boolean | null = null;
  let camCount = 0;
  const recentAuditMissing: string[] = [];

  if (focus && (kind === "vip" || kind === "all")) {
    focusVip = vipList.ids.has(focus);
  }
  if (focus && (kind === "ban" || kind === "all")) {
    focusBan = await banHasSteam(focus);
  }
  if (kind === "camera" || kind === "all" || kind === "vip") {
    const cams = (await runPanelka(["cameras-list"], 25000)) as {
      ok?: boolean;
      cameras?: { steamId?: string }[];
      count?: number;
    };
    if (cams?.ok) {
      camCount = cams.count ?? (cams.cameras || []).length;
      if (focus && (kind === "camera" || kind === "all")) {
        focusCam = (cams.cameras || []).some((c) => c.steamId === focus);
      }
    } else if (focus && kind === "camera") {
      focusCam = await cameraHasSteam(focus);
    }
  }
  if (focus && kind === "camera" && focusCam == null) {
    focusCam = await cameraHasSteam(focus);
  }

  if (kind === "ban" || kind === "all") {
    const since = new Date(Date.now() - 24 * 3600_000);
    const recent = await prisma.panelkaBanAudit.findMany({
      where: {
        action: "ban",
        createdAt: { gte: since },
        steamId: { not: null },
      },
      select: { steamId: true },
      take: 40,
      orderBy: { createdAt: "desc" },
    });
    for (const row of recent) {
      const sid = row.steamId || "";
      if (!STEAM_RE.test(sid)) continue;
      if (!(await banHasSteam(sid))) recentAuditMissing.push(sid);
    }
  }

  const errors: string[] = [];
  if (kind === "vip" || kind === "all") {
    if (focus && focusVip === false) {
      errors.push(`Steam ${focus} нет в Admins.cfg (QueuePriority)`);
    }
    // Full sweep only without focus — focused post-grant checks one Steam.
    if (!focus) {
      if (missingFromCfg.length) {
        errors.push(`DB VIP без cfg: ${missingFromCfg.length}`);
      }
      if (staffMissing.length) {
        errors.push(`staff без QueuePriority: ${staffMissing.length}`);
      }
    }
  }
  if ((kind === "ban" || kind === "all") && focus && focusBan === false) {
    errors.push(`Steam ${focus} нет в Bans.cfg`);
  }
  if ((kind === "camera" || kind === "all") && focus && focusCam === false) {
    errors.push(`Steam ${focus} нет Cameraman в Admins.cfg`);
  }

  return {
    ok: errors.length === 0,
    error: errors.length ? errors.join("; ") : undefined,
    focusSteamId: focus,
    kind,
    vip: {
      dbActive: dbActive.length,
      cfgCount: vipList.ids.size,
      missingFromCfg,
      focusInCfg: focusVip,
      staffMissing,
    },
    ban: {
      focusInCfg: focusBan,
      recentAuditMissing: [...new Set(recentAuditMissing)],
    },
    camera: {
      cfgCount: camCount,
      focusInCfg: focusCam,
    },
    checkedAt: new Date().toISOString(),
  };
}
