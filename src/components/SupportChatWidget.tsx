"use client";

import { signIn, useSession } from "next-auth/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Msg = {
  id: string;
  kind: string;
  body: string;
  from: string;
  createdAt: string;
};

type Ticket = {
  id: string;
  number: number;
  status: string;
  userNick: string;
  messages: Msg[];
};

type InboxItem = {
  id: string;
  number: number;
  userNick: string;
  updatedAt: string;
  preview: string;
  waiting: boolean;
};

type PanelMode = "closed" | "minimized" | "open";

type PanelGeom = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const WELCOME_FALLBACK =
  "Появились вопросы по навигации сайта? Задай — тебе ответят и помогут в короткие сроки.";

const DRAFT_HINT =
  "Напишите вопрос ниже — тикет откроется автоматически после первого сообщения.";

const GEOM_KEY = "bb-support-chat-geom";
const MIN_W = 280;
const MIN_H = 320;
const DEFAULT_W = 380;
const DEFAULT_H = 520;

function defaultGeom(): PanelGeom {
  if (typeof window === "undefined") {
    return { left: 40, top: 80, width: DEFAULT_W, height: DEFAULT_H };
  }
  const pad = 12;
  const width = Math.min(DEFAULT_W, Math.max(MIN_W, window.innerWidth - pad * 2));
  const height = Math.min(DEFAULT_H, Math.max(MIN_H, window.innerHeight - pad * 2));
  return {
    width,
    height,
    left: Math.max(pad, window.innerWidth - width - pad),
    top: Math.max(pad, window.innerHeight - height - pad),
  };
}

function clampGeom(g: PanelGeom): PanelGeom {
  if (typeof window === "undefined") return g;
  const pad = 4;
  const width = Math.min(
    Math.max(g.width, Math.min(MIN_W, window.innerWidth - pad * 2)),
    window.innerWidth - pad * 2
  );
  const height = Math.min(
    Math.max(g.height, Math.min(MIN_H, window.innerHeight - pad * 2)),
    window.innerHeight - pad * 2
  );
  const left = Math.min(Math.max(g.left, pad), window.innerWidth - width - pad);
  const top = Math.min(Math.max(g.top, pad), window.innerHeight - height - pad);
  return { left, top, width, height };
}

function loadGeom(): PanelGeom {
  try {
    const raw = sessionStorage.getItem(GEOM_KEY);
    if (!raw) return defaultGeom();
    const parsed = JSON.parse(raw) as PanelGeom;
    if (
      typeof parsed.left !== "number" ||
      typeof parsed.top !== "number" ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number"
    ) {
      return defaultGeom();
    }
    return clampGeom(parsed);
  } catch {
    return defaultGeom();
  }
}

