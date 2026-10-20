"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListPager, pageSlice } from "@/components/ListPager";

const UPDATES_PAGE_SIZE = 30;

type Release = {
  version: string;
  date: string;
  title: string;
  bullets: string[];
};

function formatDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || "—";
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

export function AdminUpdatesPanel() {
  const [current, setCurrent] = useState("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/releases", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setCurrent(String(json.current || ""));
      setReleases(Array.isArray(json.releases) ? json.releases : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const slice = useMemo(
    () => pageSlice(releases, page, UPDATES_PAGE_SIZE),
    [releases, page]
  );

  useEffect(() => {
    setPage(1);
  }, [releases.length]);

  return (
    <section className="card admin-updates-panel">
      <div className="admin-updates-head">
        <div>
          <h2 className="admin-updates-title">Логи обновлений</h2>
          <p className="muted admin-updates-lead">
            Публичные Beta-версии сайта. На главной под планкой показывается текущая.
            {current ? (
              <>
                {" "}
                Сейчас: <strong className="admin-updates-now">Beta v{current}</strong>
              </>
            ) : null}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          Обновить
        </button>
      </div>

      {err ? <p className="error">{err}</p> : null}
      {loading && !releases.length ? <p className="muted">Загрузка…</p> : null}

      {!loading && !releases.length && !err ? (
        <p className="muted">Пока нет записей об обновлениях.</p>
      ) : null}

      <ListPager
        page={slice.page}
        pageCount={slice.pageCount}
        total={slice.total}
        pageSize={UPDATES_PAGE_SIZE}
        onChange={setPage}
        label="Страницы логов обновлений"
      />
      <ul className="admin-updates-list">
        {slice.rows.map((r) => (
          <li key={`${r.version}-${r.date}`} className="admin-updates-item">
            <header className="admin-updates-item-head">
              <span className="admin-updates-ver">Beta v{r.version}</span>
              <span className="admin-updates-date">{formatDate(r.date)}</span>
            </header>
            {r.title ? <p className="admin-updates-item-title">{r.title}</p> : null}
            {r.bullets?.length ? (
              <ol className="admin-updates-bullets">
                {r.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ul>
      <ListPager
        page={slice.page}
        pageCount={slice.pageCount}
        total={slice.total}
        pageSize={UPDATES_PAGE_SIZE}
        onChange={setPage}
        label="Страницы логов обновлений (низ)"
      />
    </section>
  );
}
