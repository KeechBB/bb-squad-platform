"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { REACTION_CHAT_MAX_LEN } from "@/lib/reaction";

type ChatMsg = {
  id: string;
  text: string;
  createdAt: string;
  nick: string;
  userId: string;
};

const NICK_PALETTE = [
  "#86efac",
  "#67e8f9",
  "#a5b4fc",
  "#f9a8d4",
  "#fcd34d",
  "#fdba74",
  "#c4b5fd",
  "#5eead4",
  "#fca5a5",
  "#93c5fd",
  "#bef264",
  "#f0abfc",
  "#7dd3fc",
  "#fda4af",
  "#d8b4fe",
];

function fmtTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function storageKey(windowStart: string | null) {
  return `bb-reaction-chat-colors:${windowStart || "default"}`;
}

function readColorMap(windowStart: string | null): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(storageKey(windowStart));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeColorMap(windowStart: string | null, map: Record<string, string>) {
  try {
    sessionStorage.setItem(storageKey(windowStart), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function pickRandomColor(used: Set<string>) {
  const free = NICK_PALETTE.filter((c) => !used.has(c));
  const pool = free.length ? free : NICK_PALETTE;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function ReactionAimChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [nickColors, setNickColors] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const ensureColors = useCallback(
    (msgs: ChatMsg[], win: string | null) => {
      const map = { ...readColorMap(win) };
      const used = new Set(Object.values(map));
      let changed = false;
      for (const m of msgs) {
        if (!m.userId || map[m.userId]) continue;
        const color = pickRandomColor(used);
        map[m.userId] = color;
        used.add(color);
        changed = true;
      }
      if (changed) writeColorMap(win, map);
      setNickColors(map);
    },
    []
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reaction/chat", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const msgs = (data.messages || []) as ChatMsg[];
      const win = (data.windowStart as string) || null;
      setMessages(msgs);
      setEndsAt(data.windowEndsAt || null);
      setWindowStart(win);
      ensureColors(msgs, win);
    } catch {
      /* ignore */
    }
  }, [ensureColors]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/reaction/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message) {
        const msg = data.message as ChatMsg;
        setMessages((prev) => {
          const next = [...prev, msg];
          ensureColors(next, windowStart);
          return next;
        });
        setText("");
        stickRef.current = true;
      }
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="reaction-chat card">
      <div className="reaction-chat-head">
        <h2>Чат вкладки</h2>
        <p className="muted">
          Без истории · очистка каждые 30 мин
          {endsAt ? ` · до ${fmtTime(endsAt)}` : ""}
        </p>
      </div>
      <div
        className="reaction-chat-list"
        ref={listRef}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 ? (
          <p className="muted reaction-chat-empty">Пока тихо — напиши первым</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="reaction-chat-row">
              <span className="reaction-chat-meta">
                <Link
                  className="player-nick-link reaction-chat-nick"
                  href={`/players/${encodeURIComponent(m.nick)}`}
                  style={{ color: nickColors[m.userId] || undefined }}
                >
                  {m.nick}
                </Link>
                <time>{fmtTime(m.createdAt)}</time>
              </span>
              <p>{m.text}</p>
            </div>
          ))
        )}
      </div>
      <form className="reaction-chat-form" onSubmit={onSubmit}>
        <input
          type="text"
          value={text}
          maxLength={REACTION_CHAT_MAX_LEN}
          placeholder="Сообщение…"
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <button
          type="submit"
          className="btn primary"
          disabled={sending || !text.trim()}
        >
          →
        </button>
      </form>
    </aside>
  );
}
