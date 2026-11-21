import { prisma } from "@/lib/prisma";

const STEAM_RE = /^7656\d{13}$/;
const MAX_LABELS = 8;
const MAX_NOTES = 80;

export type PanelkaMemoRow = {
  id: string;
  kind: "note" | "label";
  text: string;
  byNick: string;
  createdAt: string;
};

function cleanText(raw: string, limit: number): string {
  return String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function textKeyOf(raw: string): string {
  return cleanText(raw, 64).toLowerCase();
}

/** Label: max 3 words, short. */
export function normalizeLabel(raw: string): string | null {
  const text = cleanText(raw, 36);
  if (!text) return null;
  const words = text.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 3) return null;
  return words.join(" ");
}

export async function listPanelkaMemos(steamId: string): Promise<{
  notes: PanelkaMemoRow[];
  labels: PanelkaMemoRow[];
}> {
  if (!STEAM_RE.test(steamId)) return { notes: [], labels: [] };
  const rows = await prisma.panelkaPlayerMemo.findMany({
    where: { steamId },
    orderBy: { createdAt: "desc" },
    take: 120,
  });
  const map = (r: (typeof rows)[number]): PanelkaMemoRow => ({
    id: r.id,
    kind: r.kind === "label" ? "label" : "note",
    text: r.text,
    byNick: r.byNick,
    createdAt: r.createdAt.toISOString(),
  });
  return {
    notes: rows.filter((r) => r.kind === "note").map(map).slice(0, MAX_NOTES),
    labels: rows
      .filter((r) => r.kind === "label")
      .map(map)
      .slice(0, MAX_LABELS)
      .reverse(), // oldest first in header
  };
}

export async function addPanelkaNote(opts: {
  steamId: string;
  text: string;
  byNick: string;
  byUserId?: string | null;
  bySteamId?: string | null;
}): Promise<{ ok: true; row: PanelkaMemoRow } | { ok: false; error: string }> {
  if (!STEAM_RE.test(opts.steamId)) return { ok: false, error: "нет Steam ID" };
  const text = cleanText(opts.text, 500);
  if (text.length < 2) return { ok: false, error: "напиши заметку" };
  const byNick = cleanText(opts.byNick, 32) || "штаб";
  const row = await prisma.panelkaPlayerMemo.create({
    data: {
      steamId: opts.steamId,
      kind: "note",
      text,
      textKey: "",
      byNick,
      byUserId: opts.byUserId || null,
      bySteamId: opts.bySteamId || null,
    },
  });
  return {
    ok: true,
    row: {
      id: row.id,
      kind: "note",
      text: row.text,
      byNick: row.byNick,
      createdAt: row.createdAt.toISOString(),
    },
  };
}

export async function addPanelkaLabel(opts: {
  steamId: string;
  text: string;
  byNick: string;
  byUserId?: string | null;
  bySteamId?: string | null;
}): Promise<{ ok: true; row: PanelkaMemoRow } | { ok: false; error: string }> {
  if (!STEAM_RE.test(opts.steamId)) return { ok: false, error: "нет Steam ID" };
  const text = normalizeLabel(opts.text);
  if (!text) return { ok: false, error: "ярлык: до 3 слов" };
  const key = textKeyOf(text);
  const count = await prisma.panelkaPlayerMemo.count({
    where: { steamId: opts.steamId, kind: "label" },
  });
  if (count >= MAX_LABELS) return { ok: false, error: `макс. ${MAX_LABELS} ярлыков` };
  const exists = await prisma.panelkaPlayerMemo.findFirst({
    where: { steamId: opts.steamId, kind: "label", textKey: key },
  });
  if (exists) return { ok: false, error: "такой ярлык уже есть" };
  const byNick = cleanText(opts.byNick, 32) || "штаб";
  const row = await prisma.panelkaPlayerMemo.create({
    data: {
      steamId: opts.steamId,
      kind: "label",
      text,
      textKey: key,
      byNick,
      byUserId: opts.byUserId || null,
      bySteamId: opts.bySteamId || null,
    },
  });
  return {
    ok: true,
    row: {
      id: row.id,
      kind: "label",
      text: row.text,
      byNick: row.byNick,
      createdAt: row.createdAt.toISOString(),
    },
  };
}

export async function removePanelkaMemo(
  id: string,
  steamId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id || !STEAM_RE.test(steamId)) return { ok: false, error: "нельзя" };
  const row = await prisma.panelkaPlayerMemo.findFirst({ where: { id, steamId } });
  if (!row) return { ok: false, error: "не найдено" };
  await prisma.panelkaPlayerMemo.delete({ where: { id } });
  return { ok: true };
}
