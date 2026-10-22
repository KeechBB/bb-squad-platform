"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { EveningDynamicsBoard } from "@/lib/trainEveningDynamics";

type Board = EveningDynamicsBoard & { months?: string[] };

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

export function AttendEveningDynamics() {
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
        const res = await fetch(`/api/admin/attendance-dynamics?${q}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Ошибка");
        setBoard(json as Board);
        if (json.months?.length && mode === "month") {
          const months = json.months as string[];
          if (!months.includes(month)) {
            setMonth(months[months.length - 1]);
          }
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
    const raw = Math.max(
      ...board.days.map((d) => Math.max(d.unique, d.peak)),
      10
    );
    const step = raw > 60 ? 20 : 10;
    return Math.ceil(raw / step) * step;
  }, [board]);

  const months = board?.months?.length
    ? board.months
    : [month];

  return (
    <div className="training-chart-block attend-dynamics" style={{ gridColumn: "1 / -1" }}>
      <div className="attend-dynamics-head">
        <div>
          <h3>Динамика вечера · 21:00–00:00</h3>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            TR1 + TR2 · всего зашло (unique) и пик одновременно online
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
          <div className="attend-dynamics-kpis">
            <div className="attend-dynamics-kpi green">
              <span className="attend-dynamics-kpi-lab">
                Сегодня · всего зашло
              </span>
              <strong>{board.today.unique}</strong>
              <span className="attend-dynamics-kpi-sub">
                {board.today.dow} {board.today.label} · TR1 {board.today.tr1Unique}{" "}
                / TR2 {board.today.tr2Unique}
              </span>
            </div>
            <div className="attend-dynamics-kpi orange">
              <span className="attend-dynamics-kpi-lab">
                Сегодня · пик online
              </span>
              <strong>{board.today.peak}</strong>
              <span className="attend-dynamics-kpi-sub">
                TR1 пик {board.today.tr1Peak} / TR2 пик {board.today.tr2Peak}
              </span>
            </div>
            <div className="attend-dynamics-kpi green soft">
              <span className="attend-dynamics-kpi-lab">
                {mode === "week" ? "Неделя" : "Месяц"} · ср. зашло
              </span>
              <strong>{board.avgUnique}</strong>
              <span className="attend-dynamics-kpi-sub">
                макс {board.maxUnique.unique} · {board.maxUnique.dow}{" "}
                {board.maxUnique.label}
              </span>
            </div>
            <div className="attend-dynamics-kpi orange soft">
              <span className="attend-dynamics-kpi-lab">
                {mode === "week" ? "Неделя" : "Месяц"} · ср. пик
              </span>
              <strong>{board.avgPeak}</strong>
              <span className="attend-dynamics-kpi-sub">
                макс {board.maxPeak.peak} · {board.maxPeak.dow}{" "}
                {board.maxPeak.label}
              </span>
            </div>
          </div>

          <div className="attend-dynamics-legend">
            <span className="attend-dynamics-leg u">всего зашло</span>
            <span className="attend-dynamics-leg p">пик online</span>
          </div>

          <div className="attend-dynamics-chart" role="img" aria-label="График динамики">
            {board.days.map((d) => {
              const uh = Math.max(2, (d.unique / maxV) * 100);
              const ph = Math.max(2, (d.peak / maxV) * 100);
              return (
                <div
                  key={d.day}
                  className={`attend-dynamics-col${d.isToday ? " today" : ""}`}
                  title={`${d.dow} ${d.label}: зашло ${d.unique}, пик ${d.peak}`}
                >
                  <div className="attend-dynamics-bars">
                    <div
                      className="attend-dynamics-bar u"
                      style={{ height: `${d.unique ? uh : 0}%` }}
                    >
                      {d.unique > 0 && board.days.length <= 14 ? (
                        <span>{d.unique}</span>
                      ) : null}
                    </div>
                    <div
                      className="attend-dynamics-bar p"
                      style={{ height: `${d.peak ? ph : 0}%` }}
                    >
                      {d.peak > 0 && board.days.length <= 14 ? (
                        <span>{d.peak}</span>
                      ) : null}
                    </div>
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
        <p className="muted">Загрузка динамики…</p>
      ) : null}
    </div>
  );
}
