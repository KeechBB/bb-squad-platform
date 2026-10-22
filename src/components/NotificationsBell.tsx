"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { setVisibleInterval } from "@/lib/visibleInterval";

type SiteNoticeItem = {
  id: string;
  title: string;
  body: string;
  href: string | null;
  linkLabel: string | null;
  imageUrl?: string | null;
  kind?: string;
  seen: boolean;
};

type TeamInvite = {
  id: string;
  createdAt: string;
  inviterNick: string;
  team: {
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
  };
};

export function NotificationsBell() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [notices, setNotices] = useState<SiteNoticeItem[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    if (!session?.user?.profileComplete) {
      setInvites([]);
      return;
    }
    try {
      const res = await fetch("/api/tournaments/invites", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { invites?: TeamInvite[] };
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch("/api/notices", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notices?: SiteNoticeItem[] };
      setNotices(Array.isArray(data.notices) ? data.notices : []);
    } catch {
      /* ignore */
    }
  }, [session?.user?.profileComplete]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.profileComplete) return;
    void reload();
    const clear = setVisibleInterval(() => void reload(), 45_000);
    return () => clear();
  }, [status, session?.user?.profileComplete, reload]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unseenNotices = notices.filter((n) => !n.seen);

  async function markSeen(ids: string[]) {
    if (ids.length === 0) return;
    setNotices((list) =>
      list.map((n) => (ids.includes(n.id) ? { ...n, seen: true } : n))
    );
    await Promise.all(
      ids.map((noticeId) =>
        fetch("/api/notices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noticeId, action: "seen" }),
        }).catch(() => null)
      )
    );
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void markSeen(unseenNotices.map((n) => n.id));
  }

  async function dismiss(noticeId: string) {
    setError("");
    setLoading(noticeId);
    setNotices((list) => list.filter((n) => n.id !== noticeId));
    try {
      const res = await fetch("/api/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noticeId, action: "dismiss" }),
      });
      if (!res.ok) {
        setError("Не удалось закрыть");
        void reload();
      }
    } catch {
      setError("Сеть недоступна");
      void reload();
    } finally {
      setLoading(null);
    }
  }

  async function act(inviteId: string, action: "accept" | "decline") {
    setError("");
    setLoading(inviteId);
    try {
      const res = await fetch("/api/tournaments/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Ошибка");
        return;
      }
      setInvites((list) => list.filter((i) => i.id !== inviteId));
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(null);
    }
  }

  if (status !== "authenticated" || !session?.user?.profileComplete) {
    return null;
  }

  const count = invites.length + notices.length;
  const alarm = unseenNotices.length > 0;

  return (
    <div
      className={`notif-bell${open ? " is-open" : ""}${count ? " has-items" : ""}${alarm ? " has-unseen" : ""}`}
      ref={wrapRef}
    >
      <button
        type="button"
        className="notif-bell-btn"
        aria-label={
          alarm
            ? `Уведомления: ${count}, есть непрочитанные`
            : count
              ? `Уведомления: ${count}`
              : "Уведомления"
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"
          />
        </svg>
        {count > 0 ? (
          <span className="notif-bell-badge">{count > 9 ? "9+" : count}</span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-panel" role="dialog" aria-label="Уведомления">
          <header className="notif-panel-head">
            <h3>Уведомления</h3>
          </header>
          {error ? <p className="notif-error">{error}</p> : null}
          {notices.length === 0 && invites.length === 0 ? (
            <p className="notif-empty">Пока пусто</p>
          ) : (
            <ul className="notif-list">
              {notices.map((n) => (
                <li
                  key={n.id}
                  className={`notif-item${n.kind === "reward" ? " is-reward" : ""}`}
                >
                  {n.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="notif-reward-img" src={n.imageUrl} alt="" />
                  ) : null}
                  <div className="notif-item-text">
                    {n.kind === "reward" ? <em>Награда</em> : null}
                    <strong>{n.title}</strong>
                    <span>{n.body}</span>
                  </div>
                  <div className="notif-item-actions">
                    {n.href ? (
                      <Link className="notif-link" href={n.href} onClick={() => setOpen(false)}>
                        {n.linkLabel || "Открыть"}
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="notif-decline"
                      disabled={loading === n.id}
                      onClick={() => void dismiss(n.id)}
                    >
                      Закрыть
                    </button>
                  </div>
                </li>
              ))}
              {invites.map((inv) => (
                <li key={inv.id} className="notif-item">
                  <div className="notif-item-text">
                    <strong>
                      Приглашение в [{inv.team.tag}] {inv.team.name}
                    </strong>
                    <span>от {inv.inviterNick}</span>
                  </div>
                  <div className="notif-item-actions">
                    <button
                      type="button"
                      className="notif-accept"
                      disabled={loading === inv.id}
                      onClick={() => void act(inv.id, "accept")}
                    >
                      Принять
                    </button>
                    <button
                      type="button"
                      className="notif-decline"
                      disabled={loading === inv.id}
                      onClick={() => void act(inv.id, "decline")}
                    >
                      Отклонить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
