"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export type HitBoneCounts = Record<string, number>;

type Props = {
  userId: string;
  bones?: HitBoneCounts | null;
  /** кость последнего зафиксированного попадания */
  lastBone?: string | null;
  /** подпись под заголовком */
  subtitle?: string | null;
};

const MONTH_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const DOW_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function formatRuDay(s: string) {
  const p = parseYmd(s);
  if (!p) return s;
  return `${pad2(p.d)}.${pad2(p.m)}.${p.y}`;
}

function todayMskYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Точки: кость с макс.% → 15, с мин.% → 1 (относительно этого игрока). */
const DOTS_MIN = 1;
const DOTS_MAX = 15;

/** Руки и ноги — жёлтые точки (не торс/голова). */
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
  if (maxN <= minN) return DOTS_MAX;
  const t = (n - minN) / (maxN - minN);
  return Math.max(
    DOTS_MIN,
    Math.min(DOTS_MAX, Math.round(DOTS_MIN + t * (DOTS_MAX - DOTS_MIN)))
  );
}

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

/** Радиус невидимой зоны наведения вокруг якоря кости. */
const ZONE_R: Record<string, number> = {
  Bip01_Head: 22,
  Bip01_Neck: 12,
  Bip01_Spine2: 20,
  Bip01_Spine: 18,
  Bip01_Pelvis: 18,
  Bip01_L_Clavicle: 12,
  Bip01_R_Clavicle: 12,
  Bip01_L_UpperArm: 16,
  Bip01_R_UpperArm: 16,
  Bip01_L_Forearm: 14,
  Bip01_R_Forearm: 14,
  Bip01_L_Hand: 12,
  Bip01_R_Hand: 12,
  Bip01_L_Thigh: 16,
  Bip01_R_Thigh: 16,
  Bip01_L_Calf: 14,
  Bip01_R_Calf: 14,
  Bip01_L_Foot: 12,
  Bip01_R_Foot: 12,
};

