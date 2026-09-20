"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";

type JournalEntry = {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  message: string;
  actorNick: string | null;
  targetNick: string | null;
  clanTag: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  admin: "Админ",
  clan: "Клан",
  profile: "Профиль",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

export function AdminJournalPanel() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [category, setCategory] = useState<"" | "admin" | "clan" | "profile">("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);

  const load = useCallback(
    async (opts?: { prepend?: boolean; before?: string; silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
        setErr(null);
      }
      try {
        const params = new URLSearchParams({ limit: "200" });
        if (qApplied) params.set("q", qApplied);
        if (category) params.set("category", category);
        if (opts?.before) params.set("before", opts.before);
        const res = await fetch(`/api/admin/journal?${params}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
        const next = (json.entries || []) as JournalEntry[];
        setHasMore(Boolean(json.hasMore));
        if (opts?.prepend) {
          setEntries((prev) => {
            const ids = new Set(prev.map((e) => e.id));
            const older = next.filter((e) => !ids.has(e.id));
            return [...older, ...prev];
          });
        } else {
          setEntries(next);
          if (!opts?.silent) stickBottom.current = true;
        }
      } catch (e) {
        if (!opts?.silent) {
          setErr(e instanceof Error ? e.message : "Ошибка");
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [qApplied, category]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(() => load({ silent: true }), {
    intervalMs: 15000,
    kinds: ["journal"],
  });

  useEffect(() => {
    if (!stickBottom.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [entries]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickBottom.current = nearBottom;
  }

  function applySearch(e: FormEvent) {
    e.preventDefault();
    setQApplied(q.trim());
  }

  async function loadOlder() {
    if (!entries.length || loading) return;
    stickBottom.current = false;
    await load({ prepend: true, before: entries[0].createdAt });
  }

  return (
    <section className="card journal-card">
      <form className="journal-toolbar" onSubmit={applySearch}>
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
          <span>Поиск</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ник, роль, клан, слово…"
            autoComplete="off"
          />
        </label>
        <div className="attend-mode-toggle" role="group" aria-label="Категория">
          <button
            type="button"
            className={category === "" ? "active" : ""}
            onClick={() => setCategory("")}
          >
            Все
          </button>
          <button
            type="button"
            className={category === "admin" ? "active" : ""}
            onClick={() => setCategory("admin")}
          >
            Админ
          </button>
          <button
            type="button"
            className={category === "clan" ? "active" : ""}
            onClick={() => setCategory("clan")}
          >
            Клан
          </button>
          <button
            type="button"
            className={category === "profile" ? "active" : ""}
            onClick={() => setCategory("profile")}
          >
            Профиль
          </button>
        </div>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? "…" : "Найти"}
        </button>
      </form>

      {err ? <p style={{ color: "#fca5a5" }}>{err}</p> : null}

      <div className="journal-window">
        <div className="journal-window-head">
          <span>Журнал действий</span>
          <span className="muted">
            {entries.length ? `${entries.length} записей` : "пусто"}
            {qApplied ? ` · «${qApplied}»` : ""}
          </span>
        </div>
        <div
          className="journal-chat"
          ref={listRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
        >
          {hasMore ? (
            <button
              type="button"
              className="journal-load-older"
              onClick={() => void loadOlder()}
              disabled={loading}
            >
              Загрузить раньше
            </button>
          ) : null}
          {!loading && entries.length === 0 ? (
            <p className="journal-empty muted">
              Пока нет записей. Сюда попадают регистрации, кики, резерв,
              роли и другие движения по клану.
            </p>
          ) : null}
          {entries.map((e) => (
            <article
              key={e.id}
              className={`journal-msg journal-msg-cat-${e.category}`}
            >
              <header className="journal-msg-meta">
                <time dateTime={e.createdAt}>{formatWhen(e.createdAt)}</time>
                <span className="journal-msg-badge">
                  {CATEGORY_LABEL[e.category] || e.category}
                </span>
                {e.clanTag ? (
                  <span className="journal-msg-tag">[{e.clanTag}]</span>
                ) : null}
              </header>
              <p className="journal-msg-body">{e.message}</p>
            </article>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </section>
  );
}
