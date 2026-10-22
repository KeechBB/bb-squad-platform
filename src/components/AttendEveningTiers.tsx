"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  TIER_COLORS,
  TIER_KEYS,
  type EveningTierBoard,
  type TierKey,
} from "@/lib/trainEveningTiersUi";

type Board = EveningTierBoard & { months?: string[] };

const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_RU[m - 1] || ym} ${y}`;
}

export function AttendEveningTiers() {
  const [mode, setMode] = useState<"week" | "month">("week");
  const [month, setMonth] = useState(() => {
    const now = new Date().toLocaleDateString("en-CA", {
      timeZone: "Europe/Moscow",
    });
    return now.slice(0, 7);
  });
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
        setErr(null);
      }
      try {
        const q = new URLSearchParams({ mode });
        if (mode === "month") q.set("month", month);
        const res = await fetch(`/api/admin/attendance-tier-dynamics?${q}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Ошибка");
        setBoard(json as Board);
        if (json.months?.length && mode === "month") {
          const months = json.months as string[];
          if (!months.includes(month)) setMonth(months[months.length - 1]);
        }
      } catch (e) {
        if (!opts?.silent) {
          setErr(e instanceof Error ? e.message : "Ошибка");
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [mode, month]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(() => void load({ silent: true }), {
    intervalMs: 60_000,
    kinds: ["attendance"],
  });

  const maxV = useMemo(() => {
    if (!board?.days?.length) return 10;
    const raw = Math.max(...board.days.map((d) => d.total), 10);
    const step = raw > 60 ? 20 : 10;
    return Math.ceil(raw / step) * step;
  }, [board]);

  const months = board?.months?.length ? board.months : [month];
  const periodLab = mode === "week" ? "Неделя" : "Месяц";

  return (
    <div
      className="training-chart-block attend-dynamics attend-tiers"
      style={{ gridColumn: "1 / -1" }}
    >
      <div className="attend-dynamics-head">
        <div>
          <h3>Состав по тирам · 21:00–00:00</h3>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            TR1 + TR2 · unique в стеке T1→T4
            {board
              ? ` · ${board.from.slice(8)}.${board.from.slice(5, 7)} – ${board.to.slice(8)}.${board.to.slice(5, 7)}.${board.to.slice(0, 4)}`
              : ""}
            {loading ? " · …" : ""}
          </p>
        </div>
        <div className="attend-dynamics-filters">
          <div className="attend-mode-toggle" role="group" aria-label="Период">
            <button
              type="button"
              className={mode === "week" ? "active" : ""}
              onClick={() => setMode("week")}
            >
              Неделя
            </button>
            <button
              type="button"
              className={mode === "month" ? "active" : ""}
              onClick={() => setMode("month")}
            >
              Месяц
            </button>
          </div>
          {mode === "month" ? (
            <label className="field attend-dynamics-month">
              <span>Месяц</span>
              <select
                className="attend-date-input"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {months.map((ym) => (
                  <option key={ym} value={ym}>
                    {monthLabel(ym)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {err ? <p style={{ color: "#fca5a5" }}>{err}</p> : null}

      {board ? (
        <>
          <div className="attend-dynamics-kpis attend-tiers-kpis">
            {TIER_KEYS.map((t) => (
              <div
                key={t}
                className="attend-dynamics-kpi"
                style={{ borderLeftColor: TIER_COLORS[t] }}
              >
                <span className="attend-dynamics-kpi-lab">Сегодня · {t}</span>
                <strong style={{ color: TIER_COLORS[t] }}>
                  {board.today.counts[t]}
                </strong>
                <span className="attend-dynamics-kpi-sub">
                  ср. {board.avg[t]} · {periodLab.toLowerCase()} unique{" "}
                  {board.monthUnique[t]}
                </span>
              </div>
            ))}
          </div>

          <div className="attend-dynamics-legend attend-tiers-legend">
            {TIER_KEYS.map((t) => (
              <span key={t} className="attend-tiers-leg">
                <i style={{ background: TIER_COLORS[t] }} />
                {t}
              </span>
            ))}
            <span className="muted" style={{ marginLeft: "auto", fontSize: "0.75rem" }}>
              T4 = не в списках T1–T3
            </span>
          </div>

          <div
            className="attend-dynamics-chart attend-tiers-chart"
            role="img"
            aria-label="Стек unique по тирам"
          >
            {board.days.map((d) => {
              const tip = TIER_KEYS.map(
                (t) => `${t} ${d.counts[t]}`
              ).join(" · ");
              return (
                <div
                  key={d.day}
                  className={`attend-dynamics-col${d.isToday ? " today" : ""}`}
                  title={`${d.dow} ${d.label}: ${tip} · всего ${d.total}`}
                >
                  <div className="attend-tiers-stack">
                    {d.total > 0 ? (
                      <span className="attend-tiers-total">{d.total}</span>
                    ) : null}
                    {TIER_KEYS.map((t: TierKey) => {
                      const c = d.counts[t];
                      if (!c) return null;
                      const h = (c / maxV) * 100;
                      return (
                        <div
                          key={t}
                          className="attend-tiers-seg"
                          style={{
                            height: `${Math.max(h, c > 0 ? 1.5 : 0)}%`,
                            background: TIER_COLORS[t],
                          }}
                        >
                          {h >= 8 ? <span>{c}</span> : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="attend-dynamics-xlabel">
                    {board.mode === "week" ||
                    d.isToday ||
                    d.dow === "Пт" ||
                    d.dow === "Сб" ||
                    d.dow === "Вс" ? (
                      <>
                        <span>{d.dow}</span>
                        <span>{d.label.split(".")[0]}</span>
                      </>
                    ) : (
                      <span>{d.label.split(".")[0]}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : !err ? (
        <p className="muted">Загрузка состава по тирам…</p>
      ) : null}
    </div>
  );
}
