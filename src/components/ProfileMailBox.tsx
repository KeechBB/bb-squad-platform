"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ListPager } from "@/components/ListPager";
import { MailTags } from "@/components/MailTags";
import { CwLetterReady } from "@/components/CwLetterReady";
import { MailBody } from "@/components/MailBody";

type Letter = {
  id: string;
  title: string;
  body: string;
  senderKind: string;
  senderLabel: string;
  tags?: string[];
  cwMatchId?: string | null;
  createdAt: string;
  read: boolean;
  favorite: boolean;
  deleted: boolean;
  daysLeft?: number | null;
};

type Folder = "inbox" | "star" | "trash";

const ROW_H = 108;

function purgeLabel(days: number) {
  if (days <= 0) return "удалится сегодня";
  const n = Math.abs(days) % 100;
  const n1 = n % 10;
  const word =
    n > 10 && n < 20 ? "дней" : n1 === 1 ? "день" : n1 >= 2 && n1 <= 4 ? "дня" : "дней";
  return `удалится через ${days} ${word}`;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProfileMailBox() {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [open, setOpen] = useState<Letter | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/profile/mail", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setLetters(Array.isArray(json.letters) ? json.letters : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const n = Math.floor(el.clientHeight / ROW_H);
      setPageSize(Math.max(1, n || 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [folder]);

  const visible = useMemo(() => {
    if (folder === "trash") return letters.filter((l) => l.deleted);
    if (folder === "star") return letters.filter((l) => l.favorite && !l.deleted);
    return letters.filter((l) => !l.deleted);
  }, [letters, folder]);

  const unread = letters.filter((l) => !l.deleted && !l.read).length;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const slice = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [folder]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  async function act(id: string, action: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/profile/mail", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.letters)) setLetters(json.letters);
    } finally {
      setBusy(false);
    }
  }

  async function closeReader() {
    const current = open;
    setOpen(null);
    if (current && !current.read) await act(current.id, "read");
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const current = open;
      setOpen(null);
      if (!current.read) void act(current.id, "read");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const reader =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="profile-match-modal profile-mail-reader" role="presentation">
            <button
              type="button"
              className="profile-match-modal-backdrop"
              aria-label="Закрыть"
              onClick={() => void closeReader()}
            />
            <div
              className="profile-match-modal-panel profile-mail-reader-panel"
              role="dialog"
              aria-modal="true"
            >
              <header className="profile-match-modal-head">
                <div>
                  <p
                    className={`profile-mail-modal-from${
                      open.senderKind === "developer" ? " is-dev" : ""
                    }`}
                  >
                    от {open.senderLabel}
                  </p>
                  <h2 className="profile-mail-modal-title">{open.title}</h2>
                  <p className="profile-match-modal-sub">
                    {formatWhen(open.createdAt)} МСК
                  </p>
                  {open.daysLeft != null ? (
                    <p className="profile-mail-purge">{purgeLabel(open.daysLeft)}</p>
                  ) : null}
                  <MailTags tags={open.tags || []} />
                </div>
                <button
                  type="button"
                  className="profile-match-modal-close"
                  onClick={() => void closeReader()}
                  aria-label="Закрыть"
                >
                  ×
                </button>
              </header>
              <div className="profile-mail-modal-body">
                <MailBody text={open.body} />
              </div>
              {open.cwMatchId ? <CwLetterReady matchId={open.cwMatchId} /> : null}
              <div className="profile-mail-modal-actions">
                {open.deleted ? null : open.favorite ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      void act(open.id, "unfavorite");
                      setOpen({ ...open, favorite: false, read: true });
                    }}
                  >
                    Убрать из избранного
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      void act(open.id, "favorite");
                      setOpen(null);
                    }}
                  >
                    Добавить в избранное
                  </button>
                )}
                {open.deleted ? null : (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      void act(open.id, "delete");
                      setOpen(null);
                    }}
                  >
                    Удалить письмо
                  </button>
                )}
                <button type="button" className="btn" onClick={() => void closeReader()}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <aside className="profile-mail" aria-label="Почта">
      <div className="profile-mail-tabs" role="tablist">
        <button
          type="button"
          className={`profile-mail-tab${folder === "inbox" ? " is-on" : ""}`}
          onClick={() => setFolder("inbox")}
        >
          входящие
          {unread ? <span className="profile-mail-badge">{unread}</span> : null}
        </button>
        <button
          type="button"
          className={`profile-mail-tab${folder === "star" ? " is-on" : ""}`}
          onClick={() => setFolder("star")}
        >
          избранное
        </button>
        <button
          type="button"
          className={`profile-mail-tab${folder === "trash" ? " is-on" : ""}`}
          onClick={() => setFolder("trash")}
        >
          удаленные
        </button>
      </div>
      <div className="profile-mail-list" ref={listRef}>
        {slice.length ? (
          slice.map((letter) => (
            <button
              key={letter.id}
              type="button"
              className={`profile-mail-row${letter.read ? "" : " is-unread"}`}
              onClick={() => setOpen(letter)}
            >
              <span className="profile-mail-copy">
                <span
                  className={`profile-mail-from${
                    letter.senderKind === "developer" ? " is-dev" : ""
                  }`}
                >
                  от {letter.senderLabel}
                </span>
                <span className="profile-mail-title">{letter.title}</span>
                {letter.daysLeft != null ? (
                  <span className="profile-mail-purge">{purgeLabel(letter.daysLeft)}</span>
                ) : null}
              </span>
              <MailTags tags={letter.tags || []} />
            </button>
          ))
        ) : (
          <p className="profile-mail-empty">Писем нет</p>
        )}
      </div>
      <ListPager
        page={safePage}
        pageCount={pageCount}
        total={visible.length}
        pageSize={pageSize}
        onChange={setPage}
        label="Страницы писем"
        maxButtons={5}
      />
      {reader}
    </aside>
  );
}
