"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Сколько целых строк влезает в карточку истории.
 * Замер до отрисовки и только по высоте слота, не по строкам таблицы.
 * Иначе число строк прыгает и карточка мигает «Загрузка».
 */
export function useFitPageSize(
  wrapRef: RefObject<HTMLElement | null>,
  opts?: { rowPx?: number; chromePx?: number; min?: number; max?: number }
) {
  const min = opts?.min ?? 1;
  const max = opts?.max ?? 40;
  const rowPxOpt = opts?.rowPx;
  const chromePx = opts?.chromePx ?? 0;
  const [size, setSize] = useState(12);
  const locked = useRef(false);
  const lastH = useRef(0);

  useLayoutEffect(() => {
    const root = wrapRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const wrap = root.classList.contains("profile-hist-table-wrap")
        ? root
        : (root.querySelector(
            ".profile-hist-table-wrap"
          ) as HTMLElement | null);
      const box = wrap ?? root;
      const h = box.clientHeight;
      if (h < 48) return;
      // Мелкие колебания высоты (скроллбар/шрифт) — игнор.
      if (lastH.current && Math.abs(h - lastH.current) < 24) return;

      const fontPx = parseFloat(getComputedStyle(box).fontSize) || 16;
      const thead = box.querySelector("thead") as HTMLElement | null;
      const theadH = thead?.offsetHeight || Math.round(fontPx * 1.85);
      const rowH = Math.max(22, rowPxOpt ?? theadH);
      const avail = Math.floor(h - theadH - 6 - chromePx);
      if (avail < rowH * 0.55) return;

      const count = Math.min(max, Math.max(min, Math.floor(avail / rowH)));
      lastH.current = h;
      setSize((prev) => {
        if (prev === count) return prev;
        // После первого стабильного замера не дёргать ±1 строку — это мерцание.
        if (locked.current && Math.abs(prev - count) <= 1) return prev;
        locked.current = true;
        return count;
      });
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    const wrap = root.querySelector(".profile-hist-table-wrap");
    if (wrap && wrap !== root) ro.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [wrapRef, min, max, rowPxOpt, chromePx]);

  return size;
}
