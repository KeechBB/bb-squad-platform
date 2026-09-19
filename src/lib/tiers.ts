import type { ClanRole } from "@/lib/clan";
import { isActiveReserve } from "@/lib/validation";

export type RosterBucket =
  | "reserve"
  | "tier1"
  | "tier2"
  | "tier3"
  | "tier4"
  | "tbd";

export const ROSTER_BUCKET_LABEL: Record<RosterBucket, string> = {
  reserve: "Резерв",
  tier1: "Тир 1",
  tier2: "Тир 2",
  tier3: "Тир 3",
  tier4: "Тир 4",
  tbd: "TBD",
};

export const ROSTER_BUCKET_COLOR: Record<RosterBucket, string> = {
  reserve: "#fbbf24",
  tier1: "#7dd3fc",
  tier2: "#86efac",
  tier3: "#fde047",
  tier4: "#a78bfa",
  tbd: "#6b7280",
};

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://kv.bb-squad.ru",
  "https://keechbb.github.io/blackberry-kv",
].filter(Boolean) as string[];

function nickKey(nick: string): string {
  return nick.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildTierIndex(data: {
  tier1?: string[];
  tier2?: string[];
  tier3?: string[];
  aliases?: Record<string, string>;
} | null): Map<string, 1 | 2 | 3> {
  const map = new Map<string, 1 | 2 | 3>();
  if (!data) return map;
  (
    [
      [1, data.tier1 || []],
      [2, data.tier2 || []],
      [3, data.tier3 || []],
    ] as const
  ).forEach(([tier, list]) => {
    for (const n of list) map.set(nickKey(n), tier);
  });
  const aliases = data.aliases || {};
  for (const [alias, canon] of Object.entries(aliases)) {
    const t = map.get(nickKey(canon));
    if (t) map.set(nickKey(alias), t);
  }
  return map;
}

export async function loadTierIndex(): Promise<Map<string, 1 | 2 | 3>> {
  for (const base of KV_BASES) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/data/tiers.json`, {
        next: { revalidate: 120 },
      });
      if (!res.ok) continue;
      const data = await res.json();
      return buildTierIndex(data);
    } catch {
      /* try next */
    }
  }
  return new Map();
}

/** Участвует в КВ: мейн/junior или боевая роль состава */
function isKvParticipant(
  role: ClanRole,
  squadName: string | null | undefined
): boolean {
  const squad = (squadName || "").trim().toLowerCase();
  if (squad === "main" || squad === "junior") return true;
  return (
    role === "LEADER" ||
    role === "DEPUTY" ||
    role === "MAIN" ||
    role === "SUB"
  );
}

export function classifyRosterMember(opts: {
  nick: string | null | undefined;
  role: ClanRole;
  reserveUntil: string | Date | null | undefined;
  squadName: string | null | undefined;
  tierMap: Map<string, 1 | 2 | 3>;
}): RosterBucket {
  const until =
    opts.reserveUntil == null
      ? null
      : typeof opts.reserveUntil === "string"
        ? new Date(opts.reserveUntil)
        : opts.reserveUntil;
  if (opts.role === "RESERVE" || isActiveReserve(until)) return "reserve";

  const nick = opts.nick?.trim();
  if (nick) {
    const tier = opts.tierMap.get(nickKey(nick));
    if (tier === 1) return "tier1";
    if (tier === 2) return "tier2";
    if (tier === 3) return "tier3";
  }

  if (isKvParticipant(opts.role, opts.squadName)) return "tier4";
  return "tbd";
}

export type RosterBucketCount = {
  key: RosterBucket;
  label: string;
  color: string;
  count: number;
};

export function tallyRosterBuckets(
  rows: Array<{
    nick: string | null | undefined;
    role: ClanRole;
    reserveUntil: string | Date | null | undefined;
    squadName: string | null | undefined;
  }>,
  tierMap: Map<string, 1 | 2 | 3>
): RosterBucketCount[] {
  const order: RosterBucket[] = [
    "reserve",
    "tier1",
    "tier2",
    "tier3",
    "tier4",
    "tbd",
  ];
  const counts = Object.fromEntries(order.map((k) => [k, 0])) as Record<
    RosterBucket,
    number
  >;
  for (const r of rows) {
    const b = classifyRosterMember({ ...r, tierMap });
    counts[b] += 1;
  }
  return order.map((key) => ({
    key,
    label: ROSTER_BUCKET_LABEL[key],
    color: ROSTER_BUCKET_COLOR[key],
    count: counts[key],
  }));
}
