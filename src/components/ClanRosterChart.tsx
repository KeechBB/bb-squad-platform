"use client";

import { useMemo, useState } from "react";
import type { RosterBucketCount } from "@/lib/tiers";

type Props = {
  buckets: RosterBucketCount[];
};

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number
): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o0 = polar(cx, cy, rOuter, startDeg);
  const o1 = polar(cx, cy, rOuter, endDeg);
  const i1 = polar(cx, cy, rInner, endDeg);
  const i0 = polar(cx, cy, rInner, startDeg);
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i0.x} ${i0.y}`,
    "Z",
  ].join(" ");
}

export function ClanRosterChart({ buckets }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const total = useMemo(
    () => buckets.reduce((s, b) => s + b.count, 0),
    [buckets]
  );
  const slices = useMemo(() => {
    if (total <= 0) return [];
    let angle = 0;
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => {
        const span = (b.count / total) * 360;
        const start = angle;
        const end = angle + Math.max(span, 0.01);
        angle = end;
        return { ...b, start, end, pct: Math.round((100 * b.count) / total) };
      });
  }, [buckets, total]);

  const active = slices.find((s) => s.key === hover) || null;

  return (
    <aside className="clan-roster-chart" aria-label="Распределение состава">
      <p className="eyebrow">состав</p>
      <h3 className="clan-roster-chart-title">Ранги</h3>
      <p className="muted clan-roster-chart-lead">
        Резерв, тиры КВ и TBD — кто не играет КВ.
      </p>

      {total === 0 ? (
        <p className="muted">Пока нет игроков.</p>
      ) : (
        <>
          <div className="clan-roster-chart-viz">
            <svg viewBox="0 0 220 220" className="clan-roster-svg">
              {slices.length === 1 ? (
                <>
                  <circle
                    cx="110"
                    cy="110"
                    r="88"
                    fill={slices[0].color}
                    opacity="0.9"
                  />
                  <circle cx="110" cy="110" r="48" fill="#0b0914" />
                </>
              ) : (
                slices.map((s) => (
                  <path
                    key={s.key}
                    d={arcPath(110, 110, 88, 48, s.start, s.end)}
                    fill={s.color}
                    opacity={hover && hover !== s.key ? 0.35 : 0.92}
                    className="clan-roster-slice"
                    onMouseEnter={() => setHover(s.key)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>
                      {s.label}: {s.count} ({s.pct}%)
                    </title>
                  </path>
                ))
              )}
              <text
                x="110"
                y="104"
                textAnchor="middle"
                className="clan-roster-center-num"
              >
                {active ? active.count : total}
              </text>
              <text
                x="110"
                y="124"
                textAnchor="middle"
                className="clan-roster-center-label"
              >
                {active ? active.label : "всего"}
              </text>
            </svg>
          </div>

          <ul className="clan-roster-legend">
            {buckets.map((b) => (
              <li
                key={b.key}
                className={hover === b.key ? "is-active" : ""}
                onMouseEnter={() => setHover(b.key)}
                onMouseLeave={() => setHover(null)}
              >
                <span
                  className="clan-roster-swatch"
                  style={{ background: b.color }}
                />
                <span className="clan-roster-legend-label">{b.label}</span>
                <strong>{b.count}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
