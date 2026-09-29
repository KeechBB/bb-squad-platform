"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

type Hit = {
  nick: string;
  steamId: string;
  name: string | null;
  avatarUrl: string | null;
};

export function PlayerSearch() {
  const router = useRouter();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  const go = useCallback(
    (nick: string) => {
      setOpen(false);
      setQ("");
      setHits([]);
      router.push(`/players/${encodeURIComponent(nick)}`);
    },
    [router]
  );

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setEmpty(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/players/search?q=${encodeURIComponent(term)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results?: Hit[] };
        if (cancelled) return;
        const list = Array.isArray(data.results) ? data.results : [];
        setHits(list);
        setEmpty(list.length === 0);
        setActive(0);
        setOpen(true);
      } catch {
        if (!cancelled) {
          setHits([]);
          setEmpty(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!hits.length) return;
      setOpen(true);
      setActive((i) => (i + 1) % hits.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      setOpen(true);
      setActive((i) => (i - 1 + hits.length) % hits.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = hits[active] || hits[0];
      if (pick) go(pick.nick);
    }
  };

  const showList = open && q.trim().length >= 2 && (hits.length > 0 || empty || loading);

  return (
    <div className="player-search" ref={wrapRef}>
      <label className="visually-hidden" htmlFor="player-search-input">
        Поиск игрока
      </label>
      <input
        id="player-search-input"
        className="player-search-input"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder="Ник или Steam ID"
        autoComplete="off"
        spellCheck={false}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (q.trim().length >= 2) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul id={listId} className="player-search-list" role="listbox">
          {loading && !hits.length ? (
            <li className="player-search-empty muted">Ищем…</li>
          ) : null}
          {empty && !loading ? (
            <li className="player-search-empty muted">Не найден</li>
          ) : null}
          {hits.map((h, i) => (
            <li key={h.steamId} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={
                  i === active
                    ? "player-search-item is-active"
                    : "player-search-item"
                }
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h.nick)}
              >
                {h.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.avatarUrl} alt="" width={28} height={28} />
                ) : (
                  <span className="player-search-fallback">
                    {h.nick.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="player-search-meta">
                  <strong>{h.nick}</strong>
                  <span className="muted">
                    {h.name ? `${h.name} · ` : ""}
                    {h.steamId}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
