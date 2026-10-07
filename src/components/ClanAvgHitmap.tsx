"use client";

import { useId, useMemo, useState } from "react";

export type ClanHitmapData = {
  players: number;
  totalHits: number;
  bonePct: Record<string, number>;
  bones: Record<string, number>;
};

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

const BONE_RU: Record<string, string> = {
  Bip01_Head: "Голова",
  Bip01_Neck: "Шея",
  Bip01_Spine2: "Грудь",
  Bip01_Spine: "Живот",
  Bip01_Pelvis: "Таз",
  Bip01_L_Clavicle: "L ключ.",
  Bip01_R_Clavicle: "R ключ.",
  Bip01_L_UpperArm: "L плечо",
  Bip01_R_UpperArm: "R плечо",
  Bip01_L_Forearm: "L предпл.",
  Bip01_R_Forearm: "R предпл.",
  Bip01_L_Hand: "L кисть",
  Bip01_R_Hand: "R кисть",
  Bip01_L_Thigh: "L бедро",
  Bip01_R_Thigh: "R бедро",
  Bip01_L_Calf: "L голень",
  Bip01_R_Calf: "R голень",
  Bip01_L_Foot: "L стопа",
  Bip01_R_Foot: "R стопа",
};

function isLimbBone(bone: string): boolean {
  return (
    bone.includes("UpperArm") ||
    bone.includes("Forearm") ||
    bone.includes("Hand") ||
    bone.includes("Thigh") ||
    bone.includes("Calf") ||
    bone.includes("Foot")
  );
}

function dotsForShare(n: number, minN: number, maxN: number): number {
  if (n <= 0) return 0;
  if (maxN <= minN) return 12;
  const t = (n - minN) / (maxN - minN);
  return Math.max(1, Math.min(12, Math.round(1 + t * 11)));
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

type Props = { data: ClanHitmapData };

/** Компактный средний хитмап клана: 1 человечек = среднее по всем. */
export function ClanAvgHitmap({ data }: Props) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<string | null>(null);

  const { plot, minHits, maxHits, strip } = useMemo(() => {
    const entries = Object.entries(data.bones || {})
      .filter(([k, n]) => n > 0 && k !== "None" && ANCHORS[k])
      .map(([k, n]) => [k, n] as [string, number]);
    let minH = Infinity;
    let maxH = 0;
    for (const [, n] of entries) {
      if (n < minH) minH = n;
      if (n > maxH) maxH = n;
    }
    if (!Number.isFinite(minH)) minH = 0;

    const stripRows = Object.entries(data.bonePct || {})
      .filter(([, p]) => p > 0)
      .map(([bone, pct]) => ({
        bone,
        label: BONE_RU[bone] || bone.replace(/^Bip01_/, ""),
        pct,
      }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8);

    return {
      plot: entries,
      minHits: minH,
      maxHits: maxH,
      strip: stripRows,
    };
  }, [data]);

  const hoverPct = hover ? data.bonePct?.[hover] : null;

  return (
    <div className="clan-avg-hitmap">
      <div className="clan-avg-hitmap-head">
        <strong>Средние попадания</strong>
        <span className="muted">
          {data.players} игр. · {data.totalHits.toLocaleString("ru-RU")} хит.
        </span>
      </div>
      <div className="clan-avg-hitmap-body">
        <svg
          className="clan-avg-hitmap-svg"
          viewBox="0 0 240 380"
          role="img"
          aria-label="Средняя карта попаданий клана"
        >
          <defs>
            <radialGradient id={`cskin-${uid}`} cx="50%" cy="30%" r="70%">
              <stop offset="0%" stopColor="rgba(243,230,216,0.55)" />
              <stop offset="100%" stopColor="rgba(90,72,58,0.45)" />
            </radialGradient>
          </defs>
          <g
            fill={`url(#cskin-${uid})`}
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
          {plot.flatMap(([bone, n]) => {
            const [cx, cy] = ANCHORS[bone];
            const show = dotsForShare(n, minHits, maxHits);
            const limb = isLimbBone(bone);
            return offsets(show).map(([dx, dy], i) => (
              <circle
                key={`${bone}-${i}`}
                cx={cx + dx}
                cy={cy + dy}
                r={3}
                fill={limb ? "#f97316" : "#e11d48"}
                stroke="rgba(255,241,242,0.65)"
                strokeWidth={0.6}
                style={{ pointerEvents: "none" }}
              />
            ));
          })}
          {Object.keys(ANCHORS).map((bone) => {
            const [cx, cy] = ANCHORS[bone];
            return (
              <circle
                key={`z-${bone}`}
                cx={cx}
                cy={cy}
                r={14}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(bone)}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {BONE_RU[bone] || bone}
                  {data.bonePct?.[bone]
                    ? ` · ${data.bonePct[bone]}%`
                    : ""}
                </title>
              </circle>
            );
          })}
        </svg>
        <ul className="clan-avg-hitmap-strip">
          {strip.map((r) => (
            <li
              key={r.bone}
              className={hover === r.bone ? "is-on" : undefined}
              onMouseEnter={() => setHover(r.bone)}
              onMouseLeave={() => setHover(null)}
            >
              <span>{r.label}</span>
              <strong>{r.pct}%</strong>
            </li>
          ))}
          {hover && hoverPct != null ? (
            <li className="clan-avg-hitmap-hover muted">
              {BONE_RU[hover] || hover}: {hoverPct}%
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
