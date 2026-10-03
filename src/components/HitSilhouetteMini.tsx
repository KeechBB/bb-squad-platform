"use client";

type Props = {
  bones: Record<string, number>;
  title?: string;
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
  Bip01_L_UpperArm: "Л. плечо",
  Bip01_R_UpperArm: "П. плечо",
  Bip01_L_Forearm: "Л. предплечье",
  Bip01_R_Forearm: "П. предплечье",
  Bip01_L_Hand: "Л. кисть",
  Bip01_R_Hand: "П. кисть",
  Bip01_L_Thigh: "Л. бедро",
  Bip01_R_Thigh: "П. бедро",
  Bip01_L_Calf: "Л. голень",
  Bip01_R_Calf: "П. голень",
  Bip01_L_Foot: "Л. стопа",
  Bip01_R_Foot: "П. стопа",
};

function isLimb(bone: string) {
  return /Arm|Hand|Thigh|Calf|Foot|Clavicle/i.test(bone);
}

export function HitSilhouetteMini({ bones, title }: Props) {
  const entries = Object.entries(bones || {}).filter(
    ([k, n]) => n > 0 && k !== "None"
  );
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const nums = entries.map(([, n]) => n);
  const minN = nums.length ? Math.min(...nums) : 0;
  const maxN = nums.length ? Math.max(...nums) : 0;

  return (
    <div className="keech-hit-mini">
      {title ? <p className="muted keech-hit-mini-title">{title}</p> : null}
      {total <= 0 ? (
        <p className="muted">Нет хитов BBHitZone за окно до кила</p>
      ) : (
        <div className="keech-hit-mini-body">
          <svg viewBox="0 0 240 360" className="keech-hit-mini-svg" aria-hidden>
            <ellipse cx="120" cy="42" rx="22" ry="26" fill="rgba(167,139,250,0.12)" stroke="rgba(167,139,250,0.35)" />
            <rect x="102" y="68" width="36" height="100" rx="12" fill="rgba(167,139,250,0.1)" stroke="rgba(167,139,250,0.3)" />
            <rect x="70" y="78" width="28" height="90" rx="10" fill="rgba(167,139,250,0.08)" stroke="rgba(167,139,250,0.25)" />
            <rect x="142" y="78" width="28" height="90" rx="10" fill="rgba(167,139,250,0.08)" stroke="rgba(167,139,250,0.25)" />
            <rect x="98" y="168" width="20" height="120" rx="9" fill="rgba(167,139,250,0.08)" stroke="rgba(167,139,250,0.25)" />
            <rect x="122" y="168" width="20" height="120" rx="9" fill="rgba(167,139,250,0.08)" stroke="rgba(167,139,250,0.25)" />
            {entries.map(([bone, n]) => {
              const xy = ANCHORS[bone];
              if (!xy) return null;
              const t = maxN <= minN ? 1 : (n - minN) / (maxN - minN);
              const r = 4 + t * 8;
              const fill = isLimb(bone)
                ? `rgba(250, 204, 21, ${0.45 + t * 0.45})`
                : `rgba(244, 63, 94, ${0.45 + t * 0.45})`;
              return (
                <circle key={bone} cx={xy[0]} cy={xy[1]} r={r} fill={fill} />
              );
            })}
          </svg>
          <ul className="keech-hit-mini-list">
            {entries
              .sort((a, b) => b[1] - a[1])
              .map(([bone, n]) => (
                <li key={bone}>
                  <span>{BONE_RU[bone] || bone.replace(/^Bip01_/, "")}</span>
                  <strong>{n}</strong>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
