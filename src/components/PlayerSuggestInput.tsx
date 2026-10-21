"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type PlayerSuggestHit = {
  nick: string;
  steamId: string;
  name: string | null;
  avatarUrl: string | null;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  onPick: (hit: PlayerSuggestHit) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

export function PlayerSuggestInput({
  value,
  onChange,
  onPick,
  placeholder = "Ник или Steam ID",
  disabled,
  ariaLabel,
}: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hits, setHits] = useState<PlayerSuggestHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) {
      setHits([]);
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
        const data = (await res.json()) as { results?: PlayerSuggestHit[] };
        if (cancelled) return;
        const list = Array.isArray(data.results) ? data.results : [];
        setHits(list);
        setActive(0);
        setOpen(true);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(hit: PlayerSuggestHit) {
    onChange(hit.nick);
    onPick(hit);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
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
      setActive((i) => (i - 1 + hits.length) % hits.length);
      return;
    }
    if (e.key === "Enter" && open && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    }
  }

  return (
    <div className="tn-suggest" ref={wrapRef}>
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        aria-autocomplete="list"
        aria-controls={listId}
        autoComplete="off"
        maxLength={64}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (hits.length) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (hits.length > 0 || loading) ? (
        <ul id={listId} className="tn-suggest-list" role="listbox">
          {loading && hits.length === 0 ? (
            <li className="tn-suggest-empty">Ищу…</li>
          ) : null}
          {hits.map((h, i) => (
            <li key={h.steamId} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`tn-suggest-item${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(h)}
              >
                {h.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.avatarUrl} alt="" width={24} height={24} />
                ) : (
                  <span className="tn-suggest-av" aria-hidden />
                )}
                <span className="tn-suggest-nick">{h.nick}</span>
                <span className="tn-suggest-steam">{h.steamId}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
