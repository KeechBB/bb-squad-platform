"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Пагинация таблицы «под высоту» контейнера.
 * pageSize меряем только по resize / числу строк — не по текущей странице
 * (иначе на последней странице с коротким tbody ловим петлю setState / клик «Дальше» за край).
 */
export function useFitTablePage(rowCount: number, active = true) {
  const fitRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState(8);
  const [page, setPage] = useState(0);
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(Math.max(0, rowCount) / size));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el || !active) return;
    const measure = () => {
      const head = el.querySelector("thead")?.getBoundingClientRect().height ?? 44;
      const sample = el.querySelector("tbody tr")?.getBoundingClientRect().height ?? 44;
      const room = Math.max(0, el.clientHeight - head);
      const next = Math.max(1, Math.floor(room / Math.max(sample, 1)));
      setPageSize((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, rowCount]);

  return {
    fitRef,
    pageCount,
    safePage,
    pageSize: size,
    setPage,
    goPrev: () => setPage((p) => Math.max(0, Math.min(p, pageCount - 1) - 1)),
    goNext: () => setPage((p) => Math.min(pageCount - 1, Math.min(p, pageCount - 1) + 1)),
  };
}
