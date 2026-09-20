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

export function ReactionAimChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reaction/chat", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      setEndsAt(data.windowEndsAt || null);
    } catch {
      /* ignore */
    }
  }, []);

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
        setMessages((prev) => [...prev, data.message as ChatMsg]);
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
                  className="player-nick-link"
                  href={`/players/${encodeURIComponent(m.nick)}`}
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
        <button type="submit" className="btn primary" disabled={sending || !text.trim()}>
          →
        </button>
      </form>
    </aside>
  );
}
