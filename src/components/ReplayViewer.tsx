"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayPayload } from "@/lib/replayTypes";
import { formatDuration } from "@/lib/replayFormat";
import { resolveReplayMap, worldToMapPixel } from "@/lib/replayMaps";
import { resolveReplayCapzones } from "@/lib/replayCapzones";

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
  const [showCaps, setShowCaps] = useState(true);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [mapImg, setMapImg] = useState<HTMLImageElement | null>(null);
  /** Zoom: screen pixels per map pixel. */
  const [zoom, setZoom] = useState(0.2);
  /** Pan: where map (0,0) lands on canvas (CSS px). */
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    active: boolean;
    sx: number;
    sy: number;
    px: number;
    py: number;
  } | null>(null);
  const viewRef = useRef({ zoom, pan });
  viewRef.current = { zoom, pan };
  const fittedRef = useRef(false);
  const duration = data.duration_ms || 1;

  const tracks = useMemo(() => data.tracks?.players || [], [data.tracks?.players]);
  const caps = useMemo(
    () => resolveReplayCapzones(data.layer),
    [data.layer]
  );

  useEffect(() => {
    if (!map) return;
    fittedRef.current = false;
    const img = new Image();
    img.onload = () => setMapImg(img);
    img.src = map.image;
  }, [map]);

  const viewportSize = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return { vw: 960, vh: 640 };
    const vw = Math.max(wrap.clientWidth, 320);
    const vh = Math.max(wrap.clientHeight || Math.round(vw * 0.72), 480);
    return { vw, vh };
  }, []);

  const fitMap = useCallback(() => {
    const img = mapImg;
    if (!img) return;
    const { vw, vh } = viewportSize();
    const z = Math.min(vw / img.naturalWidth, vh / img.naturalHeight);
    const pw = img.naturalWidth * z;
    const ph = img.naturalHeight * z;
    setZoom(z);
    setPan({ x: (vw - pw) / 2, y: (vh - ph) / 2 });
    fittedRef.current = true;
  }, [mapImg, viewportSize]);

  useEffect(() => {
    if (mapImg && !fittedRef.current) {
      // wait a frame so CSS height on wrap is applied
      requestAnimationFrame(() => fitMap());
    }
  }, [mapImg, fitMap]);

  useEffect(() => {
    const onResize = () => {
      fittedRef.current = false;
      fitMap();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitMap]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !map) return;
    const { vw: cssW, vh: cssH } = viewportSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0812";
    ctx.fillRect(0, 0, cssW, cssH);

    const { zoom: z, pan: p } = viewRef.current;
    const mw = mapImg?.naturalWidth || 1;
    const mh = mapImg?.naturalHeight || 1;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(z, z);
    if (mapImg) {
      ctx.imageSmoothingEnabled = z < 1;
      ctx.drawImage(mapImg, 0, 0);
    } else {
      ctx.fillStyle = "#12101c";
      ctx.fillRect(0, 0, mw, mh);
    }

    const inv = 1 / z;

    if (showCaps && caps.length) {
      for (const cap of caps) {
        const { mx, my } = worldToMapPixel(cap.x, cap.y, map, mw, mh);
        const isMain = /^main$/i.test(cap.name) || cap.cluster === "00" || cap.cluster === "Z";
        const r = Math.max(isMain ? 10 : 7, (isMain ? 14 : 9) * inv);
        ctx.beginPath();
        ctx.fillStyle = isMain ? "rgba(251, 191, 36, 0.85)" : "rgba(148, 163, 184, 0.75)";
        ctx.strokeStyle = isMain ? "rgba(255, 255, 255, 0.95)" : "rgba(226, 232, 240, 0.8)";
        ctx.lineWidth = Math.max(1.5, 2 * inv);
        if (isMain) {
          ctx.rect(mx - r, my - r, r * 2, r * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.arc(mx, my, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        const label = isMain
          ? `MAIN ${cap.cluster}`
          : `${cap.cluster}-${cap.name}`;
        const fontPx = Math.max(10, 12 * inv);
        ctx.font = `600 ${fontPx}px Manrope, sans-serif`;
        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.lineWidth = Math.max(2, 3 * inv);
        ctx.strokeText(label, mx + r + 3, my + fontPx * 0.35);
        ctx.fillText(label, mx + r + 3, my + fontPx * 0.35);
      }
    }

    tracks.forEach((track, i) => {
      if (hidden[track.key]) return;
      const color = COLORS[i % COLORS.length];
      const samples = track.samples;
      if (showTrails && samples.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = Math.max(1.5, 2 * inv);
        let started = false;
        for (const s of samples) {
          if (s.t > t) break;
          const { mx, my } = worldToMapPixel(s.x, s.y, map, mw, mh);
          if (!started) {
            ctx.moveTo(mx, my);
            started = true;
          } else ctx.lineTo(mx, my);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const pos = sampleAt(samples, t);
      if (!pos) return;
      const { mx, my } = worldToMapPixel(pos.x, pos.y, map, mw, mh);
      const r = Math.max(4, 7 * inv);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(1, 1.5 * inv);
      ctx.stroke();
      const fontPx = Math.max(11, 13 * inv);
      ctx.font = `600 ${fontPx}px Manrope, sans-serif`;
      ctx.fillStyle = "#f2eefc";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = Math.max(2, 3 * inv);
      ctx.strokeText(track.key, mx + r + 4, my - r);
      ctx.fillText(track.key, mx + r + 4, my - r);
    });
    ctx.restore();
  }, [map, mapImg, tracks, caps, t, showTrails, showCaps, hidden, zoom, pan]);

  useEffect(() => {
    draw();
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

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas || !mapImg) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { zoom: z0, pan: p0 } = viewRef.current;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const z1 = Math.min(8, Math.max(0.05, z0 * factor));
    // zoom toward cursor: map point under cursor stays fixed
    const mx = (cx - p0.x) / z0;
    const my = (cy - p0.y) / z0;
    setZoom(z1);
    setPan({ x: cx - mx * z1, y: cy - my * z1 });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      active: true,
      sx: e.clientX,
      sy: e.clientY,
      px: viewRef.current.pan.x,
      py: viewRef.current.pan.y,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d?.active) return;
    setPan({
      x: d.px + (e.clientX - d.sx),
      y: d.py + (e.clientY - d.sy),
    });
  };
  const onPointerUp = () => {
    if (dragRef.current) dragRef.current.active = false;
  };

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
          <canvas
            ref={canvasRef}
            className="replay-canvas replay-canvas-pan"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
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
          <label className="replay-check">
            <input
              type="checkbox"
              checked={showCaps}
              onChange={(e) => setShowCaps(e.target.checked)}
            />
            Caps / Main
          </label>
          <button type="button" className="replay-btn" onClick={fitMap}>
            Fit
          </button>
          <button
            type="button"
            className="replay-btn"
            onClick={() => {
              const { vw, vh } = viewportSize();
              const { zoom: z0, pan: p0 } = viewRef.current;
              const cx = vw / 2;
              const cy = vh / 2;
              const z1 = Math.min(8, z0 * 1.35);
              const mx = (cx - p0.x) / z0;
              const my = (cy - p0.y) / z0;
              setZoom(z1);
              setPan({ x: cx - mx * z1, y: cy - my * z1 });
            }}
          >
            Zoom+
          </button>
          <span className="replay-muted">
            {mapImg ? `${mapImg.naturalWidth}×${mapImg.naturalHeight}` : "…"} ·
            колесо = зум · drag = пан · {Math.round(zoom * 100) / 100}×
          </span>
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
          {map.label}: UU → Vanilla minimap (без flipY; Y на юг). Caps/Main —
          статика слоя. Колесо = зум, drag = пан.
        </p>
      </aside>
    </div>
  );
}
