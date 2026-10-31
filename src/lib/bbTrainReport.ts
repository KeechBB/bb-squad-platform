import { prisma } from "@/lib/prisma";

export type BbTrainSlot = "2130" | "0100";

export type BbTrainPayload = {
  yday: string;
  weekFrom: string;
  ydayMissing: string[];
  weekMissing: string[];
  schedMissing: string[];
  schedPresent: string[];
  lateFirst: string[];
  notInClan: string[];
  excusedAbsent: string[];
  absentOverWeek: string[];
  neverSeen: string[];
  scheduleOffSite: string[];
  clanOnSite: number;
};

export type BbTrainReportRow = {
  reportDate: string;
  slot: BbTrainSlot;
  peakOnline: number;
  joinedTotal: number;
  ydayMissingN: number;
  weekMissingN: number;
  schedExpected: number;
  schedPresent: number;
  lateFirstN: number;
  payload: BbTrainPayload;
};

type RawRow = {
  reportDate: string;
  slot: string;
  peakOnline: number;
  joinedTotal: number;
  ydayMissingN: number;
  weekMissingN: number;
  schedExpected: number;
  schedPresent: number;
  lateFirstN: number;
  payload: BbTrainPayload | string;
};

function asPayload(raw: BbTrainPayload | string): BbTrainPayload {
  const value = typeof raw === "string" ? (JSON.parse(raw) as BbTrainPayload) : raw;
  return {
    yday: String(value?.yday || ""),
    weekFrom: String(value?.weekFrom || ""),
    ydayMissing: Array.isArray(value?.ydayMissing) ? value.ydayMissing : [],
    weekMissing: Array.isArray(value?.weekMissing) ? value.weekMissing : [],
    schedMissing: Array.isArray(value?.schedMissing) ? value.schedMissing : [],
    schedPresent: Array.isArray(value?.schedPresent) ? value.schedPresent : [],
    lateFirst: Array.isArray(value?.lateFirst) ? value.lateFirst : [],
    notInClan: Array.isArray(value?.notInClan) ? value.notInClan : [],
    excusedAbsent: Array.isArray(value?.excusedAbsent) ? value.excusedAbsent.map(String) : [],
    absentOverWeek: absentNames(value?.absentOverWeek),
    neverSeen: Array.isArray(value?.neverSeen) ? value.neverSeen.map(String) : [],
    scheduleOffSite: Array.isArray(value?.scheduleOffSite)
      ? value.scheduleOffSite.map(String)
      : [],
    clanOnSite: Number(value?.clanOnSite) || 0,
  };
}

function absentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const row = item as { names?: unknown };
    return Array.isArray(row.names) ? row.names.map(String) : [];
  });
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ru", { sensitivity: "base" })
  );
}

function asRow(raw: RawRow): BbTrainReportRow | null {
  if (raw.slot !== "2130" && raw.slot !== "0100") return null;
  return {
    reportDate: raw.reportDate,
    slot: raw.slot,
    peakOnline: Number(raw.peakOnline) || 0,
    joinedTotal: Number(raw.joinedTotal) || 0,
    ydayMissingN: Number(raw.ydayMissingN) || 0,
    weekMissingN: Number(raw.weekMissingN) || 0,
    schedExpected: Number(raw.schedExpected) || 0,
    schedPresent: Number(raw.schedPresent) || 0,
    lateFirstN: Number(raw.lateFirstN) || 0,
    payload: asPayload(raw.payload),
  };
}

export async function listBbTrainDates(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ d: string }[]>`
    SELECT DISTINCT to_char("reportDate", 'YYYY-MM-DD') AS d
    FROM "BbTrainReportV"
    ORDER BY d DESC
  `;
  return rows.map((row) => row.d).filter(Boolean);
}

export async function loadBbTrainReport(
  date: string,
  slot: BbTrainSlot
): Promise<BbTrainReportRow | null> {
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      to_char("reportDate", 'YYYY-MM-DD') AS "reportDate",
      slot,
      "peakOnline",
      "joinedTotal",
      "ydayMissingN",
      "weekMissingN",
      "schedExpected",
      "schedPresent",
      "lateFirstN",
      payload
    FROM "BbTrainReportV"
    WHERE to_char("reportDate", 'YYYY-MM-DD') = ${date}
      AND slot = ${slot}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? asRow(row) : null;
}
