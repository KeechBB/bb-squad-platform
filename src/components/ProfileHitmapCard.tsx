"use client";

import { useId, useMemo } from "react";

export type HitBoneCounts = Record<string, number>;

type Props = {
  bones?: HitBoneCounts | null;
  /** подпись под заголовком */
  subtitle?: string | null;
};

/** Макс. точек на кости на силуэте (остальное только в полоске %). */
const MAX_DOTS_PER_BONE = 12;

const ANCHORS: Record<string, [number, number]> = {
  Bip01_Head: [120, 48],
  Bip01_Neck: [120, 72],
  Bip01_Spine2: [120, 108],
  Bip01_Spine: [120, 138],
  Bip01_Pelvis: [120, 168],
  Bip01_L_Clavicle: [98, 88],
  Bip01_R_Clavicle: [142, 88],
  Bip01_L_UpperArm: [78, 108],
  Bip01_R_UpperArm: [162, 108],
  Bip01_L_Forearm: [58, 148],
  Bip01_R_Forearm: [182, 148],
  Bip01_L_Hand: [42, 178],
  Bip01_R_Hand: [198, 178],
  Bip01_L_Thigh: [102, 215],
  Bip01_R_Thigh: [138, 215],
  Bip01_L_Calf: [100, 275],
  Bip01_R_Calf: [140, 275],
  Bip01_L_Foot: [98, 330],
  Bip01_R_Foot: [142, 330],
};

/** Порядок в боковой полоске — сверху вниз по телу. */
const BONE_ORDER = [
  "Bip01_Head",
  "Bip01_Neck",
  "Bip01_L_Clavicle",
  "Bip01_R_Clavicle",
  "Bip01_Spine2",
  "Bip01_Spine",
  "Bip01_Pelvis",
  "Bip01_L_UpperArm",
  "Bip01_R_UpperArm",
  "Bip01_L_Forearm",
  "Bip01_R_Forearm",
  "Bip01_L_Hand",
  "Bip01_R_Hand",
  "Bip01_L_Thigh",
  "Bip01_R_Thigh",
  "Bip01_L_Calf",
  "Bip01_R_Calf",
  "Bip01_L_Foot",
  "Bip01_R_Foot",
] as const;

const BONE_RU: Record<string, string> = {
  Bip01_Head: "Голова",
  Bip01_Neck: "Шея",
  Bip01_Spine2: "Грудь",
  Bip01_Spine: "Живот",
  Bip01_Pelvis: "Таз",
  Bip01_L_Clavicle: "L ключица",
  Bip01_R_Clavicle: "R ключица",
  Bip01_L_UpperArm: "L плечо",
  Bip01_R_UpperArm: "R плечо",
  Bip01_L_Forearm: "L предплечье",
  Bip01_R_Forearm: "R предплечье",
  Bip01_L_Hand: "L кисть",
  Bip01_R_Hand: "R кисть",
  Bip01_L_Thigh: "L бедро",
  Bip01_R_Thigh: "R бедро",
  Bip01_L_Calf: "L голень",
  Bip01_R_Calf: "R голень",
  Bip01_L_Foot: "L стопа",
  Bip01_R_Foot: "R стопа",
};

/** С какой стороны рисовать выноску (стрелочку + цифры). */
function calloutSide(bone: string): "L" | "R" {
  if (
    bone.includes("_R_") ||
    bone === "Bip01_Head" ||
    bone === "Bip01_Neck" ||
    bone === "Bip01_Spine2" ||
    bone === "Bip01_Spine" ||
    bone === "Bip01_Pelvis"
  ) {
    return bone.includes("_L_") ? "L" : "R";
  }
  return "L";
}

function offsets(n: number): [number, number][] {
  if (n <= 0) return [];
  const out: [number, number][] = [[0, 0]];
  for (let i = 1; i < n; i++) {
    const ang = i * 2.399;
    const r = 3.2 + 2.1 * Math.sqrt(i);
    out.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }
  return out;
}

function pct(n: number, total: number): string {
  if (total <= 0 || n <= 0) return "0%";
  const v = Math.round((1000 * n) / total) / 10;
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
}

