"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  PROFILE_BG_IDS,
  normalizeProfileBg,
  profileBgUrl,
  type ProfileBgId,
} from "@/lib/profileBg";

type Props = {
  value: ProfileBgId | null;
  /** Живое превью на странице (пока модалка открыта) */
  onPreview: (bg: ProfileBgId | null) => void;
  /** После успешного сохранения */
  onSaved: (bg: ProfileBgId | null) => void;
};

export function ProfileBgPicker({ value, onPreview, onSaved }: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<ProfileBgId | null>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) setPick(value);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("profile-match-modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("profile-match-modal-open");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openModal() {
    setError("");
    setPick(value);
    onPreview(value);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError("");
    onPreview(value);
  }

  function select(bg: ProfileBgId | null) {
    setPick(bg);
    onPreview(bg);
  }

  async function confirm() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/profile/bg", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bg: pick }),
      });
      const data = (await res.json().catch(() => null)) as {
        bg?: unknown;
        error?: string;
      } | null;
      if (!res.ok) {
        setError("Не удалось сохранить фон");
        return;
      }
      const next = normalizeProfileBg(data?.bg);
      onSaved(next);
      setOpen(false);
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setSaving(false);
    }
  }

  const modal =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="profile-match-modal profile-bg-modal" role="presentation">
            <button
              type="button"
              className="profile-match-modal-backdrop"
              aria-label="Закрыть"
              onClick={close}
            />
            <div
              className="profile-match-modal-panel profile-bg-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <header className="profile-match-modal-head">
                <div>
                  <h2 id={titleId}>Фон профиля</h2>
                  <p className="profile-match-modal-sub">
                    Выбери вариант — сразу видно на странице. Подтверди, чтобы
                    сохранить.
                  </p>
                </div>
                <button
                  type="button"
                  className="profile-match-modal-close"
                  onClick={close}
                  aria-label="Закрыть"
                >
                  ×
                </button>
              </header>

              <div className="profile-bg-grid" role="listbox" aria-label="Варианты фона">
                <button
                  type="button"
                  role="option"
                  aria-selected={pick == null}
                  className={`profile-bg-tile is-none${
                    pick == null ? " is-selected" : ""
                  }`}
                  onClick={() => select(null)}
                >
                  <span className="profile-bg-tile-label">Без фона</span>
                  <span className="profile-bg-tile-hint">как сейчас</span>
                </button>
                {PROFILE_BG_IDS.map((id) => {
                  const url = profileBgUrl(id)!;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={pick === id}
                      className={`profile-bg-tile${
                        pick === id ? " is-selected" : ""
                      }`}
                      style={{ backgroundImage: `url(${url})` }}
                      onClick={() => select(id)}
                    >
                      <span className="profile-bg-tile-label">Вариант {id}</span>
                    </button>
                  );
                })}
              </div>

              {error ? <p className="error profile-bg-error">{error}</p> : null}

              <footer className="profile-bg-actions">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={saving}
                  onClick={close}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={saving}
                  onClick={() => void confirm()}
                >
                  {saving ? "…" : "Подтвердить"}
                </button>
              </footer>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="btn ghost profile-bg-trigger"
        onClick={openModal}
      >
        Сменить фон профиля
      </button>
      {modal}
    </>
  );
}
