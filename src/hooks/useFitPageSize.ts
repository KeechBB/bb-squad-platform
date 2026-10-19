"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Сколько строк таблицы влезает в контейнер без скролла.
 * `wrapRef` — область таблицы (`.profile-hist-table-wrap`): высота thead
 * вычитается, высота строки берётся из первой tr (или fallback).
 */
export function useFitPageSize(
  wrapRef: RefObject<HTMLElement | null>,
  opts?: { rowPx?: number; chromePx?: number; min?: number; max?: number }
) {
  const rowPxFallback = opts?.rowPx ?? 36;
  const chromePx = opts?.chromePx ?? 0;
  const min = opts?.min ?? 1;
  const max = opts?.max ?? 40;
  const [size, setSize] = useState(8);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const h = el.clientHeight;
      if (h < 40) return;

      const thead = el.querySelector("thead");
      const theadH = thead
        ? Math.ceil((thead as HTMLElement).getBoundingClientRect().height)
        : 32;
      const rowEl = el.querySelector("tbody tr") as HTMLElement | null;
      const rowH = rowEl
        ? Math.max(
            20,
            Math.ceil(rowEl.getBoundingClientRect().height)
          )
        : rowPxFallback;

      // floor обычно оставляет почти целую пустую строку под таблицей —
      // +1 заполняет это место (КВ / трени / паб).
      const avail = h - theadH - chromePx;
      const n = Math.floor(avail / rowH) + 1;
      setSize(Math.min(max, Math.max(min, n >= 1 ? n : min)));
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    // Строки могли подгрузиться позже — перемер после paint
    const t = window.setTimeout(measure, 0);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [wrapRef, rowPxFallback, chromePx, min, max]);

  return size;
}