export function SupportChatWidget() {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<PanelMode>("closed");
  const [staff, setStaff] = useState(false);
  const [welcome, setWelcome] = useState(WELCOME_FALLBACK);
  const [myNick, setMyNick] = useState("Игрок");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [staffTicket, setStaffTicket] = useState<Ticket | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [view, setView] = useState<"chat" | "inbox">("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geom, setGeom] = useState<PanelGeom>(defaultGeom);
  const [dragging, setDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    kind: "move" | "resize";
    startX: number;
    startY: number;
    origin: PanelGeom;
  } | null>(null);
  const loggedIn = Boolean(session?.user);

  useEffect(() => {
    setGeom(loadGeom());
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(GEOM_KEY, JSON.stringify(geom));
    } catch {
      /* ignore */
    }
  }, [geom]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (d.kind === "move") {
        setGeom(
          clampGeom({
            ...d.origin,
            left: d.origin.left + dx,
            top: d.origin.top + dy,
          })
        );
      } else {
        setGeom(
          clampGeom({
            ...d.origin,
            width: d.origin.width + dx,
            height: d.origin.height + dy,
          })
        );
      }
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    function onResize() {
      setGeom((g) => clampGeom(g));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function startDrag(kind: "move" | "resize", e: ReactPointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      origin: geom,
    };
    setDragging(true);
  }

  const activeTicket =
    staff && view === "inbox" && staffTicket ? staffTicket : ticket;

  const refresh = useCallback(async () => {
    if (!loggedIn) return;
    try {
      const res = await fetch("/api/support/tickets", { cache: "no-store" });
      if (res.status === 401) return;
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        staff?: boolean;
        welcome?: string;
        myNick?: string;
        ticket?: Ticket | null;
        inbox?: InboxItem[];
      };
      if (!data.ok) return;
      setStaff(Boolean(data.staff));
      if (data.welcome) setWelcome(data.welcome);
      if (data.myNick) setMyNick(data.myNick);
      setTicket(data.ticket || null);
      setInbox(data.inbox || []);
      if (data.staff && staffTicket) {
        const still = (data.inbox || []).some((i) => i.id === staffTicket.id);
        if (!still && staffTicket.id !== data.ticket?.id) {
          setStaffTicket(null);
        }
      }
    } catch {
      /* ignore */
    }
  }, [loggedIn, staffTicket]);

  const refreshActive = useCallback(async () => {
    if (!activeTicket) {
      await refresh();
      return;
    }
    try {
      const res = await fetch(`/api/support/tickets/${activeTicket.id}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        if (staffTicket?.id === activeTicket.id) setStaffTicket(null);
        if (ticket?.id === activeTicket.id) setTicket(null);
        await refresh();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean; ticket?: Ticket };
      if (!data.ok || !data.ticket) return;
      if (staffTicket?.id === data.ticket.id) setStaffTicket(data.ticket);
      if (ticket?.id === data.ticket.id) setTicket(data.ticket);
      if (!ticket && !staffTicket) setTicket(data.ticket);
    } catch {
      /* ignore */
    }
  }, [activeTicket, refresh, staffTicket, ticket]);

  useEffect(() => {
    if (!loggedIn) return;
    void refresh();
  }, [loggedIn, refresh]);

  useEffect(() => {
    if (mode === "closed" || !loggedIn) return;
    const id = window.setInterval(() => void refreshActive(), 2500);
    return () => window.clearInterval(id);
  }, [mode, loggedIn, refreshActive]);

  useEffect(() => {
    if (mode !== "open") return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mode, activeTicket?.messages.length]);

  async function openSupport() {
    setError(null);
    if (!loggedIn) {
      void signIn("steam", { callbackUrl: "/" });
      return;
    }
    setBusy(true);
    try {
      const probe = await fetch("/api/support/tickets", { cache: "no-store" });
      const probeData = (await probe.json().catch(() => ({}))) as {
        ok?: boolean;
        staff?: boolean;
        welcome?: string;
        myNick?: string;
        ticket?: Ticket | null;
        inbox?: InboxItem[];
      };
      if (probe.ok && probeData.ok) {
        setStaff(Boolean(probeData.staff));
        if (probeData.welcome) setWelcome(probeData.welcome);
        if (probeData.myNick) setMyNick(probeData.myNick);
        setTicket(probeData.ticket || null);
        setInbox(probeData.inbox || []);
        if (probeData.staff) {
          setView("inbox");
          setStaffTicket(null);
          setMode("open");
          return;
        }
        setView("chat");
        setStaffTicket(null);
        setMode("open");
        return;
      }
      setView("chat");
      setMode("open");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  function openMyChatDraft() {
    setStaffTicket(null);
    setView("chat");
    setMode("open");
    setError(null);
  }

  async function sendMessage() {
    if (!text.trim() || busy) return;
    // Стафф в чужом тикете — только через существующий ticket id
    if (staff && staffTicket && view === "inbox") {
      await sendToTicket(staffTicket.id, text.trim());
      return;
    }
    if (ticket) {
      await sendToTicket(ticket.id, text.trim());
      return;
    }
    // Первое сообщение пользователя → создаёт тикет
    const body = text.trim();
    setText("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        ticket?: Ticket;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.ticket) {
        setError("Не отправилось");
        setText(body);
        return;
      }
      setTicket(data.ticket);
      setView("chat");
      await refresh();
    } catch {
      setError("Сеть недоступна");
      setText(body);
    } finally {
      setBusy(false);
    }
  }

  async function sendToTicket(ticketId: string, body: string) {
    setText("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: Msg;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.message) {
        setError("Не отправилось");
        setText(body);
        return;
      }
      const apply = (t: Ticket | null) =>
        t && t.id === ticketId
          ? { ...t, messages: [...t.messages, data.message!] }
          : t;
      setTicket((t) => apply(t));
      setStaffTicket((t) => apply(t));
      await refresh();
    } catch {
      setError("Сеть недоступна");
      setText(body);
    } finally {
      setBusy(false);
    }
  }

  async function closeTicket() {
    if (busy) return;
    if (!activeTicket) {
      setMode("closed");
      return;
    }
    if (!window.confirm("Завершить обращение? История этого тикета удалится.")) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/support/tickets/${activeTicket.id}`, {
        method: "DELETE",
      });
      if (ticket?.id === activeTicket.id) setTicket(null);
      if (staffTicket?.id === activeTicket.id) setStaffTicket(null);
      setMode("closed");
      await refresh();
    } catch {
      setError("Не удалось закрыть");
    } finally {
      setBusy(false);
    }
  }

  async function openInboxTicket(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/tickets/${id}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { ok?: boolean; ticket?: Ticket };
      if (!res.ok || !data.ok || !data.ticket) {
        setError("Тикет недоступен");
        return;
      }
      setStaffTicket(data.ticket);
      setView("inbox");
      setMode("open");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  const waitingCount = inbox.filter((i) => i.waiting).length;
  const titleNumber = activeTicket ? `#${activeTicket.number}` : "";
  const showingUserDraft = view === "chat" && !ticket && !(staff && staffTicket);

  return (
    <div className="support-root" aria-live="polite">
      {mode === "minimized" ? (
        <button
          type="button"
          className="support-mini"
          style={{ left: geom.left, top: geom.top }}
          onClick={() => setMode("open")}
          title="Развернуть чат"
        >
          <span>
            {activeTicket
              ? `Тикет ${titleNumber}`
              : staff && view === "inbox"
                ? "Очередь поддержки"
                : "Техподдержка"}
          </span>
          <span className="support-mini-nick">
            {staff && staffTicket ? staffTicket.userNick : myNick}
          </span>
        </button>
      ) : null}

      {mode === "open" ? (
        <section
          className={`support-panel${dragging ? " support-panel-dragging" : ""}`}
          role="dialog"
          aria-label="Техподдержка"
          style={{
            left: geom.left,
            top: geom.top,
            width: geom.width,
            height: geom.height,
          }}
        >
          <header
            className="support-head support-head-drag"
            onPointerDown={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest("button")) return;
              startDrag("move", e);
            }}
            title="Перетащить окно"
          >
            <div className="support-head-text">
              <strong>
                {staff && view === "inbox" && staffTicket
                  ? `Тикет #${staffTicket.number} · ${staffTicket.userNick}`
                  : activeTicket
                    ? `Тикет #${activeTicket.number}`
                    : "Техподдержка"}
              </strong>
              <p>{welcome}</p>
            </div>
            <div className="support-head-actions">
              {staff ? (
                <button
                  type="button"
                  className="support-icon-btn"
                  title="Очередь"
                  onClick={() => {
                    setView("inbox");
                    setStaffTicket(null);
                  }}
                >
                  ≡{waitingCount > 0 ? ` ${waitingCount}` : ""}
                </button>
              ) : null}
              <button
                type="button"
                className="support-icon-btn"
                title="Свернуть"
                onClick={() => setMode("minimized")}
              >
                –
              </button>
              <button
                type="button"
                className="support-icon-btn"
                title="Закрыть окно"
                onClick={() => setMode("closed")}
              >
                ×
              </button>
            </div>
          </header>

          {staff && view === "inbox" && !staffTicket ? (
            <div className="support-inbox">
              {inbox.length === 0 ? (
                <p className="support-empty">Открытых тикетов нет</p>
              ) : (
                inbox.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`support-inbox-item${item.waiting ? " waiting" : ""}`}
                    onClick={() => void openInboxTicket(item.id)}
                  >
                    <span className="support-inbox-top">
                      <b>#{item.number}</b>
                      <span>{item.userNick}</span>
                      {item.waiting ? (
                        <em className="support-badge">ждёт</em>
                      ) : null}
                    </span>
                    <span className="support-inbox-preview">{item.preview}</span>
                  </button>
                ))
              )}
              <button
                type="button"
                className="support-linkish"
                onClick={openMyChatDraft}
              >
                Мой чат
              </button>
            </div>
          ) : (
            <>
              <div className="support-msgs">
                {showingUserDraft ? (
                  <div className="support-msg support-msg-bot">
                    <span className="support-msg-from">Тех. поддержка</span>
                    <p>{DRAFT_HINT}</p>
                  </div>
                ) : null}
                {(activeTicket?.messages || []).map((m) => (
                  <div
                    key={m.id}
                    className={`support-msg support-msg-${m.kind.toLowerCase()}`}
                  >
                    <span className="support-msg-from">{m.from}</span>
                    <p>{m.body}</p>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              {error ? <p className="support-error">{error}</p> : null}
              <form
                className="support-compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendMessage();
                }}
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    staff && staffTicket
                      ? "Ответ от Тех. поддержки…"
                      : showingUserDraft
                        ? "Напишите вопрос…"
                        : "Ваш вопрос…"
                  }
                  maxLength={2000}
                  disabled={busy || (staff && view === "inbox" && !staffTicket)}
                />
                <button
                  type="submit"
                  className="btn primary"
                  disabled={busy || !text.trim()}
                >
                  →
                </button>
              </form>
              <footer className="support-foot">
                <span className="muted">
                  Вы: {staff && staffTicket ? "Тех. поддержка" : myNick}
                </span>
              </footer>
              {activeTicket ? (
                <button
                  type="button"
                  className="support-close-ticket"
                  onClick={() => void closeTicket()}
                  disabled={busy}
                >
                  Закрыть тикет
                </button>
              ) : (
                <button
                  type="button"
                  className="support-close-ticket ghost"
                  onClick={() => void closeTicket()}
                  disabled={busy}
                >
                  Закрыть окно
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="support-resize"
            aria-label="Изменить размер"
            title="Потяни, чтобы изменить размер"
            onPointerDown={(e) => startDrag("resize", e)}
          />
        </section>
      ) : null}

      {mode === "closed" ? (
        <button
          type="button"
          className="support-fab"
          onClick={() => void openSupport()}
          disabled={busy || status === "loading"}
          title="Техподдержка"
          aria-label="Открыть техподдержку"
        >
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
            <path
              fill="currentColor"
              d="M12 3c-4.97 0-9 3.58-9 8 0 2.4 1.2 4.55 3.1 6.05L5 21l4.15-1.66C10.05 19.78 11 20 12 20c4.97 0 9-3.58 9-8s-4.03-9-9-9zm0 2c3.87 0 7 2.69 7 6s-3.13 6-7 6c-.86 0-1.68-.12-2.45-.35l-.55-.16-.58.23-1.62.65.3-1.72.1-.55-.38-.42C5.66 13.4 5 11.78 5 11c0-3.31 3.13-6 7-6z"
            />
          </svg>
          {waitingCount > 0 ? (
            <span className="support-fab-badge">{waitingCount}</span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}
