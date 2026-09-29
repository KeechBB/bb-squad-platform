/**
 * Канон стандартных китов Squad (DeployRole → семья).
 * Правило: `.cursor/rules/squad-kits-canon.mdc`
 */

export const STANDARD_KITS = [
  "Командир отряда",
  "Стрелок",
  "Медик",
  "Легкий Пулемет",
  "Тяжелый Пулемет",
  "Сапер/Инженер",
  "Командир Мехводов",
  "Мехвод",
  "Гранатомет подствельный",
  "Легкая Труба",
  "Тандем",
  "Снайпер",
  "Марксман",
  "Разведчик",
  "Рейдер",
  "Пилот",
] as const;

export type StandardKit = (typeof STANDARD_KITS)[number];

type Rule = { re: RegExp; kit: StandardKit | null };

/** Специфичное раньше общего SL / Rifleman. null = отбросить (CQB и т.п.). */
const KIT_RULES: Rule[] = [
  { re: /^CQB(_|$)/i, kit: null },
  { re: /Pilot/i, kit: "Пилот" },
  {
    re: /Crewman.*(^|_)SL(_|$)|Crewman.*Lead|Vehicle.*(Lead|Commander)|LeadCrewman|CrewLead/i,
    kit: "Командир Мехводов",
  },
  { re: /Crewman|CrewMan/i, kit: "Мехвод" },
  { re: /Medic|Corpsman/i, kit: "Медик" },
  { re: /HeavyMachine|HMG/i, kit: "Тяжелый Пулемет" },
  {
    re: /Autorifleman|LightMachine|LMG|MachineGun|Machinegunner/i,
    kit: "Легкий Пулемет",
  },
  { re: /Sapper|CombatEngineer|Engineer|Pioneer/i, kit: "Сапер/Инженер" },
  { re: /Grenadier/i, kit: "Гранатомет подствельный" },
  { re: /HAT|HeavyAntiTank|Tandem/i, kit: "Тандем" },
  { re: /LAT|LightAntiTank/i, kit: "Легкая Труба" },
  { re: /Sniper/i, kit: "Снайпер" },
  { re: /Marksman|Sharpshooter/i, kit: "Марксман" },
  { re: /Scout|Recon/i, kit: "Разведчик" },
  { re: /Raider/i, kit: "Рейдер" },
  {
    re: /(^|_)SL(_|$)|SquadLead|SquadLeader|Officer|Commander/i,
    kit: "Командир отряда",
  },
  { re: /Rifleman|Recruit/i, kit: "Стрелок" },
];

/** DeployRole → канон-кит или null (не учитывать). */
export function kitFromDeployRole(roleRaw: string): StandardKit | null {
  const role = (roleRaw || "").trim();
  if (!role) return null;
  for (const { re, kit } of KIT_RULES) {
    if (re.test(role)) return kit;
  }
  return null;
}

export type KitPctRow = { kit: StandardKit; pct: number };

/** Счётчики → % (сумма ≈ 100). Только киты с n>0. */
export function kitCountsToPct(
  counts: Partial<Record<string, number>>
): KitPctRow[] {
  const rows: { kit: StandardKit; n: number }[] = [];
  let total = 0;
  for (const kit of STANDARD_KITS) {
    const n = Number(counts[kit]) || 0;
    if (n <= 0) continue;
    rows.push({ kit, n });
    total += n;
  }
  if (total <= 0) return [];
  const out: KitPctRow[] = rows.map(({ kit, n }) => ({
    kit,
    pct: Math.round((1000 * n) / total) / 10,
  }));
  const drift = Math.round((100 - out.reduce((s, r) => s + r.pct, 0)) * 10) / 10;
  if (out.length && Math.abs(drift) >= 0.1) {
    out[0] = { ...out[0], pct: Math.round((out[0].pct + drift) * 10) / 10 };
  }
  out.sort((a, b) => b.pct - a.pct || a.kit.localeCompare(b.kit, "ru"));
  return out;
}

/** Цвета долей под тёмную тему сайта (фиолетовый акцент). */
export const KIT_SLICE_COLORS = [
  "#a78bfa",
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f97316",
  "#f472b6",
  "#22d3ee",
  "#c084fc",
  "#4ade80",
  "#fb7185",
  "#38bdf8",
  "#eab308",
  "#a3e635",
  "#e879f9",
  "#2dd4bf",
  "#94a3b8",
] as const;
