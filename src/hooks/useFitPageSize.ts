"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Сколько строк таблицы влезает в контейнер (под шапку + пагинатор).
 * Минимум 6, максимум 40 — чтобы окно истории заполнялось без пустоты и без вечного списка.
 */
export function useFitPageSize(
  wrapRef: RefObject<HTMLElement | null>,
  opts?: { rowPx?: number; chromePx?: number; min?: number; max?: number }
) {
  const rowPx = opts?.rowPx ?? 34;
  const chromePx = opts?.chromePx ?? 96;
  const min = opts?.min ?? 6;
  const max = opts?.max ?? 40;
  const [size, setSize] = useState(12);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const h = el.clientHeight;
      if (h < 80) return;
      const n = Math.floor((h - chromePx) / rowPx);
      setSize(Math.min(max, Math.max(min, n || min)));
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapRef, rowPx, chromePx, min, max]);

  return size;
}
