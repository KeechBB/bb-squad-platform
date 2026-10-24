"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ProfileV2ScaleStage } from "@/components/ProfileV2ScaleStage";
import { NetEmojiBar, NetEmojiToggle, NetRichText } from "@/components/NetEmoji";
import { netVisibleLength } from "@/lib/netEmoji";
import type { NetChatLine, NetNewsCard, NetPageData, NetPerson, NetThemeCard } from "@/lib/netTypes";

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
    };
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
    setOnline((json.online || []).map((p: NetPerson) => p.nick));
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
        Чат <span className="net-chat-count">{online.length} онлайн</span>
      </h2>
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
          <p key={m.id} className="net-chat-line">
            <Link href={`/profile/web/${encodeURIComponent(m.nick)}`}>{m.nick}</Link>
            <span>
              <NetRichText text={m.body} />
            </span>
          </p>
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

function people(list: NetPerson[]) {
  if (!list.length) return <p className="net-empty">Пока никого</p>;
  return list.map((p) => (
    <Link key={p.nick} className="net-person" href={`/profile/web/${encodeURIComponent(p.nick)}`}>
      {p.nick}
    </Link>
  ));
}

export function NetPageClient({ nick }: { nick: string }) {
  const [data, setData] = useState<NetPageData | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openTheme, setOpenTheme] = useState<NetThemeCard | null>(null);
  const [openNews, setOpenNews] = useState<NetNewsCard | null>(null);
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [bgId, setBgId] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [postBody, setPostBody] = useState("");
  const [postFile, setPostFile] = useState<File | null>(null);
  const [newsTitle, setNewsTitle] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [themeDraft, setThemeDraft] = useState("");
  const [picker, setPicker] = useState(false);

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
      setFormError(json.error || "Не загрузилось");
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

      <section className="net-panel net-panel-ctrl" aria-label="Пульт">
        <Link className="net-back" href="/profile">
          ← профиль
        </Link>
        <h2>Сеть · {data.nick}</h2>
        <div className="net-ctrl-list">
          {data.isOwn ? (
            <>
              <button type="button" onClick={() => setModal("avatar")}>Аватар</button>
              <button type="button" onClick={() => { setTitle(""); setBody(""); setImages([]); setModal("theme"); }}>
                Создание темы
              </button>
              <button type="button" onClick={() => { setBgId(data.bgId); setModal("bg"); }}>Фон</button>
              <button type="button" onClick={() => { setStatus(data.status); setModal("status"); }}>Статус</button>
            </>
          ) : null}
          <button type="button" onClick={() => setModal("subs")}>Мои подписки</button>
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
              >
                Лайк {theme.likes}
              </button>
              <button
                type="button"
                className={`net-vote${theme.myVote === -1 ? " is-on" : ""}`}
                onClick={() => void act({ action: "vote", id: theme.id, value: theme.myVote === -1 ? 0 : -1 })}
              >
                Дизлайк {theme.dislikes}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="net-panel net-popular" aria-label="Популярные темы">
        <h2>Популярные темы</h2>
        <div className="net-scroll">
          {data.popular.length === 0 ? <p className="net-empty">Пока тихо</p> : null}
          {data.popular.map((theme) => (
            <div className="net-pop-row" key={theme.id}>
              <button type="button" className="net-pop-title" onClick={() => { setThemeDraft(""); setOpenTheme(theme); }}>
                {theme.title}
                <small style={{ display: "block", opacity: 0.6 }}>{theme.authorNick}</small>
              </button>
              <span className="net-like">Лайк {theme.likes}</span>
              <span className="net-vote">Дизлайк {theme.dislikes}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="net-panel net-subs" aria-label="Подписчики">
        <h2>Подписчики</h2>
        <div className="net-scroll">{people(data.followers)}</div>
      </section>

      <NetFlood />

      <section className="net-panel net-feed" aria-label="Лента">
        <h2>Лента</h2>
        <div className="net-feed-scroll">
          {data.posts.length === 0 ? <p className="net-empty">Постов ещё нет</p> : null}
          {data.posts.map((post) => (
            <article className="net-post" key={post.id}>
              <div className="net-post-body">
                {post.body ? <NetRichText text={post.body} /> : null}
              </div>
              {post.imageUrl ? <img src={post.imageUrl} alt="" /> : null}
              {post.gifUrl ? <img src={post.gifUrl} alt="" /> : null}
              {post.videoUrl ? <video src={post.videoUrl} controls /> : null}
              <div className="net-vk-bar">
                <button
                  type="button"
                  className={`net-like${post.liked ? " is-on" : ""}`}
                  onClick={() => void act({ action: "like", id: post.id })}
                >
                  Лайк {post.likes}
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
                    <time>{whenLabel(c.createdAt)}</time>
                  </div>
                ))}
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
              </div>
            </article>
          ))}
        </div>
        {data.isOwn ? (
          <button type="button" className="net-create" onClick={() => { setPostBody(""); setPostFile(null); setModal("post"); }}>
            Создать пост
          </button>
        ) : null}
      </section>

      <section className="net-panel net-news" aria-label="Новости">
        <h2>Новости</h2>
        <div className="net-scroll">
          {data.canNews ? (
            <button type="button" className="net-create" onClick={() => setModal("news")}>
              Новая новость
            </button>
          ) : null}
          {data.news.length === 0 ? <p className="net-empty">За неделю новостей нет</p> : null}
          {data.news.map((item) => (
            <button key={item.id} type="button" className="net-news-item" onClick={() => setOpenNews(item)}>
              {item.title}
              <small>{item.authorNick}</small>
            </button>
          ))}
        </div>
      </section>

      {modal ? (
        <div className="net-modal-back" onMouseDown={closeModal}>
          <div className="net-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog">
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
                  <p className="net-empty">{netVisibleLength(status)} / 20</p>
                  <NetEmojiToggle open={picker} onToggle={() => setPicker((v) => !v)} />
                </div>
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                  <button
                    type="button"
                    className="net-sub-btn"
                    disabled={busy || netVisibleLength(status) > 20}
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
                <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Текст" />
                {picker ? <NetEmojiBar onPick={(token) => pickEmoji(token, body, setBody)} /> : null}
                <div className="net-compose-row">
                  <span className="net-empty">Смайлы в текст</span>
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
                    disabled={busy || [...title].length > 30}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("kind", "theme");
                      fd.set("title", title);
                      fd.set("body", body);
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
                <textarea value={postBody} onChange={(e) => setPostBody(e.target.value)} placeholder="Текст" />
                {picker ? <NetEmojiBar onPick={(token) => pickEmoji(token, postBody, setPostBody)} /> : null}
                <div className="net-compose-row">
                  <span className="net-empty">Смайлы в текст</span>
                  <NetEmojiToggle open={picker} onToggle={() => setPicker((v) => !v)} />
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                  onChange={(e) => setPostFile(e.target.files?.[0] || null)}
                />
                <div className="net-modal-actions">
                  <button type="button" className="net-quiet" onClick={closeModal}>Закрыть</button>
                  <button
                    type="button"
                    className="net-sub-btn"
                    disabled={busy}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("kind", "post");
                      fd.set("body", postBody);
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
                <button type="button" className="net-quiet" onClick={() => setOpenTheme(null)}>Закрыть</button>
              </div>
              <Link href={`/profile/web/${encodeURIComponent(openTheme.authorNick)}`}>{openTheme.authorNick}</Link>
              <div className="net-post-body"><NetRichText text={openTheme.body} /></div>
              {openTheme.imageUrls.map((url) => (
                <img key={url} src={url} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />
              ))}
              <div className="net-row-actions">
                <button type="button" className={`net-like${openTheme.myVote === 1 ? " is-on" : ""}`} onClick={() => void act({ action: "vote", id: openTheme.id, value: openTheme.myVote === 1 ? 0 : 1 })}>
                  Лайк {openTheme.likes}
                </button>
                <button type="button" className={`net-vote${openTheme.myVote === -1 ? " is-on" : ""}`} onClick={() => void act({ action: "vote", id: openTheme.id, value: openTheme.myVote === -1 ? 0 : -1 })}>
                  Дизлайк {openTheme.dislikes}
                </button>
                {data.isOwn && data.nick === openTheme.authorNick ? (
                  <button type="button" className="net-quiet" onClick={() => void act({ action: "delete-theme", id: openTheme.id }).then((ok) => { if (ok) setOpenTheme(null); })}>
                    удалить
                  </button>
                ) : null}
              </div>
            </div>
            <div className="net-theme-comments">
              {openTheme.comments.length === 0 ? <p className="net-empty">Комментариев пока нет</p> : null}
              {openTheme.comments.map((c) => (
                <div className="net-vk-comment" key={c.id}>
                  <Link href={`/profile/web/${encodeURIComponent(c.nick)}`}>{c.nick}</Link>
                  <p><NetRichText text={c.body} /></p>
                  <time>{whenLabel(c.createdAt)}</time>
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

      {openNews ? (
        <div className="net-modal-back" onMouseDown={() => setOpenNews(null)}>
          <div className="net-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog">
            <h3>{openNews.title}</h3>
            <p className="net-empty">{openNews.authorNick}</p>
            <div className="net-post-body" style={{ whiteSpace: "pre-wrap" }}>{openNews.body}</div>
            <div className="net-modal-actions">
              <button type="button" className="net-quiet" onClick={() => setOpenNews(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
    </NetFrame>
  );
}
