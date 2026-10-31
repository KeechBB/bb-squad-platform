"use client";

import { useEffect, useState } from "react";

type Page<T> = {
  rows: T[];
  total: number;
  pageCount: number;
  loading: boolean;
  failed: boolean;
};

export type ReadyHistory<T> = {
  rows: T[];
  total?: number;
};

/**
 * Первая страница уже пришла вместе с профилем.
 * Сеть — только если этой страницы в готовых строках нет.
 */
export function useProfileHistoryPage<T>(
  nick: string | undefined,
  kind: "public" | "train" | "cw",
  page: number,
  pageSize: number,
  ready?: ReadyHistory<T>
): Page<T> & { active: boolean } {
  const readyRows = ready?.rows ?? [];
  const readyTotal = Math.max(ready?.total ?? 0, readyRows.length);
  const size = Math.max(1, pageSize || 1);
  const start = (Math.max(1, page) - 1) * size;
  const localRows = readyRows.slice(start, start + size);
  const covered =
    localRows.length > 0 &&
    (localRows.length >= size || start + localRows.length >= readyTotal);
  const pageCount = Math.max(1, Math.ceil(readyTotal / size) || 1);
  const active = Boolean((nick || "").trim());

  const [fetched, setFetched] = useState<Page<T> | null>(null);

  useEffect(() => {
    const clean = (nick || "").trim();
    if (!clean || pageSize < 1 || covered) return;
    let cancelled = false;
    // Не ставим loading, если уже есть строки — иначе таблица мигает «Загрузка…».
    const keepRows = localRows.length
      ? localRows
      : undefined;
    setFetched((s) => ({
      rows: s?.rows?.length ? s.rows : keepRows || [],
      total: s?.total || readyTotal,
      pageCount: s?.pageCount || pageCount,
      loading: !(s?.rows?.length || keepRows?.length),
      failed: false,
    }));
    const q = new URLSearchParams({
      nick: clean,
      kind,
      page: String(page),
      pageSize: String(pageSize),
    });
    fetch(`/api/profile/history?${q}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{
          rows: T[];
          total: number;
          pageCount: number;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        setFetched({
          rows: data.rows || [],
          total: Number(data.total) || 0,
          pageCount: Number(data.pageCount) || 1,
          loading: false,
          failed: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFetched((s) => ({
          rows: s?.rows?.length ? s.rows : localRows,
          total: s?.total || readyTotal,
          pageCount: s?.pageCount || pageCount,
          loading: false,
          failed: true,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [nick, kind, page, pageSize, covered]);

  if (covered) {
    return {
      rows: localRows,
      total: readyTotal,
      pageCount,
      loading: false,
      failed: false,
      active,
    };
  }
  if (fetched && (fetched.rows.length > 0 || !fetched.loading)) {
    return { ...fetched, active };
  }
  return {
    rows: localRows,
    total: readyTotal,
    pageCount,
    loading: active && localRows.length === 0,
    failed: false,
    active,
  };
}
