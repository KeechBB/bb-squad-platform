/**
 * Чтение анкеты recruit-bot (sqlite) для СРИ.
 * Путь на VPS: recruit-bot/data/recruit.sqlite
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export type RecruitDossier = {
  tgId: number | null;
  tgUsername: string | null;
  tgFirst: string | null;
  gameNick: string | null;
  realName: string | null;
  steamId: string | null;
  step: string | null;
  squadHours: string | null;
  priorClans: string | null;
  applicantAge: string | null;
  acceptedAt: string | null;
};

const BOT_DB_CANDIDATES = [
  path.join(process.cwd(), "recruit-bot", "data", "recruit.sqlite"),
  "/var/www/bb-squad-platform/recruit-bot/data/recruit.sqlite",
];

function botDbPath(): string | null {
  for (const p of BOT_DB_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Нормальный TG username: 5+ символов, [A-Za-z0-9_]. */
export function hasNormalTgUsername(raw: string | null | undefined): boolean {
  const u = String(raw || "")
    .trim()
    .replace(/^@+/, "");
  if (u.length < 5) return false;
  return /^[A-Za-z0-9_]+$/.test(u);
}

export function loadRecruitDossierBySteam(
  steamId: string
): RecruitDossier | null {
  const steam = (steamId || "").trim();
  if (!steam) return null;
  const dbPath = botDbPath();
  if (!dbPath) return null;
  const py = `
import sqlite3, json, sys
db=sys.argv[1]; steam=sys.argv[2]
c=sqlite3.connect(db)
c.row_factory=sqlite3.Row
row=c.execute(
  """
  SELECT tg_id, tg_username, tg_first, game_nick, real_name, steam_id, step,
         squad_hours, prior_clans, applicant_age, accepted_at
  FROM applicants
  WHERE steam_id=? AND step!='removed'
  ORDER BY CASE WHEN step='done' THEN 0 ELSE 1 END, updated_at DESC
  LIMIT 1
  """,
  (steam,),
).fetchone()
if not row:
  # fallback: any row with this steam including removed
  row=c.execute(
    """
    SELECT tg_id, tg_username, tg_first, game_nick, real_name, steam_id, step,
           squad_hours, prior_clans, applicant_age, accepted_at
    FROM applicants WHERE steam_id=?
    ORDER BY updated_at DESC LIMIT 1
    """,
    (steam,),
  ).fetchone()
print(json.dumps(dict(row) if row else None, ensure_ascii=False))
`;
  try {
    const out = execFileSync("python3", ["-c", py, dbPath, steam], {
      encoding: "utf8",
      timeout: 8000,
    });
    const raw = JSON.parse(out || "null") as Record<string, unknown> | null;
    if (!raw) return null;
    return {
      tgId: raw.tg_id == null ? null : Number(raw.tg_id),
      tgUsername: raw.tg_username ? String(raw.tg_username) : null,
      tgFirst: raw.tg_first ? String(raw.tg_first) : null,
      gameNick: raw.game_nick ? String(raw.game_nick) : null,
      realName: raw.real_name ? String(raw.real_name) : null,
      steamId: raw.steam_id ? String(raw.steam_id) : steam,
      step: raw.step ? String(raw.step) : null,
      squadHours: raw.squad_hours ? String(raw.squad_hours) : null,
      priorClans: raw.prior_clans ? String(raw.prior_clans) : null,
      applicantAge: raw.applicant_age ? String(raw.applicant_age) : null,
      acceptedAt: raw.accepted_at ? String(raw.accepted_at) : null,
    };
  } catch (e) {
    console.error("recruit dossier lookup failed", e);
    return null;
  }
}

export function formatDossierBlock(d: RecruitDossier | null, fallbackNick: string): string {
  const tg = d?.tgUsername
    ? hasNormalTgUsername(d.tgUsername)
      ? `@${String(d.tgUsername).replace(/^@+/, "")}`
      : String(d.tgUsername)
    : "— (нет username)";
  const lines = [
    "Данные регистрации (конфиденциально: только глава / зам / Keech):",
    `Ник: ${d?.gameNick || fallbackNick}`,
    `Имя: ${d?.realName || "—"}`,
    `Telegram: ${tg}`,
    `Telegram ID: ${d?.tgId ?? "—"}`,
    `Имя в TG: ${d?.tgFirst || "—"}`,
    `SteamID64: ${d?.steamId || "—"}`,
    `Часы в Squad: ${d?.squadHours || "—"}`,
    `Предыдущие кланы: ${d?.priorClans || "—"}`,
    `Возраст / дата рождения: ${d?.applicantAge || "—"}`,
    `Шаг бота: ${d?.step || "—"}`,
    `Принят: ${d?.acceptedAt || "—"}`,
  ];
  return lines.join("\n");
}
