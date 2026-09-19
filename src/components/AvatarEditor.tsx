"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Props = {
  nick: string;
  name: string;
  initialAvatar: string | null;
  hasCustom: boolean;
};

export function AvatarEditor({ nick, name, initialAvatar, hasCustom }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { update } = useSession();
  const [preview, setPreview] = useState(initialAvatar);
  const [custom, setCustom] = useState(hasCustom);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function upload(file: File) {
    setError("");
    setLoading(true);
    try {
      const body = new FormData();
      body.set("avatar", file);
      const res = await fetch("/api/avatar", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось загрузить");
        return;
      }
      setPreview(data.avatarUrl);
      setCustom(true);
      await update({ avatarUrl: data.avatarUrl });
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function resetToSteam() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/avatar", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось сбросить");
        return;
      }
      setPreview(data.steamAvatar || null);
      setCustom(false);
      await update({ avatarUrl: null });
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="hero hero-profile">
      <div className="profile-avatar-wrap">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="profile-avatar" src={preview} alt="" width={112} height={112} />
        ) : (
          <div className="profile-avatar profile-avatar-fallback" aria-hidden>
            {(nick || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <div className="avatar-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={loading}
            onClick={() => inputRef.current?.click()}
          >
            {loading ? "…" : "Загрузить аватар"}
          </button>
          {custom ? (
            <button
              type="button"
              className="btn ghost"
              disabled={loading}
              onClick={() => void resetToSteam()}
            >
              С фото Steam
            </button>
          ) : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
        <p className="avatar-hint">jpg / png / webp, до 2 МБ</p>
      </div>
      <div>
        <p className="eyebrow">профиль</p>
        <h1>{nick}</h1>
        <p className="lead">{name}</p>
      </div>
    </section>
  );
}