function pct(n: number, total: number): string {
  if (total <= 0 || n <= 0) return "0%";
  const v = Math.round((1000 * n) / total) / 10;
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
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

export function ProfileHitmapCard({
  userId,
  bones: initialBones,
  lastBone: initialLastBone,
  subtitle,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const [bones, setBones] = useState<HitBoneCounts>(initialBones || {});
  const [lastBone, setLastBone] = useState<string | null>(
    initialLastBone || null
  );
  const [day, setDay] = useState<string | null>(null);
  const [hitDays, setHitDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const today = todayMskYmd();
  const todayParts = parseYmd(today)!;
  const [viewY, setViewY] = useState(todayParts.y);
  const [viewM, setViewM] = useState(todayParts.m);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBones(initialBones || {});
    setLastBone(initialLastBone || null);
    setDay(null);
  }, [initialBones, initialLastBone, userId]);

  const load = useCallback(
    async (dayYmd: string | null, withDays: boolean) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ userId });
        if (dayYmd) q.set("day", dayYmd);
        if (withDays) q.set("days", "1");
        const res = await fetch(`/api/hitmap?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          bones?: HitBoneCounts;
          lastBone?: string | null;
          days?: string[];
        };
        setBones(data.bones || {});
        setLastBone(data.lastBone || null);
        if (Array.isArray(data.days)) {
          setHitDays(new Set(data.days));
        }
      } catch {
        /* leave previous */
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void load(null, true);
  }, [load]);

  useEffect(() => {
    if (!calOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setCalOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [calOpen]);

  const selectAllTime = () => {
    setDay(null);
    setCalOpen(false);
    void load(null, false);
  };

  const selectDay = (ymdStr: string) => {
    setDay(ymdStr);
    setCalOpen(false);
    void load(ymdStr, false);
  };

  const openCal = () => {
    if (day) {
      const p = parseYmd(day);
      if (p) {
        setViewY(p.y);
        setViewM(p.m);
      }
    } else {
      setViewY(todayParts.y);
      setViewM(todayParts.m);
    }
    setCalOpen((v) => !v);
  };

  const shiftMonth = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    setViewY(y);
    setViewM(m);
  };

  const calCells = useMemo(() => {
    const first = new Date(Date.UTC(viewY, viewM - 1, 1));
    const start = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(viewY, viewM, 0)).getUTCDate();
    const cells: Array<{ day: number | null; ymd: string | null }> = [];
    for (let i = 0; i < start; i++) cells.push({ day: null, ymd: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, ymd: ymd(viewY, viewM, d) });
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, ymd: null });
    return cells;
  }, [viewY, viewM]);

  const [hoverBone, setHoverBone] = useState<string | null>(null);

  const { total, strip, plot, minHits, maxHits } = useMemo(() => {
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
    stripRows.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "ru"));
    const plotBones = Object.entries(map)
      .filter(([k, n]) => n > 0 && k !== "None" && ANCHORS[k])
      .map(([k, n]) => [k, n] as [string, number]);
    let minH = Infinity;
    let maxH = 0;
    for (const [, n] of plotBones) {
      if (n < minH) minH = n;
      if (n > maxH) maxH = n;
    }
    if (!Number.isFinite(minH)) minH = 0;
    return {
      total: sum,
      strip: stripRows,
      plot: plotBones,
      minHits: minH,
      maxHits: maxH,
    };
  }, [bones]);

  const periodLabel = day ? formatRuDay(day) : "всё время";

  return (
    <section className="card profile-hitmap-card">
      <div className="profile-hitmap-head">
        <div className="profile-hitmap-head-text">
          <h2>Попадания</h2>
          <span className="muted profile-hitmap-sub">
            {subtitle || "TR1+TR2"} · {periodLabel}
            {loading ? "…" : ""}
          </span>
        </div>
        <div className="profile-hitmap-filter" ref={wrapRef}>
          <button
            type="button"
            className={
              day == null
                ? "profile-hitmap-filter-btn is-active"
                : "profile-hitmap-filter-btn"
            }
            onClick={selectAllTime}
          >
            Всё время
          </button>
          <button
            type="button"
            className={
              day
                ? "profile-hitmap-filter-btn is-active"
                : "profile-hitmap-filter-btn"
            }
            onClick={openCal}
            aria-expanded={calOpen}
            aria-haspopup="dialog"
            title="Выбрать день"
          >
            {day ? formatRuDay(day) : "День"}
          </button>
          {calOpen ? (
            <div
              className="profile-hitmap-cal"
              role="dialog"
              aria-label="Календарь"
            >
              <div className="profile-hitmap-cal-nav">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Пред. месяц"
                >
                  ‹
                </button>
                <strong>
                  {MONTH_RU[viewM - 1]} {viewY}
                </strong>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="След. месяц"
                >
                  ›
                </button>
              </div>
              <div className="profile-hitmap-cal-dow">
                {DOW_RU.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="profile-hitmap-cal-grid">
                {calCells.map((c, i) =>
                  c.day == null || !c.ymd ? (
                    <span key={`e-${i}`} className="profile-hitmap-cal-empty" />
                  ) : (
                    <button
                      key={c.ymd}
                      type="button"
                      className={[
                        "profile-hitmap-cal-day",
                        day === c.ymd ? "is-selected" : "",
                        c.ymd === today ? "is-today" : "",
                        hitDays.has(c.ymd) ? "has-hits" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => selectDay(c.ymd!)}
                    >
                      {c.day}
                    </button>
                  )
                )}
              </div>
            </div>
          ) : null}
        </div>
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
                const show = dotsForShare(n, minHits, maxHits);
                const limb = isLimbBone(bone);
                const isLast = Boolean(lastBone && bone === lastBone);
                return offsets(show).map(([dx, dy], i) => {
                  const lastDot = isLast && i === 0;
                  const orange = limb || lastDot;
                  return (
                    <circle
                      key={`${bone}-${i}`}
                      cx={cx + dx}
                      cy={cy + dy}
                      r={lastDot ? 4.4 : 3.2}
                      fill={orange ? "#f97316" : "#e11d48"}
                      stroke={
                        orange
                          ? "rgba(255, 237, 213, 0.95)"
                          : "rgba(255,241,242,0.7)"
                      }
                      strokeWidth={lastDot ? 1.2 : 0.7}
                      style={{ pointerEvents: "none" }}
                    >
                      {lastDot ? <title>Последнее попадание</title> : null}
                    </circle>
                  );
                });
              })}
            </g>
            <g aria-label="зоны наведения">
              {BONE_ORDER.map((bone) => {
                const [cx, cy] = ANCHORS[bone];
                const r = ZONE_R[bone] || 14;
                const active = hoverBone === bone;
                const n = bones?.[bone] || 0;
                return (
                  <g key={`zone-${bone}`}>
                    {active ? (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r + 4}
                        className="hitmap-zone-glow"
                        fill="rgba(167, 139, 250, 0.28)"
                        stroke="rgba(196, 181, 253, 0.85)"
                        strokeWidth="1.5"
                        style={{ pointerEvents: "none" }}
                      />
                    ) : null}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="transparent"
                      className="hitmap-zone-hit"
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHoverBone(bone)}
                      onMouseLeave={() => setHoverBone(null)}
                      onFocus={() => setHoverBone(bone)}
                      onBlur={() => setHoverBone(null)}
                      tabIndex={0}
                      role="img"
                      aria-label={BONE_RU[bone] || bone}
                    >
                      <title>
                        {BONE_RU[bone] || bone}
                        {n > 0 ? ` · ${n} (${pct(n, total)})` : ""}
                      </title>
                    </circle>
                  </g>
                );
              })}
            </g>
            {hoverBone ? (
              <g className="hitmap-zone-label" style={{ pointerEvents: "none" }}>
                {(() => {
                  const [cx, cy] = ANCHORS[hoverBone];
                  const label = BONE_RU[hoverBone] || hoverBone;
                  const n = bones?.[hoverBone] || 0;
                  const sub =
                    n > 0 ? `${n} · ${pct(n, total)}` : "нет попаданий";
                  const boxW = Math.max(72, label.length * 7.2 + 16);
                  const boxX = Math.min(
                    240 - boxW - 4,
                    Math.max(4, cx - boxW / 2)
                  );
                  const boxY = Math.max(8, cy - (ZONE_R[hoverBone] || 14) - 36);
                  return (
                    <>
                      <rect
                        x={boxX}
                        y={boxY}
                        width={boxW}
                        height={30}
                        rx={6}
                        fill="rgba(20, 16, 32, 0.92)"
                        stroke="rgba(167, 139, 250, 0.45)"
                        strokeWidth="1"
                      />
                      <text
                        x={boxX + boxW / 2}
                        y={boxY + 13}
                        textAnchor="middle"
                        fill="#f5f3ff"
                        fontSize="11"
                        fontWeight="700"
                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                      >
                        {label}
                      </text>
                      <text
                        x={boxX + boxW / 2}
                        y={boxY + 24}
                        textAnchor="middle"
                        fill="rgba(196, 181, 253, 0.9)"
                        fontSize="9.5"
                        fontWeight="600"
                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                      >
                        {sub}
                      </text>
                    </>
                  );
                })()}
              </g>
            ) : null}
          </svg>
        </div>
        {strip.length > 0 ? (
          <aside
            className="profile-hitmap-strip"
            aria-label="Доля попаданий по частям тела"
          >
            <ul className="profile-hitmap-strip-list">
              {strip.map((row) => (
                <li
                  key={row.bone}
                  className={[
                    lastBone && row.bone === lastBone
                      ? "profile-hitmap-strip-row is-last"
                      : "profile-hitmap-strip-row",
                    hoverBone === row.bone ? "is-hover" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setHoverBone(row.bone)}
                  onMouseLeave={() => setHoverBone(null)}
                >
                  <span
                    className="profile-hitmap-strip-dot"
                    aria-hidden="true"
                  />
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
            {day
              ? "В этот день попаданий нет."
              : "Попадания появятся после стрельбы на TR1 (мод BBHitZone)."}
          </p>
        )}
      </div>
    </section>
  );
}
