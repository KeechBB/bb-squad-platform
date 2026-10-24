"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ProfileV2ScaleStage } from "@/components/ProfileV2ScaleStage";
import { NetEmojiBar, NetEmojiToggle, NetRichText } from "@/components/NetEmoji";
import { NET_TEXT_MAX, netVisibleLength } from "@/lib/netEmoji";
import type { NetChatLine, NetPageData, NetPerson, NetThemeCard } from "@/lib/netTypes";

type Modal = null | "avatar" | "theme" | "bg" | "status" | "subs" | "post" | "news";

function NetFrame({
  bgUrl,
  children,
}: {
  bgUrl?: string | null;
  children: ReactNode;
}) {
  useEffect(() => {
    const body = document.body;
    if (bgUrl) {
      body.style.setProperty("--profile-bg-image", `url(${bgUrl})`);
      body.classList.add("has-profile-bg");
    } else {
      body.style.removeProperty("--profile-bg-image");
      body.classList.remove("has-profile-bg");
    }
    return () => {
      body.style.removeProperty("--profile-bg-image");
      body.classList.remove("has-profile-bg");
      document.documentElement.style.removeProperty("--net-visor");
    };
  }, [bgUrl]);

  useEffect(() => {
    paintVisor(bgUrl || null);
  }, [bgUrl]);

  return (
    <ProfileV2ScaleStage hasBg={Boolean(bgUrl)} contentWidth={1780}>
      {children}
    </ProfileV2ScaleStage>
  );
}

function commentWord(n: number) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "комментарий";
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "комментария";
  return "комментариев";
}