export function ProfileHitmapCard({ bones, subtitle }: Props) {
  const uid = useId().replace(/:/g, "");
  const { total, strip, plot } = useMemo(() => {
    const map = bones || {};
    let sum = 0;
    for (const [k, n] of Object.entries(map)) {
      if (n > 0 && k !== "None") sum += n;
    }
    const stripRows: {
      bone: string;
      label: string;
      n: number;
      pct: string;
    }[] = BONE_ORDER.filter((b) => (map[b] || 0) > 0).map((b) => ({
      bone: b,
      label: BONE_RU[b] || b,
      n: map[b] || 0,
      pct: pct(map[b] || 0, sum),
    }));
    const known = new Set<string>(BONE_ORDER);
    for (const [k, n] of Object.entries(map)) {
      if (n <= 0 || k === "None" || known.has(k)) continue;
      stripRows.push({
        bone: k,
        label: BONE_RU[k] || k.replace(/^Bip01_/, ""),
        n,
        pct: pct(n, sum),
      });
    }
    const plotBones = Object.entries(map)
      .filter(([k, n]) => n > 0 && k !== "None" && ANCHORS[k])
      .map(([k, n]) => [k, n] as [string, number]);
    return { total: sum, strip: stripRows, plot: plotBones };
  }, [bones]);

  return (
    <section className="card profile-hitmap-card">
      <div className="profile-kv-head">
        <h2>Попадания</h2>
        <span className="muted profile-hitmap-sub">
          {subtitle || (total > 0 ? "TR1" : "Нет данных с TR1")}
        </span>
      </div>

      <div className="profile-hitmap-total" aria-label="Всего попаданий">
        <span className="profile-hitmap-total-label">Всего попаданий</span>
        <strong className="profile-hitmap-total-n">{total}</strong>
      </div>

      <div className="profile-hitmap-split">
        <div className="profile-hitmap-body-wrap">
          <svg
            className="profile-hitmap-svg"
            role="img"
            viewBox="0 0 240 380"
            aria-label="Карта попаданий по костям"
          >
            <defs>
              <radialGradient id={`skin-${uid}`} cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="rgba(243,230,216,0.55)" />
                <stop offset="100%" stopColor="rgba(90,72,58,0.45)" />
              </radialGradient>
            </defs>
            <g
              fill={`url(#skin-${uid})`}
              stroke="rgba(203,183,164,0.85)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            >
              <ellipse cx="120" cy="46" rx="23" ry="26" />
              <path d="M108 70 C108 78 110 82 112 86 L128 86 C130 82 132 78 132 70 Z" />
              <path d="M96 86 C78 92 70 110 72 130 C74 155 82 168 92 175 L148 175 C158 168 166 155 168 130 C170 110 162 92 144 86 C136 84 128 83 120 83 C112 83 104 84 96 86 Z" />
              <path d="M78 92 C62 100 54 118 52 136 C50 150 54 158 62 160 C70 150 76 132 82 112 Z" />
              <path d="M162 92 C178 100 186 118 188 136 C190 150 186 158 178 160 C170 150 164 132 158 112 Z" />
              <path d="M54 158 C44 170 38 188 40 200 C48 204 58 196 64 180 C66 170 62 162 54 158 Z" />
              <path d="M186 158 C196 170 202 188 200 200 C192 204 182 196 176 180 C174 170 178 162 186 158 Z" />
              <path d="M94 174 C96 200 98 230 100 255 L114 255 C116 230 114 200 112 174 Z" />
              <path d="M128 174 C126 200 124 230 126 255 L140 255 C142 230 144 200 146 174 Z" />
              <path d="M100 255 C98 280 96 305 98 325 L112 325 C114 305 114 280 114 255 Z" />
              <path d="M126 255 C126 280 126 305 128 325 L142 325 C144 305 142 280 140 255 Z" />
              <ellipse cx="104" cy="332" rx="14" ry="6" />
              <ellipse cx="136" cy="332" rx="14" ry="6" />
            </g>
            <g fill="none" stroke="rgba(168,144,120,0.35)" strokeWidth="0.7">
              <path d="M120 88 L120 168" />
              <path d="M100 110 C110 118 130 118 140 110" />
            </g>
            <g aria-label="хиты">
              {plot.flatMap(([bone, n]) => {
                const [cx, cy] = ANCHORS[bone];
                const show = Math.min(n, MAX_DOTS_PER_BONE);
                return offsets(show).map(([dx, dy], i) => (
                  <circle
                    key={`${bone}-${i}`}
                    cx={cx + dx}
                    cy={cy + dy}
                    r={3.2}
                    fill="#e11d48"
                    stroke="rgba(255,241,242,0.7)"
                    strokeWidth={0.7}
                  />
                ));
              })}
            </g>
            <g aria-label="цифры по частям" className="profile-hitmap-callouts">
              {plot.map(([bone, n]) => {
                const [cx, cy] = ANCHORS[bone];
                const side = calloutSide(bone);
                const tipX = side === "L" ? cx - 14 : cx + 14;
                const labelX = side === "L" ? 4 : 236;
                const anchor = side === "L" ? "start" : "end";
                const p = pct(n, total);
                return (
                  <g key={`call-${bone}`}>
                    <path
                      d={`M${tipX} ${cy} L${side === "L" ? labelX + 36 : labelX - 36} ${cy}`}
                      stroke="rgba(225,29,72,0.55)"
                      strokeWidth="0.9"
                      fill="none"
                    />
                    <circle cx={tipX} cy={cy} r={1.6} fill="#e11d48" />
                    <text
                      x={labelX}
                      y={cy + 3}
                      textAnchor={anchor}
                      fill="#fde2e8"
                      fontSize="8.5"
                      fontWeight="700"
                      fontFamily="ui-monospace, monospace"
                    >
                      {n}
                      <tspan fill="rgba(203,183,164,0.95)" fontWeight="500">
                        {" "}
                        {p}
                      </tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        {strip.length > 0 ? (
          <aside
            className="profile-hitmap-strip"
            aria-label="Доля попаданий по частям тела"
          >
            <ul className="profile-hitmap-strip-list">
              {strip.map((row) => (
                <li key={row.bone} className="profile-hitmap-strip-row">
                  <span className="profile-hitmap-strip-dot" aria-hidden="true" />
                  <span className="profile-hitmap-strip-name" title={row.label}>
                    {row.label}
                  </span>
                  <span className="profile-hitmap-strip-n">{row.n}</span>
                  <span className="profile-hitmap-strip-pct">{row.pct}</span>
                </li>
              ))}
            </ul>
          </aside>
        ) : (
          <p className="muted profile-hitmap-empty">
            Попадания появятся после стрельбы на TR1 (мод BBHitZone).
          </p>
        )}
      </div>
    </section>
  );
}
