"use client";

import { useEffect, useRef, useState } from "react";
import { MailBody } from "@/components/MailBody";
import { MailTags } from "@/components/MailTags";
import {
  MAIL_SECTION_LINKS,
  MAIL_TAG_MAX,
  MAIL_TAG_PRESETS,
  MAIL_TAG_TONES,
  cleanMailTags,
  formatMailGoLink,
  formatMailTag,
  mailTagLabel,
  mailTagTone,
  type MailTagTone,
} from "@/lib/mailTags";

type Picked = { id: string; nick: string };
type Audience = "picked" | "clan" | "all";
type Kind = "developer" | "admin" | "hr" | "custom";

const KIND_LABEL: Record<Exclude<Kind, "custom">, string> = {
  developer: "Разработчик",
  admin: "Администрация",
  hr: "Отдел кадров",
};

export function AdminMailPanel() {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("developer");
  const [custom, setCustom] = useState("");
  const [audience, setAudience] = useState<Audience>("picked");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Picked[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagTone, setTagTone] = useState<MailTagTone>("blue");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (audience === "picked") {
      setAudienceCount(picked.length);
      return;
    }
    let stop = false;
    void fetch(`/api/admin/mail?audience=${audience}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!stop) setAudienceCount(typeof j.count === "number" ? j.count : 0);
      })
      .catch(() => {
        if (!stop) setAudienceCount(null);
      });
    return () => {
      stop = true;
    };
  }, [audience, picked.length]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    let stop = false;
    const t = window.setTimeout(() => {
      void fetch(`/api/admin/mail?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (stop) return;
          setFound(Array.isArray(j.users) ? j.users : []);
        })
        .catch(() => {
          if (!stop) setFound([]);
        });
    }, 200);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [query]);

  function addUser(user: Picked) {
    setPicked((prev) => (prev.some((p) => p.id === user.id) ? prev : [...prev, user]));
    setQuery("");
    setFound([]);
    setAsk(false);
    setSent(null);
  }

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body: text,
          senderKind: kind,
          senderLabel: custom,
          audience,
          userIds: picked.map((p) => p.id),
          tags,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Не отправилось");
      setSent(`Ушло ${json.sent} людям`);
      setTitle("");
      setText("");
      setPicked([]);
      setTags([]);
      setTagDraft("");
      setAsk(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не отправилось");
      setAsk(false);
    } finally {
      setBusy(false);
    }
  }

  const fromName =
    kind === "custom" ? custom.trim() || "…" : KIND_LABEL[kind];

  function toggleTag(tag: string) {
    setAsk(false);
    setSent(null);
    setTags((prev) => {
      const has = prev.some((item) => item.toLowerCase() === tag.toLowerCase());
      if (has) return prev.filter((item) => item.toLowerCase() !== tag.toLowerCase());
      return cleanMailTags([...prev, tag]);
    });
  }

  function addDraftTag() {
    const encoded = formatMailTag(tagDraft, tagTone);
    if (!encoded) return;
    const next = cleanMailTags([...tags, encoded]);
    setTags(next);
    setTagDraft("");
    setAsk(false);
    setSent(null);
  }

  function insertSection(path: string, label: string) {
    const chunk = formatMailGoLink(path, label);
    if (!chunk) return;
    setAsk(false);
    setSent(null);
    setText((prev) => {
      const gap = prev && !prev.endsWith("\n") ? "\n" : "";
      return `${prev}${gap}${chunk}\n`;
    });
  }

  function setTagColor(tag: string, tone: MailTagTone) {
    const label = mailTagLabel(tag);
    setTags((prev) =>
      cleanMailTags(
        prev.map((item) =>
          mailTagLabel(item).toLowerCase() === label.toLowerCase()
            ? formatMailTag(label, tone)
            : item
        )
      )
    );
    setAsk(false);
    setSent(null);
  }

  async function onImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setErr(null);
    setAsk(false);
    setSent(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/admin/mail/image", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error || "Картинка не залилась");
      const url = json.url;
      setText((prev) => {
        const gap = prev && !prev.endsWith("\n") ? "\n" : "";
        return `${prev}${gap}[[img:${url}]]\n`;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Картинка не залилась");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="card admin-mail">
      <h2 className="admin-mail-title">Письмо</h2>
      <p className="muted">
        Придёт в почту слева на профиле. Ссылки https:// и кнопки разделов открываются из письма.
        Картинка сядет в ширину окна. Удалённые лежат 30 дней, потом пропадают.
      </p>

      <label className="admin-mail-label">
        От кого
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as Kind);
            setAsk(false);
          }}
        >
          <option value="developer">Разработчик (красным)</option>
          <option value="admin">Администрация</option>
          <option value="hr">Отдел кадров</option>
          <option value="custom">Своё имя</option>
        </select>
      </label>
      {kind === "custom" ? (
        <label className="admin-mail-label">
          Подпись
          <input
            value={custom}
            maxLength={40}
            onChange={(e) => {
              setCustom(e.target.value);
              setAsk(false);
            }}
            placeholder="От кого письмо"
          />
        </label>
      ) : null}

      <label className="admin-mail-label">
        Тема
        <input
          value={title}
          maxLength={140}
          onChange={(e) => {
            setTitle(e.target.value);
            setAsk(false);
            setSent(null);
          }}
          placeholder="Название письма"
        />
      </label>

      <div className="admin-mail-label">
        Текст
        <textarea
          value={text}
          maxLength={20000}
          rows={10}
          onChange={(e) => {
            setText(e.target.value);
            setAsk(false);
            setSent(null);
          }}
          placeholder="Текст, https://ссылки или кнопки разделов ниже"
        />
        <div className="admin-mail-image-row">
          <button
            type="button"
            className="btn"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "Заливаю…" : "Вставить картинку"}
          </button>
          <span className="muted">PNG, JPG, WEBP, GIF до 8 МБ. Можно несколько.</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => void onImage(e.target.files?.[0])}
          />
        </div>
        <div className="admin-mail-sections">
          <span className="muted">Вставить раздел (кнопка в письме):</span>
          <div className="admin-mail-section-btns">
            {MAIL_SECTION_LINKS.map((s) => (
              <button
                key={s.path}
                type="button"
                className="admin-mail-section-btn"
                onClick={() => insertSection(s.path, s.label)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {/\[\[img:|\[\[go:|https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/i.test(text) ? (
          <div className="admin-mail-preview">
            <span className="muted">Как увидят в письме</span>
            <MailBody text={text} />
          </div>
        ) : null}
      </div>

      <div className="admin-mail-tags">
        <span className="admin-mail-label">Метки</span>
        <div className="admin-mail-tag-presets">
          {MAIL_TAG_PRESETS.map((tag) => {
            const on = tags.some((item) => item.toLowerCase() === tag.toLowerCase());
            return (
              <button
                key={tag}
                type="button"
                className={`mail-tag is-${mailTagTone(tag)}${on ? " is-picked" : ""}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
        <div className="admin-mail-tag-add">
          <input
            value={tagDraft}
            maxLength={22}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraftTag();
              }
            }}
            placeholder={tags.length >= MAIL_TAG_MAX ? "Уже три метки" : "Своя метка и Enter"}
            disabled={tags.length >= MAIL_TAG_MAX}
          />
          <div className="admin-mail-tone-row" role="group" aria-label="Цвет метки">
            {MAIL_TAG_TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                title={tone}
                className={`admin-mail-tone is-${tone}${tagTone === tone ? " is-on" : ""}`}
                onClick={() => setTagTone(tone)}
                disabled={tags.length >= MAIL_TAG_MAX}
              />
            ))}
          </div>
          <button type="button" className="btn" onClick={addDraftTag} disabled={!tagDraft.trim()}>
            Добавить
          </button>
        </div>
        {tags.length ? (
          <div className="admin-mail-tag-picked">
            {tags.map((tag) => (
              <span key={tag} className="admin-mail-tag-picked-row">
                <span className={`mail-tag is-${mailTagTone(tag)}`}>{mailTagLabel(tag)}</span>
                <span className="admin-mail-tone-row is-mini">
                  {MAIL_TAG_TONES.map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      title={tone}
                      className={`admin-mail-tone is-${tone}${
                        mailTagTone(tag) === tone ? " is-on" : ""
                      }`}
                      onClick={() => setTagColor(tag, tone)}
                    />
                  ))}
                </span>
              </span>
            ))}
            <button type="button" className="admin-mail-tag-clear" onClick={() => setTags([])}>
              убрать метки
            </button>
          </div>
        ) : null}
      </div>

      <fieldset className="admin-mail-audience">
        <legend>Кому</legend>
        <label>
          <input
            type="radio"
            checked={audience === "picked"}
            onChange={() => {
              setAudience("picked");
              setAsk(false);
            }}
          />
          выбранным
        </label>
        <label>
          <input
            type="radio"
            checked={audience === "clan"}
            onChange={() => {
              setAudience("clan");
              setAsk(false);
            }}
          />
          всему клану BB
        </label>
        <label>
          <input
            type="radio"
            checked={audience === "all"}
            onChange={() => {
              setAudience("all");
              setAsk(false);
            }}
          />
          всем на сайте
        </label>
      </fieldset>

      {audience === "picked" ? (
        <div className="admin-mail-pick">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ник, от 2 букв"
          />
          {found.length ? (
            <ul className="admin-mail-found">
              {found.map((user) => (
                <li key={user.id}>
                  <button type="button" onClick={() => addUser(user)}>
                    {user.nick}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="admin-mail-chips">
            {picked.map((user) => (
              <button
                key={user.id}
                type="button"
                className="admin-mail-chip"
                onClick={() => setPicked((prev) => prev.filter((p) => p.id !== user.id))}
              >
                {user.nick} ×
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <p className="admin-mail-preview">
        В профиле будет:{" "}
        <strong className={kind === "developer" ? "is-dev" : ""}>от {fromName}</strong>
        {" — "}
        {title.trim() || "без темы"}
        {audienceCount != null ? ` · ${audienceCount} адресатов` : ""}
        {tags.length ? (
          <>
            {" "}
            <MailTags tags={tags} />
          </>
        ) : null}
      </p>

      {err ? <p className="error">{err}</p> : null}
      {sent ? <p className="admin-mail-sent">{sent}</p> : null}

      {ask ? (
        <div className="admin-mail-ask">
          <span>
            Отправить «{title.trim()}» ({audienceCount ?? "?"} чел.)?
          </span>
          <button type="button" className="btn" disabled={busy} onClick={() => void send()}>
            Отправить
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setAsk(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={busy || title.trim().length < 2 || text.trim().length < 2}
          onClick={() => {
            setErr(null);
            setSent(null);
            if (audience === "picked" && !picked.length) {
              setErr("Выбери людей");
              return;
            }
            if (kind === "custom" && custom.trim().length < 2) {
              setErr("Укажи подпись");
              return;
            }
            setAsk(true);
          }}
        >
          К отправке
        </button>
      )}
    </section>
  );
}
