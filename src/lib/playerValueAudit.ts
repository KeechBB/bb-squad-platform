/**
 * Аудит стоимости игроков фракций после TR:
 * пересобирает train-истории, сверяет дни/K/D/роль, шлёт сводку в Telegram.
 */
import { prisma } from "@/lib/prisma";
import { sendBbAlert } from "@/lib/bbAlerts";
import { forceRebuildProfileLines } from "@/lib/profileMatchLines";
import {
  estimateWithKit,
  loadPlayerPriceStats,
  normalizeKit,
} from "@/lib/factionTransfers";
import { mainKits } from "@/lib/factions";
import { loadPlayerValueBonuses } from "@/lib/playerValueBonus";
import { profileHistoryKey } from "@/lib/nickCollisions";
import type { ScarcityForPrice } from "@/lib/blueberryDollar";
import type { PlayerPriceStats } from "@/lib/blueberryDollar";

export type PlayerValueAuditIssue = {
  nick: string;
  faction: string;
  reasons: string[];
  before?: Partial<PlayerPriceStats> & { market?: number; total?: number };
  after?: Partial<PlayerPriceStats> & { market?: number; total?: number };
};

export type PlayerValueAuditReport = {
  total: number;
  ok: number;
  errors: number;
  fixed: number;
  issues: PlayerValueAuditIssue[];
  text: string;
};

function rosterKitScarcity(count: number, rosterSize: number): ScarcityForPrice {
  if (rosterSize < 8) return count <= 1 ? "critical" : "ok";
  const share = count / Math.max(1, rosterSize);
  if (count <= 1 || share < 0.04) return "critical";
  if (count <= 2 || share < 0.08) return "thin";
  if (share > 0.28) return "surplus";
  return "ok";
}

async function truthTrainDays14(userId: string, steamId: string | null): Promise<number> {
  const ymd14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const [y, m, d] = ymd14.split("-").map((x) => Number(x) || 0);
  const rows = await prisma.canonMatchPlayer.findMany({
    where: {
      OR: [
        { userId },
        ...(steamId ? [{ steamId }] : []),
      ],
      match: {
        kind: "TRAIN",
        publishedAt: { not: null },
        OR: [
          { year: { gt: y } },
          { year: y, month: { gt: m } },
          { year: y, month: m, day: { gte: d } },
        ],
      },
    },
    select: { match: { select: { year: true, month: true, day: true } } },
  });
  const days = new Set<string>();
  for (const r of rows) {
    const yy = r.match.year;
    const mm = String(r.match.month).padStart(2, "0");
    const dd = String(r.match.day).padStart(2, "0");
    const ymd = `${yy}-${mm}-${dd}`;
    if (ymd >= ymd14) days.add(ymd);
  }
  return days.size;
}

export async function auditFactionPlayerValues(opts?: {
  sendTelegram?: boolean;
  matchLabel?: string | null;
}): Promise<PlayerValueAuditReport> {
  const members = await prisma.factionMember.findMany({
    include: {
      faction: { select: { id: true, name: true, slug: true } },
      user: {
        select: {
          id: true,
          nick: true,
          steamName: true,
          steamId: true,
          name: true,
        },
      },
    },
    orderBy: [{ factionId: "asc" }, { seat: "asc" }],
  });

  const total = members.length;
  const byFaction = new Map<string, typeof members>();
  for (const m of members) {
    const list = byFaction.get(m.factionId) || [];
    list.push(m);
    byFaction.set(m.factionId, list);
  }

  // 1) Форс-ребилд train-историй у всех во фракциях.
  let fixed = 0;
  for (const m of members) {
    const nick = (m.user.nick || m.user.steamName || "").trim();
    if (!nick) continue;
    const key = profileHistoryKey(nick, m.user.steamId);
    const before = key
      ? await prisma.profileMatchLine.count({
          where: { kind: "train", nickKey: key },
        })
      : 0;
    const n = await forceRebuildProfileLines(nick, "train");
    if (n > before || (before === 0 && n > 0)) fixed += 1;
  }

  const issues: PlayerValueAuditIssue[] = [];
  let ok = 0;

  for (const [factionId, roster] of byFaction) {
    const userIds = roster.map((m) => m.userId);
    const [kits, priceStats, bonuses] = await Promise.all([
      mainKits(userIds),
      loadPlayerPriceStats(userIds),
      loadPlayerValueBonuses(
        roster.map((m) => ({
          userId: m.userId,
          nick: m.user.nick || m.user.steamName || "—",
          steamName: m.user.steamName,
          steamId: m.user.steamId,
        }))
      ),
    ]);

    const kitCounts = new Map<string, number>();
    for (const uid of userIds) {
      const k = normalizeKit(kits.get(uid) || null);
      kitCounts.set(k, (kitCounts.get(k) || 0) + 1);
    }
    const rosterSize = userIds.length;

    for (const m of roster) {
      const nick = (m.user.nick || m.user.steamName || "—").trim();
      const st = priceStats.get(m.userId)!;
      const mainKit = kits.get(m.userId) || "—";
      const kitKey = normalizeKit(mainKit);
      const scarcity = rosterKitScarcity(
        kitCounts.get(kitKey) || 0,
        rosterSize
      );
      const grind = Math.max(0, Math.round(st.grindBroughtBd || 0));
      const market = estimateWithKit(
        { ...st, grindBroughtBd: 0 },
        mainKit,
        scarcity
      );
      const totalValue = estimateWithKit(st, mainKit, scarcity);
      const truthDays = await truthTrainDays14(m.userId, m.user.steamId);
      const reasons: string[] = [];

      if (truthDays > 0 && st.trainDays14 === 0) {
        reasons.push(`TR дни 14д: формула 0, канон ${truthDays}`);
      } else if (Math.abs(truthDays - st.trainDays14) >= 2) {
        reasons.push(`TR дни 14д: формула ${st.trainDays14}, канон ${truthDays}`);
      }
      if (st.matches30 > 0 && st.kills30 + st.deaths30 === 0 && st.res30 === 0) {
        reasons.push("есть катки, но K/D/рес = 0");
      }
      if (!mainKit || mainKit === "—" || kitKey === "unknown") {
        reasons.push("нет основного кита / роль unknown");
      }
      if (totalValue < 0 || !Number.isFinite(totalValue)) {
        reasons.push("битая сумма стоимости");
      }

      if (reasons.length) {
        issues.push({
          nick,
          faction: m.faction.name,
          reasons,
          after: {
            trainDays14: st.trainDays14,
            matches30: st.matches30,
            kills30: st.kills30,
            deaths30: st.deaths30,
            market,
            total: totalValue,
          },
        });
      } else {
        ok += 1;
      }
    }
  }

  const errors = issues.length;
  const matchBit = opts?.matchLabel ? `\nМатч: ${opts.matchLabel}` : "";
  const sample = issues
    .slice(0, 8)
    .map((i) => `• ${i.nick} (${i.faction}): ${i.reasons.join("; ")}`)
    .join("\n");

  const text = [
    "🧮 Аудит стоимости фракций",
    matchBit.trim(),
    "———",
    `Всего игроков во фракциях: ${total}`,
    `Верный расчет стоимости ${ok}/${total}`,
    `Ошибок в расчетах ${errors}/${total}`,
    `Исправлено, пересчитано у всех.`,
    fixed ? `Пересобрано train-историй: ${fixed}` : null,
    sample ? `———\nПримеры:\n${sample}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (opts?.sendTelegram !== false) {
    await sendBbAlert(text);
  }

  return { total, ok, errors, fixed, issues, text };
}