function nickColor(nick: string) {
  let hash = 0;
  for (const ch of nick) hash = (hash * 33 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 78% 68%)`;
}

function clockLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function sampleOnline(nicks: string[], prevKey: string, prev: string[]) {
  const key = [...nicks].sort().join("|");
  if (key === prevKey) return { key, list: prev.filter((nick) => nicks.includes(nick)) };
  if (nicks.length <= 15) return { key, list: nicks };
  const copy = [...nicks];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  const count = 10 + Math.floor(Math.random() * 6);
  return { key, list: copy.slice(0, count) };
}

function paintVisor(url: string | null) {
  const root = document.documentElement;
  if (!url) {
    root.style.removeProperty("--net-visor");
    return;
  }
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, 24, 24);
    const data = ctx.getImageData(0, 0, 24, 24).data;
    const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r + g + b < 48) continue;
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.n += 1;
      buckets.set(key, bucket);
    }
    let best: { r: number; g: number; b: number; n: number } | null = null;
    for (const bucket of buckets.values()) {
      if (!best || bucket.n > best.n) best = bucket;
    }
    if (!best || best.n === 0) return;
    const scale = Math.min(2.1, 210 / Math.max(best.r, best.g, best.b, 1));
    const tone = (value: number) => Math.min(255, Math.round((value / best.n) * Math.max(1.15, scale)));
    root.style.setProperty("--net-visor", `rgb(${tone(best.r)} ${tone(best.g)} ${tone(best.b)})`);
  };
  img.src = url;
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CommentComposer({
  value,
  onChange,
  onSend,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
}) {
  const [emoji, setEmoji] = useState(false);
  return (
    <div className="net-compose">
      {emoji ? <NetEmojiBar onPick={(token) => onChange(value + token)} /> : null}
      <div className="net-compose-row">
        <input
          value={value}
          placeholder="Написать комментарий"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <NetEmojiToggle open={emoji} onToggle={() => setEmoji((v) => !v)} />
        <button type="button" className="net-send" disabled={busy || !value.trim()} onClick={onSend}>
          Отправить
        </button>
      </div>
    </div>
  );
}

function NetFlood() {
  const [lines, setLines] = useState<NetChatLine[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [shown, setShown] = useState<string[]>([]);
  const onlineKey = useRef("");
  const shownRef = useRef<string[]>([]);
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef(true);

  const pull = useCallback(async () => {
    const res = await fetch("/api/net/chat", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return;
    setLines(json.messages || []);
    const nicks = (json.online || []).map((p: NetPerson) => p.nick);
    setOnline(nicks);
    const picked = sampleOnline(nicks, onlineKey.current, shownRef.current);
    onlineKey.current = picked.key;
    shownRef.current = picked.list;
    setShown(picked.list);
  }, []);

  useEffect(() => {
    void pull();
    const id = window.setInterval(() => void pull(), 4000);
    return () => window.clearInterval(id);
  }, [pull]);

  useEffect(() => {
    const el = logRef.current;
    if (el && pinRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await fetch("/api/net/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setSending(false);
    if (!res.ok) return;
    setText("");
    pinRef.current = true;
    await pull();
  }

  return (
    <section className="net-panel net-chat" aria-label="Чат">
      <h2>
        Чат <span className="net-chat-count">{online.length} в сети</span>
      </h2>
      <p className="net-chat-who">
        {shown.length === 0
          ? "В Сети сейчас никого"
          : shown.map((nick, i) => (
              <span key={nick}>
                {i > 0 ? ", " : null}
                <Link href={`/profile/web/${encodeURIComponent(nick)}`} style={{ color: nickColor(nick) }}>{nick}</Link>
              </span>
            ))}
      </p>
      <div
        className="net-chat-log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {lines.length === 0 ? <p className="net-empty">Пока тихо. Напиши первым.</p> : null}
        {lines.map((m) => (
          <div key={m.id} className="net-chat-line">
            <div className="net-chat-meta">
              <Link href={`/profile/web/${encodeURIComponent(m.nick)}`} style={{ color: nickColor(m.nick) }}>{m.nick}</Link>
              <time>{clockLabel(m.createdAt)}</time>
            </div>
            <div className="net-chat-body">
              <NetRichText text={m.body} />
            </div>
          </div>
        ))}
      </div>
      <div className="net-chat-compose">
        {emoji ? <NetEmojiBar onPick={(token) => setText((v) => v + token)} /> : null}
        <div className="net-compose-row">
          <input
            value={text}
            placeholder="Написать всем"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
          />
          <NetEmojiToggle open={emoji} onToggle={() => setEmoji((v) => !v)} />
          <button type="button" className="net-send" disabled={sending || !text.trim()} onClick={() => void send()}>
            ок
          </button>
        </div>
      </div>
    </section>
  );
}

function PhotoLoupe({ src, onClose }: { src: string; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);

  const applyZoom = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const el = scroller.current;
    const prev = zoomRef.current || 1;
    const clamped = Math.min(8, Math.max(0.2, next));
    zoomRef.current = clamped;
    setZoom(clamped);
    if (!el || !anchor) return;
    const ratio = clamped / prev;
    const rect = el.getBoundingClientRect();
    const ox = anchor.x - rect.left + el.scrollLeft;
    const oy = anchor.y - rect.top + el.scrollTop;
    requestAnimationFrame(() => {
      el.scrollLeft = ox * ratio - (anchor.x - rect.left);
      el.scrollTop = oy * ratio - (anchor.y - rect.top);
    });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      applyZoom(zoomRef.current * dir, { x: e.clientX, y: e.clientY });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [applyZoom]);

  return createPortal(
    <div
      className={`net-loupe${dragging ? " is-drag" : ""}`}
      ref={scroller}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const el = scroller.current;
        if (!el) return;
        drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        setDragging(true);
      }}
      onMouseMove={(e) => {
        if (!drag.current || !scroller.current) return;
        scroller.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
        scroller.current.scrollTop = drag.current.top - (e.clientY - drag.current.y);
      }}
      onMouseUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onMouseLeave={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div className="net-loupe-bar">
        <button type="button" onClick={() => applyZoom(zoomRef.current * 1.35)}>Приблизить</button>
        <button type="button" onClick={() => applyZoom(zoomRef.current / 1.35)}>Отдалить</button>
        <span>{Math.round(zoom * 100)}%</span>
        <span className="net-loupe-hint">колёсико — лупа, картинку можно тащить</span>
        <button type="button" onClick={onClose}>Закрыть</button>
      </div>
      <img
        src={src}
        alt=""
        draggable={false}
        style={natural.w ? { width: Math.round(natural.w * zoom), height: Math.round(natural.h * zoom) } : undefined}
        onLoad={(e) => {
          const img = e.currentTarget;
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          setNatural({ w, h });
          const fit = Math.min((window.innerWidth - 48) / w, (window.innerHeight - 96) / h, 1);
          zoomRef.current = fit > 0 ? fit : 1;
          setZoom(zoomRef.current);
        }}
      />
    </div>,
    document.body,
  );
}

function Thumb({ down }: { down?: boolean }) {
  return (
    <svg className={`net-thumb${down ? " is-down" : ""}`} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"
      />
    </svg>
  );
}

function people(list: NetPerson[]) {
  if (!list.length) return <p className="net-empty">Пока никого</p>;
  return list.map((p) => (
    <Link key={p.nick} className="net-person" href={`/profile/web/${encodeURIComponent(p.nick)}`}>
      {p.nick}
    </Link>
  ));
}

type WriteSize = "md" | "lg" | "xl";

function packWrite(text: string, size: WriteSize, bold: boolean) {
  const clean = text.replace(/\[\[\/?(?:b|s:(?:md|lg|xl))\]\]/g, "");
  let out = clean;
  if (bold) out = `[[b]]${out}[[/b]]`;
  if (size !== "md") out = `[[s:${size}]]${out}[[/s]]`;
  return out;
}

function WriteTools({
  size,
  bold,
  onSize,
  onBold,
}: {
  size: WriteSize;
  bold: boolean;
  onSize: (size: WriteSize) => void;
  onBold: () => void;
}) {
  return (
    <div className="net-write-tools">
      <button type="button" className={size === "md" ? "is-on" : ""} onClick={() => onSize("md")}>Обычный</button>
      <button type="button" className={size === "lg" ? "is-on" : ""} onClick={() => onSize("lg")}>Крупный</button>
      <button type="button" className={size === "xl" ? "is-on" : ""} onClick={() => onSize("xl")}>Огромный</button>
      <button type="button" className={bold ? "is-on" : ""} onClick={onBold}><b>Жирный</b></button>
    </div>
  );
}

export function NetPageClient({ nick }: { nick: string }) {
  const [data, setData] = useState<NetPageData | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openTheme, setOpenTheme] = useState<NetThemeCard | null>(null);
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [bgId, setBgId] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [postBody, setPostBody] = useState("");
  const [postFile, setPostFile] = useState<File | null>(null);
  const [postLocked, setPostLocked] = useState(false);
  const [newsTitle, setNewsTitle] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [themeDraft, setThemeDraft] = useState("");
  const [picker, setPicker] = useState(false);
  const [themeSize, setThemeSize] = useState<WriteSize>("md");
  const [themeBold, setThemeBold] = useState(false);
  const [postSize, setPostSize] = useState<WriteSize>("md");
  const [postBold, setPostBold] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/net?nick=${encodeURIComponent(nick)}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Не открылось");
      setData(null);
      return;
    }
    const page = json as NetPageData;
    setData(page);
    setError("");
    setOpenTheme((prev) => {
      if (!prev) return null;
      return [...page.themes, ...page.popular].find((t) => t.id === prev.id) || null;
    });
  }, [nick]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function closeModal() {
    setModal(null);
    setPicker(false);
    setFormError("");
    setBusy(false);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(null);
    setAvatarFile(null);
  }

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setFormError("");
    const res = await fetch("/api/net", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(json.error || "Не сохранилось");
      return false;
    }
    await reload();
    return true;
  }

  async function upload(fd: FormData) {
    setBusy(true);
    setFormError("");
    const res = await fetch("/api/net/upload", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(json.error || "Не загрузилось. Если файл большой, подожди и нажми ещё раз.");
      return false;
    }
    await reload();
    return true;
  }

  function pickEmoji(token: string, value: string, set: (v: string) => void) {
    set(value + token);
  }

  if (error) {
    return (
      <NetFrame>
        <main className="net-page">
          <p className="net-error">{error}</p>
        </main>
      </NetFrame>
    );
  }
  if (!data) {
    return (
      <NetFrame>
        <main className="net-page">
          <p className="net-empty">Открываю сеть…</p>
        </main>
      </NetFrame>
    );
  }

  return (
    <NetFrame bgUrl={data.bgUrl}>
    <main className="net-page">
      <div className="net-side">
      <section className="net-panel net-avatar" aria-label="Аватар сети">
        {data.avatarUrl ? (
          <img src={data.avatarUrl} alt="" />
        ) : (
          <div className="net-avatar-empty">Аватар сети</div>
        )}
      </section>

      <section className="net-panel net-status" aria-label="Статус">
        {data.status ? <NetRichText text={data.status} /> : <span className="net-empty">Статус</span>}
      </section>

      <section className="net-panel net-subs" aria-label="Подписчики">
        <h2>Подписчики</h2>
        <div className="net-scroll">{people(data.followers)}</div>
      </section>

      <NetFlood />
      </div>

      <section className="net-panel net-panel-ctrl" aria-label="Пульт">
        <h2>
          <Link className="net-back" href="/profile">← профиль</Link>
          Сеть · <Link className="net-own-nick" href={`/profile/web/${encodeURIComponent(data.nick)}`}>{data.nick}</Link>
        </h2>
        <div className="net-ctrl-list">
          {data.isOwn ? (
            <>
              <button type="button" className="net-ctrl-avatar" onClick={() => setModal("avatar")}>Аватар</button>
              <button type="button" className="net-ctrl-theme" onClick={() => { setTitle(""); setBody(""); setImages([]); setThemeSize("md"); setThemeBold(false); setModal("theme"); }}>
                Создание темы
              </button>
              <button type="button" className="net-ctrl-bg" onClick={() => { setBgId(data.bgId); setModal("bg"); }}>Фон</button>
              <button type="button" className="net-ctrl-status" onClick={() => { setStatus(data.status); setModal("status"); }}>Статус</button>
            </>
          ) : null}
          <button type="button" className="net-ctrl-subs" onClick={() => setModal("subs")}>Мои подписки</button>
        </div>
        {data.isOwn ? null : (
          <button
            type="button"
            className={`net-sub-btn${data.subscribed ? " is-on" : ""}`}
            disabled={data.subscribed || busy}
            onClick={() => void act({ action: "follow", nick: data.nick, on: true })}
          >
            {data.subscribed ? "Вы подписаны" : "Подписаться"}
          </button>
        )}
      </section>

      <section className="net-panel net-themes" aria-label="Мои темы">
        <h2>Мои темы</h2>
        <div className="net-theme-list">
          {data.themes.length === 0 ? <p className="net-empty">Тем пока нет. Лимит {data.themeLimit}.</p> : null}
          {data.themes.map((theme) => (
            <div className="net-theme-row" key={theme.id}>
              <button type="button" className="net-theme-title" onClick={() => { setThemeDraft(""); setOpenTheme(theme); }}>
                {theme.title}
              </button>
              <button
                type="button"
                className={`net-like${theme.myVote === 1 ? " is-on" : ""}`}
                onClick={() => void act({ action: "vote", id: theme.id, value: theme.myVote === 1 ? 0 : 1 })}
                aria-label="Лайк"
              >
                <Thumb /> {theme.likes}
              </button>
              <button
                type="button"
                className={`net-vote${theme.myVote === -1 ? " is-on" : ""}`}
                onClick={() => void act({ action: "vote", id: theme.id, value: theme.myVote === -1 ? 0 : -1 })}
                aria-label="Дизлайк"
              >
                <Thumb down /> {theme.dislikes}
              </button>
              {theme.mine ? (
                <button
                  type="button"
                  className="net-theme-del"
                  onClick={() => {
                    if (window.confirm("Удалить тему?")) void act({ action: "delete-theme", id: theme.id });
                  }}
                >
                  Удалить
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <div className="net-rail">
      <section className="net-panel net-popular" aria-label="Популярные темы">
        <h2>Популярные темы</h2>
        <div className="net-scroll">
          {data.popular.length === 0 ? <p className="net-empty">Пока тихо</p> : null}
          {data.popular.map((theme) => (
            <div className="net-pop-row" key={theme.id}>
              <div className="net-pop-main">
                <button type="button" className="net-pop-title" onClick={() => { setThemeDraft(""); setOpenTheme(theme); }}>
                  {theme.title}
                </button>
                <Link className="net-pop-author" href={`/profile/web/${encodeURIComponent(theme.authorNick)}`}>{theme.authorNick}</Link>
              </div>
              <span className="net-like"><Thumb /> {theme.likes}</span>
              <span className="net-vote"><Thumb down /> {theme.dislikes}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="net-panel net-news" aria-label="Новости">
        <h2>Новости</h2>
        <div className="net-scroll">
          {data.news.length === 0 ? <p className="net-empty">За неделю новостей нет</p> : null}
          {data.news.map((item) => (
            <article key={item.id} className="net-news-card">
              <h3 className="net-news-title">{item.title}</h3>
              <div className="net-news-body"><NetRichText text={item.body} /></div>
            </article>
          ))}
        </div>
      </section>
      </div>

      <section className="net-panel net-feed" aria-label="Лента">
        <h2>Лента</h2>
        <div className="net-feed-scroll">
          {data.posts.length === 0 ? <p className="net-empty">Постов ещё нет</p> : null}
          {data.posts.map((post) => (
            <article className="net-post" key={post.id}>
              <div className="net-post-body">
                {post.body ? <NetRichText text={post.body} /> : null}
              </div>
              {post.imageUrl ? (
                <button type="button" className="net-photo-btn" onClick={() => setPhoto(post.imageUrl)}>
                  <img className="net-photo" src={post.imageUrl} alt="" />
                </button>
              ) : null}
              {post.gifUrl ? (
                <button type="button" className="net-photo-btn" onClick={() => setPhoto(post.gifUrl)}>
                  <img className="net-photo" src={post.gifUrl} alt="" />
                </button>
              ) : null}
              {post.videoUrl ? <video src={post.videoUrl} controls /> : null}
              <div className="net-vk-bar">
                <button
                  type="button"
                  className={`net-like${post.myVote === 1 ? " is-on" : ""}`}
                  onClick={() => void act({ action: "like", id: post.id, value: post.myVote === 1 ? 0 : 1 })}
                  aria-label="Лайк"
                >
                  <Thumb /> {post.likes}
                </button>
                <button
                  type="button"
                  className={`net-vote${post.myVote === -1 ? " is-on" : ""}`}
                  onClick={() => void act({ action: "like", id: post.id, value: post.myVote === -1 ? 0 : -1 })}
                  aria-label="Дизлайк"
                >
                  <Thumb down /> {post.dislikes}
                </button>
                <span className="net-vk-count">
                  {post.comments.length} {commentWord(post.comments.length)}
                </span>
                {data.isOwn ? (
                  <button type="button" className="net-quiet" onClick={() => void act({ action: "delete-post", id: post.id })}>
                    удалить
                  </button>
                ) : null}
              </div>
              <div className="net-vk">
                {post.comments.map((c) => (
                  <div className="net-vk-comment" key={c.id}>
                    <Link href={`/profile/web/${encodeURIComponent(c.nick)}`}>{c.nick}</Link>
                    <p>
                      <NetRichText text={c.body} />
                    </p>
                    <div className="net-vk-meta">
                      <time>{whenLabel(c.createdAt)}</time>
                      {data.isOwn ? (
                        <button
                          type="button"
                          className="net-quiet net-comment-del"
                          onClick={() => {
                            if (window.confirm("Удалить комментарий?")) {
                              void act({ action: "delete-comment", id: c.id });
                            }
                          }}
                        >
                          Удалить
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {post.commentsOpen ? (
                  <CommentComposer
                    value={comments[post.id] || ""}
                    busy={busy}
                    onChange={(v) => setComments((prev) => ({ ...prev, [post.id]: v }))}
                    onSend={() =>
                      void act({ action: "comment", postId: post.id, body: comments[post.id] || "" }).then((ok) => {
                        if (ok) setComments((prev) => ({ ...prev, [post.id]: "" }));
                      })
                    }
                  />
                ) : (
                  <p className="net-empty">Комментарии закрыты</p>
                )}
              </div>
            </article>
          ))}
        </div>
        {data.isOwn ? (
          <button type="button" className="net-create" onClick={() => { setPostBody(""); setPostFile(null); setPostLocked(false); setPostSize("md"); setPostBold(false); setModal("post"); }}>
            Создать пост
          </button>
        ) : null}
      </section>

      {modal ? (
        <div className="net-modal-back" onMouseDown={closeModal}>
          <div className={`net-modal${modal === "theme" ? " is-theme" : modal === "post" ? " is-post" : ""}`} onMouseDown={(e) => e.stopPropagation()} role="dialog">
            {formError ? <p className="net-error">{formError}</p> : null}

            {modal === "avatar" ? (
              <>
                <h3>Аватар</h3>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setAvatarFile(file);
                    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                    setAvatarPreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
                {avatarPreview ? <img src={avatarPreview} alt="" style={{ width: 160, height: 160, objectFit: "cover", borderRadius: 12 }} /> : null}
                <p className="net-empty">png, jpeg, webp, до 50 МБ</p>
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                  <button
                    type="button"
                    className="net-sub-btn"
                    disabled={busy || !avatarFile}
                    onClick={() => {
                      if (!avatarFile) return;
                      const fd = new FormData();
                      fd.set("kind", "avatar");
                      fd.set("file", avatarFile);
                      void upload(fd).then((ok) => { if (ok) closeModal(); });
                    }}
                  >
                    Подтвердить
                  </button>
                </div>
              </>
            ) : null}

            {modal === "status" ? (
              <>
                <h3>Статус</h3>
                <textarea value={status} onChange={(e) => setStatus(e.target.value)} />
                {picker ? <NetEmojiBar onPick={(token) => pickEmoji(token, status, setStatus)} /> : null}
                <div className="net-compose-row">
                  <p className="net-empty">{netVisibleLength(status)} / 50</p>
                  <NetEmojiToggle open={picker} onToggle={() => setPicker((v) => !v)} />
                </div>
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                  <button
                    type="button"
                    className="net-sub-btn"
                    disabled={busy || netVisibleLength(status) > 50}
                    onClick={() => void act({ action: "status", text: status }).then((ok) => { if (ok) closeModal(); })}
                  >
                    Подтвердить
                  </button>
                </div>
              </>
            ) : null}

            {modal === "bg" ? (
              <>
                <h3>Фон сети</h3>
                <div className="net-bg-grid">
                  <button type="button" className={!bgId ? "is-on" : ""} onClick={() => setBgId(null)}>
                    Без фона
                  </button>
                  {data.bgChoices.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={bgId === opt.id ? "is-on" : ""}
                      onClick={() => setBgId(opt.id)}
                    >
                      <img src={`/profile-bgs/${opt.file}`} alt={opt.label} />
                    </button>
                  ))}
                </div>
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                  <button
                    type="button"
                    className="net-sub-btn"
                    disabled={busy}
                    onClick={() => void act({ action: "bg", bgId }).then((ok) => { if (ok) closeModal(); })}
                  >
                    Подтвердить
                  </button>
                </div>
              </>
            ) : null}

            {modal === "theme" ? (
              <>
                <h3>Новая тема</h3>
                <input
                  value={title}
                  maxLength={30}
                  placeholder="Название, до 30 знаков"
                  onChange={(e) => setTitle(e.target.value)}
                />
                <WriteTools size={themeSize} bold={themeBold} onSize={setThemeSize} onBold={() => setThemeBold((v) => !v)} />
                <textarea
                  className={`${themeSize === "md" ? "" : `is-${themeSize}`}${themeBold ? " is-bold" : ""}`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Текст"
                />
                {picker ? <NetEmojiBar onPick={(token) => pickEmoji(token, body, setBody)} /> : null}
                <div className="net-compose-row">
                  <span className="net-empty">{netVisibleLength(body)} / {NET_TEXT_MAX}</span>
                  <NetEmojiToggle open={picker} onToggle={() => setPicker((v) => !v)} />
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(e) => setImages(Array.from(e.target.files || []).slice(0, 3))}
                />
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                  <button
                    type="button"
                    className="net-sub-btn"
                    disabled={busy || [...title].length > 30 || netVisibleLength(body) > NET_TEXT_MAX}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("kind", "theme");
                      fd.set("title", title);
                      fd.set("body", packWrite(body, themeSize, themeBold));
                      for (const file of images) fd.append("images", file);
                      void upload(fd).then((ok) => { if (ok) closeModal(); });
                    }}
                  >
                    Опубликовать
                  </button>
                </div>
              </>
            ) : null}

            {modal === "post" ? (
              <>
                <h3>Новый пост</h3>
                <WriteTools size={postSize} bold={postBold} onSize={setPostSize} onBold={() => setPostBold((v) => !v)} />
                <textarea
                  className={`${postSize === "md" ? "" : `is-${postSize}`}${postBold ? " is-bold" : ""}`}
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                  placeholder="Текст"
                />
                {picker ? <NetEmojiBar onPick={(token) => pickEmoji(token, postBody, setPostBody)} /> : null}
                <div className="net-compose-row">
                  <span className="net-empty">{netVisibleLength(postBody)} / {NET_TEXT_MAX}</span>
                  <NetEmojiToggle open={picker} onToggle={() => setPicker((v) => !v)} />
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                  onChange={(e) => setPostFile(e.target.files?.[0] || null)}
                />
                <label className="net-lock">
                  <input type="checkbox" checked={postLocked} onChange={(e) => setPostLocked(e.target.checked)} />
                  Запретить комментарии
                </label>
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                  <button
                    type="button"
                    className="net-sub-btn"
                    disabled={busy || netVisibleLength(postBody) > NET_TEXT_MAX}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("kind", "post");
                      fd.set("body", packWrite(postBody, postSize, postBold));
                      if (postLocked) fd.set("commentsOpen", "0");
                      if (postFile) fd.set("file", postFile);
                      void upload(fd).then((ok) => { if (ok) closeModal(); });
                    }}
                  >
                    Опубликовать
                  </button>
                </div>
              </>
            ) : null}

            {modal === "subs" ? (
              <>
                <h3>Мои подписки</h3>
                <div className="net-scroll">
                  {data.following.length === 0 ? <p className="net-empty">Пока никого</p> : null}
                  {data.following.map((p) => (
                    <div className="net-theme-row" key={p.nick}>
                      <Link className="net-person" href={`/profile/web/${encodeURIComponent(p.nick)}`}>
                        {p.nick}
                      </Link>
                      <button
                        type="button"
                        className="net-quiet"
                        onClick={() => void act({ action: "follow", nick: p.nick, on: false })}
                      >
                        отписаться
                      </button>
                    </div>
                  ))}
                </div>
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                </div>
              </>
            ) : null}

            {modal === "news" ? (
              <>
                <h3>Новость</h3>
                <input value={newsTitle} maxLength={80} placeholder="Заголовок" onChange={(e) => setNewsTitle(e.target.value)} />
                <textarea value={newsBody} onChange={(e) => setNewsBody(e.target.value)} placeholder="Текст" />
                {picker ? <NetEmojiBar onPick={(token) => pickEmoji(token, newsBody, setNewsBody)} /> : null}
                <div className="net-compose-row">
                  <span className="net-empty">Смайлы в текст</span>
                  <NetEmojiToggle open={picker} onToggle={() => setPicker((v) => !v)} />
                </div>
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                  <button
                    type="button"
                    className="net-sub-btn"
                    disabled={busy}
                    onClick={() => void act({ action: "news", title: newsTitle, body: newsBody }).then((ok) => { if (ok) closeModal(); })}
                  >
                    Опубликовать
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {openTheme ? (
        <div className="net-modal-back" onMouseDown={() => setOpenTheme(null)}>
          <div className="net-modal net-theme-sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog">
            <div className="net-theme-read">
              <div className="net-theme-read-head">
                <h3>{openTheme.title}</h3>
                <div className="net-row-actions">
                  {openTheme.mine ? (
                    <button
                      type="button"
                      className="net-theme-del"
                      onClick={() => {
                        if (window.confirm("Удалить тему?")) {
                          void act({ action: "delete-theme", id: openTheme.id }).then((ok) => {
                            if (ok) setOpenTheme(null);
                          });
                        }
                      }}
                    >
                      Удалить
                    </button>
                  ) : null}
                  <button type="button" className="net-quiet" onClick={() => setOpenTheme(null)}>Закрыть</button>
                </div>
              </div>
              <Link href={`/profile/web/${encodeURIComponent(openTheme.authorNick)}`}>{openTheme.authorNick}</Link>
              <div className="net-post-body"><NetRichText text={openTheme.body} /></div>
              {openTheme.imageUrls.map((url) => (
                <button type="button" key={url} className="net-photo-btn" onClick={() => setPhoto(url)}>
                  <img className="net-photo" src={url} alt="" />
                </button>
              ))}
              <div className="net-row-actions">
                <button type="button" className={`net-like${openTheme.myVote === 1 ? " is-on" : ""}`} aria-label="Лайк" onClick={() => void act({ action: "vote", id: openTheme.id, value: openTheme.myVote === 1 ? 0 : 1 })}>
                  <Thumb /> {openTheme.likes}
                </button>
                <button type="button" className={`net-vote${openTheme.myVote === -1 ? " is-on" : ""}`} aria-label="Дизлайк" onClick={() => void act({ action: "vote", id: openTheme.id, value: openTheme.myVote === -1 ? 0 : -1 })}>
                  <Thumb down /> {openTheme.dislikes}
                </button>
              </div>
            </div>
            <div className="net-theme-comments">
              {openTheme.comments.length === 0 ? <p className="net-empty">Комментариев пока нет</p> : null}
              {openTheme.comments.map((c) => (
                <div className="net-vk-comment" key={c.id}>
                  <Link href={`/profile/web/${encodeURIComponent(c.nick)}`}>{c.nick}</Link>
                  <p><NetRichText text={c.body} /></p>
                  <div className="net-vk-meta">
                    <time>{whenLabel(c.createdAt)}</time>
                    {openTheme.mine ? (
                      <button
                        type="button"
                        className="net-quiet net-comment-del"
                        onClick={() => {
                          if (window.confirm("Удалить комментарий?")) {
                            void act({ action: "delete-theme-comment", id: c.id });
                          }
                        }}
                      >
                        Удалить
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <CommentComposer
              value={themeDraft}
              busy={busy}
              onChange={setThemeDraft}
              onSend={() =>
                void act({ action: "comment-theme", themeId: openTheme.id, body: themeDraft }).then((ok) => {
                  if (ok) setThemeDraft("");
                })
              }
            />
          </div>
        </div>
      ) : null}

      {photo ? <PhotoLoupe src={photo} onClose={() => setPhoto(null)} /> : null}
    </main>
    </NetFrame>
  );
}
