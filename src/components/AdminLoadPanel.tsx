"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Sample = {
  t: number;
  cpuPct: number;
  load1: number;
  load5: number;
  load15: number;
  ramUsedGb: number;
  ramTotalGb: number;
  ramPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  diskPct: number;
  diskMount: string;
};

type Range = "minutes" | "hours" | "days";

type Payload = {
  range: Range;
  now: Sample | null;
  series: Sample[];
  sampleCount: number;
};

function tone(pct: number, kind: "cpu" | "ram" | "disk") {
  if (kind === "disk") {
    if (pct >= 90) return "bad";
    if (pct >= 75) return "warn";
    return "ok";
  }
  if (pct >= 85) return "bad";
  if (pct >= 60) return "warn";
  return "ok";
}

function Spark({
  values,
  toneClass,
  maxY,
}: {
  values: number[];
  toneClass: string;
  maxY?: number;
}) {
  const w = 560;
  const h = 72;
  const pad = 4;
  if (values.length < 2) {
    return <p className="muted">Мало точек — подожди пару минут сэмплов.</p>;
  }
  const hi = maxY && maxY > 0 ? maxY : Math.max(...values, 1);
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - (Math.min(v, hi) / hi) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className={`admin-load-spark admin-load-spark-${toneClass}`}
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      aria-label="график"
    >
      <polyline fill="none" strokeWidth="2" points={pts} />
    </svg>
  );
}

function fmtTime(t: number, range: Range) {
  const d = new Date(t);
  if (range === "days") {
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
    });
  }
  if (range === "hours") {
    return d.toLocaleString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AdminLoadPanel() {
  const [range, setRange] = useState<Range>("hours");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (r: Range, sample = false) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ range: r });
        if (sample) q.set("sample", "1");
        const res = await fetch(`/api/admin/load?${q}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData((await res.json()) as Payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(range, true);
    const id = window.setInterval(() => void load(range, true), 30_000);
    return () => window.clearInterval(id);
  }, [range, load]);

  const now = data?.now;
  const series = useMemo(() => data?.series || [], [data?.series]);

  const cpuSeries = useMemo(() => series.map((s) => s.cpuPct), [series]);
  const ramSeries = useMemo(() => series.map((s) => s.ramPct), [series]);
  const diskSeries = useMemo(() => series.map((s) => s.diskPct), [series]);

  return (
    <section className="card admin-load-panel">
      <header className="admin-load-head">
        <div>
          <h2>Нагрузка сервера</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            CPU · RAM · NVMe (/). Сэмпл каждую минуту + сейчас при открытии.
            Зелёный — норма, жёлтый — внимание, красный — высокая нагрузка.
          </p>
        </div>
        <div className="admin-load-filters" role="tablist">
          {(
            [
              ["minutes", "Минуты"],
              ["hours", "Часы"],
              ["days", "Дни"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`admin-tab ${range === id ? "active" : ""}`}
              onClick={() => setRange(id)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() => void load(range, true)}
            disabled={loading}
          >
            Обновить
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {loading && !data ? <p className="muted">Загрузка…</p> : null}

      {now ? (
        <div className="admin-load-now">
          <div className={`admin-load-kpi admin-load-${tone(now.cpuPct, "cpu")}`}>
            <span className="admin-load-kpi-label">CPU</span>
            <strong>{now.cpuPct.toFixed(1)}%</strong>
            <span className="muted">
              load {now.load1.toFixed(2)} / {now.load5.toFixed(2)} /{" "}
              {now.load15.toFixed(2)}
            </span>
          </div>
          <div className={`admin-load-kpi admin-load-${tone(now.ramPct, "ram")}`}>
            <span className="admin-load-kpi-label">RAM</span>
            <strong>{now.ramPct.toFixed(1)}%</strong>
            <span className="muted">
              {now.ramUsedGb.toFixed(1)} / {now.ramTotalGb.toFixed(1)} GB
            </span>
          </div>
          <div
            className={`admin-load-kpi admin-load-${tone(now.diskPct, "disk")}`}
          >
            <span className="admin-load-kpi-label">NVMe {now.diskMount}</span>
            <strong>{now.diskPct.toFixed(1)}%</strong>
            <span className="muted">
              {now.diskUsedGb.toFixed(1)} / {now.diskTotalGb.toFixed(1)} GB
            </span>
          </div>
        </div>
      ) : null}

      <div className="admin-load-charts">
        <div className="admin-load-chart">
          <h3>CPU %</h3>
          <Spark
            values={cpuSeries}
            toneClass={tone(now?.cpuPct || 0, "cpu")}
            maxY={100}
          />
        </div>
        <div className="admin-load-chart">
          <h3>RAM %</h3>
          <Spark
            values={ramSeries}
            toneClass={tone(now?.ramPct || 0, "ram")}
            maxY={100}
          />
        </div>
        <div className="admin-load-chart">
          <h3>NVMe %</h3>
          <Spark
            values={diskSeries}
            toneClass={tone(now?.diskPct || 0, "disk")}
            maxY={100}
          />
        </div>
      </div>

      <p className="muted" style={{ marginTop: 12 }}>
        Диапазон:{" "}
        {range === "minutes"
          ? "последние 60 минут"
          : range === "hours"
            ? "последние 24 часа"
            : "последние 14 дней (по часам)"}
        {" · "}
        точек: {data?.sampleCount ?? 0}
        {series.length
          ? ` · ${fmtTime(series[0].t, range)} → ${fmtTime(
              series[series.length - 1].t,
              range
            )}`
          : null}
      </p>
    </section>
  );
}
