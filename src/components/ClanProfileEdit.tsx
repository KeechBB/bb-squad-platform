"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  clanId: string;
  name: string;
  tag: string;
  logoUrl: string | null;
};

export function ClanProfileEdit({ clanId, name, tag, logoUrl }: Props) {
  const router = useRouter();
  const [editName, setEditName] = useState(name);
  const [editTag, setEditTag] = useState(tag);
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const shownLogo = removeLogo
    ? null
    : preview || logoUrl || null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body = new FormData();
      body.set("name", editName);
      body.set("tag", editTag);
      if (removeLogo) body.set("removeLogo", "1");
      else if (logo) body.set("logo", logo);
      const res = await fetch(`/api/clans/${clanId}/profile`, {
        method: "PUT",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось сохранить");
        return;
      }
      setLogo(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setRemoveLogo(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="clan-profile-edit">
      {!open ? (
        <button
          type="button"
          className="btn ghost"
          onClick={() => setOpen(true)}
        >
          Редактировать карточку
        </button>
      ) : (
        <form className="card form clan-profile-edit-form" onSubmit={onSubmit}>
          <p className="muted" style={{ marginTop: 0 }}>
            Название, тег и логотип клана
          </p>
          <label className="field">
            <span>Название</span>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={40}
              required
            />
          </label>
          <label className="field">
            <span>Тег (2–8, латиница)</span>
            <input
              value={editTag}
              onChange={(e) => setEditTag(e.target.value.toUpperCase())}
              maxLength={8}
              pattern="[A-Za-z0-9]{2,8}"
              required
            />
          </label>
          <label className="field">
            <span>Логотип (png/webp)</span>
            <input
              type="file"
              accept="image/png,image/webp"
              disabled={removeLogo}
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setLogo(f);
                setRemoveLogo(false);
                if (preview) URL.revokeObjectURL(preview);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          {shownLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="clan-logo-preview"
              src={shownLogo}
              alt=""
              width={80}
              height={80}
            />
          ) : (
            <p className="muted">Логотипа нет</p>
          )}
          <div className="avatar-actions">
            {(logoUrl || preview) && !removeLogo ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setRemoveLogo(true);
                  setLogo(null);
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(null);
                }}
              >
                Удалить лого
              </button>
            ) : null}
            {removeLogo ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setRemoveLogo(false)}
              >
                Отменить удаление лого
              </button>
            ) : null}
          </div>
          {error ? <p className="error">{error}</p> : null}
          <div className="avatar-actions">
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? "…" : "Сохранить"}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={loading}
              onClick={() => {
                setOpen(false);
                setEditName(name);
                setEditTag(tag);
                setLogo(null);
                setRemoveLogo(false);
                if (preview) URL.revokeObjectURL(preview);
                setPreview(null);
                setError("");
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
