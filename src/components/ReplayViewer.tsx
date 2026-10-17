"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayPayload } from "@/lib/replays";
import { formatDuration } from "@/lib/replays";
import { resolveReplayMap, worldToPixel } from "@/lib/replayMaps";

const COLORS = [
  "#34d399",
  "#60a5fa",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#f97316",
];

type Props = { data: ReplayPayload };

function sampleAt(
  samples: { t: number; x: number; y: number }[],
  t: number
): { x: number; y: number } | null {
  if (!samples.length) return null;
  if (t <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  if (t >= samples[samples.length - 1].t) {
    const last = samples[samples.length - 1];
    return { x: last.x, y: last.y };
  }
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const u = (t - a.t) / Math.max(1, b.t - a.t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

export function ReplayViewer({ data }: Props) {
  const map = useMemo(
    () => resolveReplayMap(data.mapKey, data.layer),
    [data.mapKey, data.layer]
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [showTrails, setShowTrails] = useState(true);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [mapImg, setMapImg] = useState<HTMLImageElement | null>(null);
  const duration = data.duration_ms || 1;

  const tracks = data.tracks?.players || [];

  useEffect(() => {
    if (!map) return;
    const img = new Image();
    img.onload = () => setMapImg(img);
    img.src = map.image;
  }, [map]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !map) return;
    const size = Math.min(wrap.clientWidth, 900);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = size;
    const h = size;

    if (mapImg) {
      ctx.drawImage(mapImg, 0, 0, w, h);
      ctx.fillStyle = "rgba(7,6,12,0.28)";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#12101c";
      ctx.fillRect(0, 0, w, h);
    }

    tracks.forEach((track, i) => {
      if (hidden[track.key]) return;
      const color = COLORS[i % COLORS.length];
      const samples = track.samples;
      if (showTrails && samples.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 2;
        let started = false;
        for (const s of samples) {
          if (s.t > t) break;
          const { px, py } = worldToPixel(s.x, s.y, map, w, h);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const pos = sampleAt(samples, t);
      if (!pos) return;
      const { px, py } = worldToPixel(pos.x, pos.y, map, w, h);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = "600 12px Manrope, sans-serif";
      ctx.fillStyle = "#f2eefc";
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 3;
      ctx.strokeText(track.key, px + 9, py - 8);
      ctx.fillText(track.key, px + 9, py - 8);
    });
  }, [map, mapImg, tracks, t, showTrails, hidden]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  if (!map) {
    return (
      <p className="replay-missing-map">
        Нет калибровки карты для слоя <code>{data.layer}</code>.
      </p>
    );
  }

  return (
    <div className="replay-viewer">
      <div className="replay-viewer-main">
        <div className="replay-canvas-wrap" ref={wrapRef}>
          <canvas ref={canvasRef} className="replay-canvas" />
        </div>
        <div className="replay-transport">
          <button
            type="button"
            className="replay-btn"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <input
            className="replay-scrub"
            type="range"
            min={0}
            max={duration}
            step={100}
            value={t}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
          />
          <span className="replay-time">
            {formatDuration(t)} / {formatDuration(duration)}
          </span>
          <label className="replay-speed">
            ×
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[1, 2, 4, 8, 16].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="replay-check">
            <input
              type="checkbox"
              checked={showTrails}
              onChange={(e) => setShowTrails(e.target.checked)}
            />
            Trails
          </label>
        </div>
      </div>
      <aside className="replay-sidebar">
        <h2>Игроки</h2>
        <ul className="replay-player-list">
          {tracks.map((track, i) => (
            <li key={track.key}>
              <label>
                <input
                  type="checkbox"
                  checked={!hidden[track.key]}
                  onChange={(e) =>
                    setHidden((h) => ({
                      ...h,
                      [track.key]: !e.target.checked,
                    }))
                  }
                />
                <span
                  className="replay-dot"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                {track.key}
                <span className="replay-muted">{track.samples.length} pts</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="replay-meta-note">
          Карта: {map.label}. Координаты — world UU (SquadCalc bounds).
        </p>
      </aside>
    </div>
  );
}
