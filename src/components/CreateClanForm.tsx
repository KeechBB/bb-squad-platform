"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function CreateClanForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body = new FormData();
      body.set("name", name);
      body.set("tag", tag);
      if (logo) body.set("logo", logo);
      const res = await fetch("/api/clans", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось создать");
        return;
      }
      router.push(`/clans/${data.clan.id}`);
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card form" onSubmit={onSubmit}>
      <label className="field">
        <span>Название</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          required
          placeholder="BlackBerry"
        />
      </label>
      <label className="field">
        <span>Тег (2–8, латиница)</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value.toUpperCase())}
          maxLength={8}
          pattern="[A-Za-z0-9]{2,8}"
          required
          placeholder="BB"
        />
      </label>
      <label className="field">
        <span>Логотип (png/webp, прозрачный фон)</span>
        <input
          type="file"
          accept="image/png,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setLogo(f);
            if (preview) URL.revokeObjectURL(preview);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
      </label>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="clan-logo-preview" src={preview} alt="" width={80} height={80} />
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="avatar-actions">
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? "…" : "Создать"}
        </button>
        <Link className="btn ghost" href="/clans">
          Отмена
        </Link>
      </div>
    </form>
  );
}
