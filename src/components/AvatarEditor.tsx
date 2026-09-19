"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Props = {
  nick: string;
  name: string;
  initialAvatar: string | null;
  steamAvatar: string | null;
};

type Phase = "idle" | "chooser" | "pending";

export function AvatarEditor({ nick, name, initialAvatar, steamAvatar }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { update } = useSession();
  const [saved, setSaved] = useState(initialAvatar);
  const [preview, setPreview] = useState(initialAvatar);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingSteam, setPendingSteam] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSaved(initialAvatar);
    if (phase === "idle") setPreview(initialAvatar);
  }, [initialAvatar, phase]);

  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  function openChooser() {
    setError("");
    setPendingFile(null);
    setPendingSteam(false);
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(null);
    setPreview(saved);
    setPhase("chooser");
  }

  function cancelEdit() {
    setError("");
    setPendingFile(null);
    setPendingSteam(false);
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(null);
    setPreview(saved);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function pickFile(file: File) {
    setError("");
    if (file.size > 20 * 1024 * 1024) {
      setError("Файл больше 20 МБ — сожми картинку");
      return;
    }
    if (localUrl) URL.revokeObjectURL(localUrl);
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    setPendingFile(file);
    setPendingSteam(false);
    setPreview(url);
    setPhase("pending");
  }

  function pickSteam() {
    setError("");
    if (!steamAvatar) {
      setError("У Steam нет фото");
      return;
    }
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(null);
    setPendingFile(null);
    setPendingSteam(true);
    setPreview(steamAvatar);
    setPhase("pending");
  }

  async function save() {
    setError("");
    setLoading(true);
    try {
      let nextUrl: string | null = saved;

      if (pendingFile) {
        const body = new FormData();
        body.set("avatar", pendingFile);
        const res = await fetch("/api/avatar", { method: "POST", body });
        const text = await res.text();
        let data: { error?: string; avatarUrl?: string } = {};
        try {
          data = JSON.parse(text) as typeof data;
        } catch {
          if (res.status === 413) {
            setError("Файл слишком большой для сервера (лимит nginx)");
            return;
          }
          setError(`Ошибка сервера (${res.status})`);
          return;
        }
        if (!res.ok) {
          setError(data.error || `Не удалось сохранить (${res.status})`);
          return;
        }
        nextUrl = data.avatarUrl || null;
      } else if (pendingSteam) {
        const res = await fetch("/api/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "steam" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Не удалось сохранить");
          return;
        }
        nextUrl = data.avatarUrl || null;
      } else {
        setPhase("idle");
        return;
      }

      setSaved(nextUrl);
      setPreview(nextUrl);
      setPendingFile(null);
      setPendingSteam(false);
      if (localUrl) URL.revokeObjectURL(localUrl);
      setLocalUrl(null);
      setPhase("idle");
      await update({ avatarUrl: nextUrl });
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="hero hero-profile">
      <div className="profile-head-row">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="profile-avatar" src={preview} alt="" width={176} height={176} />
        ) : (
          <div className="profile-avatar profile-avatar-fallback" aria-hidden>
            {(nick || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="profile-head-text">
          <p className="eyebrow">профиль</p>
          <h1>{nick}</h1>
          <p className="lead">{name}</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pickFile(file);
        }}
      />

      <div className="avatar-actions">
        {phase === "idle" ? (
          <button type="button" className="btn ghost" onClick={openChooser}>
            Загрузить аватар
          </button>
        ) : null}

        {phase === "chooser" ? (
          <>
            <button
              type="button"
              className="btn ghost"
              onClick={() => inputRef.current?.click()}
            >
              С компьютера
            </button>
            <button type="button" className="btn ghost" onClick={pickSteam}>
              С фото Steam
            </button>
            <button type="button" className="btn ghost" onClick={cancelEdit}>
              Отмена
            </button>
          </>
        ) : null}

        {phase === "pending" ? (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={loading}
              onClick={() => void save()}
            >
              {loading ? "…" : "Сохранить"}
            </button>
            <button type="button" className="btn ghost" disabled={loading} onClick={cancelEdit}>
              Отмена
            </button>
          </>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {phase !== "idle" ? (
        <p className="avatar-hint">jpg / png / webp, до 20 МБ</p>
      ) : null}
    </section>
  );
}
