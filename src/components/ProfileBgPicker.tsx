"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  normalizeProfileBg,
  profileBgUrl,
  type ProfileBgChoice,
  type ProfileBgId,
} from "@/lib/profileBg";
import {
  normalizeProfilePatch,
  profilePatchUrl,
  type ProfilePatchChoice,
  type ProfilePatchId,
} from "@/lib/profilePatches";
import {
  normalizeProfileNickStyle,
  profileNickStyleCssClass,
  type ProfileNickStyleChoice,
  type ProfileNickStyleId,
} from "@/lib/profileNickStyles";

type Tab = "patches" | "nick" | "bg";

type Props = {
  options: ProfileBgChoice[];
  patchOptions?: ProfilePatchChoice[];
  nickStyleOptions?: ProfileNickStyleChoice[];
  value: ProfileBgId | null;
  patchValue?: ProfilePatchId | null;
  nickStyleValue?: ProfileNickStyleId | null;
  /** Живое превью фона на странице (пока модалка открыта) */
  onPreview: (bg: ProfileBgId | null) => void;
  /** После успешного сохранения */
  onSaved: (bg: ProfileBgId | null) => void;
  onPatchSaved?: (patch: ProfilePatchId | null) => void;
  onNickStyleSaved?: (style: ProfileNickStyleId | null) => void;
};

export function ProfileBgPicker({
  options,
  patchOptions = [],
  nickStyleOptions = [],
  value,
  patchValue = null,
  nickStyleValue = null,
  onPreview,
  onSaved,
  onPatchSaved,
  onNickStyleSaved,
}: Props) {
  const titleId = useId();
  const tiles = Array.isArray(options) ? options : [];
  const patches = Array.isArray(patchOptions) ? patchOptions : [];
  const nickStyles = Array.isArray(nickStyleOptions) ? nickStyleOptions : [];
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("patches");
  const [pick, setPick] = useState<ProfileBgId | null>(value);
  const [patchPick, setPatchPick] = useState<ProfilePatchId | null>(patchValue);
  const [nickStylePick, setNickStylePick] =
    useState<ProfileNickStyleId | null>(nickStyleValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setPick(value);
      setPatchPick(patchValue);
      setNickStylePick(nickStyleValue);
    }
  }, [value, patchValue, nickStyleValue, open]);

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
    setPatchPick(patchValue);
    setNickStylePick(nickStyleValue);
    setTab("patches");
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
        body: JSON.stringify({
          bg: pick,
          nickPatch: patchPick,
          nickStyle: nickStylePick,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        bg?: unknown;
        nickPatch?: unknown;
        nickStyle?: unknown;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(
          data?.error === "locked"
            ? "Эта опция ещё закрыта"
            : "Не удалось сохранить"
        );
        return;
      }
      const nextBg = normalizeProfileBg(data?.bg);
      const nextPatch = normalizeProfilePatch(data?.nickPatch);
      const nextNickStyle = normalizeProfileNickStyle(data?.nickStyle);
      onSaved(nextBg);
      onPatchSaved?.(nextPatch);
      onNickStyleSaved?.(nextNickStyle);
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
          <div
            className="profile-match-modal profile-bg-modal"
            role="presentation"
          >
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
                  <h2 id={titleId}>Кастомизация профиля</h2>
                  <p className="profile-match-modal-sub">
                    Ник и нашивки — во всех рейтингах. Фон — на странице профиля.
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

              <div className="profile-customize-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "patches"}
                  className={`profile-customize-tab${
                    tab === "patches" ? " is-active" : ""
                  }`}
                  onClick={() => setTab("patches")}
                >
                  Нашивки
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "nick"}
                  className={`profile-customize-tab${
                    tab === "nick" ? " is-active" : ""
                  }`}
                  onClick={() => setTab("nick")}
                >
                  Стиль ника
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "bg"}
                  className={`profile-customize-tab${
                    tab === "bg" ? " is-active" : ""
                  }`}
                  onClick={() => setTab("bg")}
                >
                  Фон
                </button>
              </div>

              {tab === "patches" ? (
                <div
                  className="profile-bg-grid profile-patch-grid"
                  role="listbox"
                  aria-label="Нашивки"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={patchPick == null}
                    className={`profile-bg-tile is-none${
                      patchPick == null ? " is-selected" : ""
                    }`}
                    onClick={() => setPatchPick(null)}
                  >
                    <span className="profile-bg-tile-label">Без нашивки</span>
                    <span className="profile-bg-tile-hint">скрыть</span>
                  </button>
                  {patches.length === 0 ? (
                    <div className="profile-patch-empty" role="status">
                      Пока нет открытых нашивок.
                      <span>Награда Battle Pass · ур. 15</span>
                    </div>
                  ) : (
                    patches.map((opt) => {
                      const url = profilePatchUrl(opt.id);
                      if (!url) return null;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="option"
                          aria-selected={patchPick === opt.id}
                          className={`profile-bg-tile profile-patch-tile${
                            patchPick === opt.id ? " is-selected" : ""
                          }`}
                          data-patch-id={opt.id}
                          title={opt.tip}
                          onClick={() => setPatchPick(opt.id)}
                        >
                          <span
                            className="profile-patch-tile-art"
                            style={{ backgroundImage: `url(${url})` }}
                            aria-hidden
                          />
                          <span className="profile-bg-tile-label">
                            {opt.label}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : tab === "nick" ? (
                <div
                  className="profile-bg-grid profile-nick-style-grid"
                  role="listbox"
                  aria-label="Стиль ника"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={nickStylePick == null}
                    className={`profile-bg-tile profile-nick-style-tile is-none${
                      nickStylePick == null ? " is-selected" : ""
                    }`}
                    onClick={() => setNickStylePick(null)}
                  >
                    <span className="profile-bg-tile-label">Обычный ник</span>
                    <span className="profile-bg-tile-hint">без оформления</span>
                  </button>
                  {nickStyles.length === 0 ? (
                    <div className="profile-patch-empty" role="status">
                      Пока нет открытых стилей ника.
                      <span>Награда Battle Pass · ур. 10</span>
                    </div>
                  ) : (
                    nickStyles.map((option) => {
                      const cssClass = profileNickStyleCssClass(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="option"
                          aria-selected={nickStylePick === option.id}
                          className={`profile-bg-tile profile-nick-style-tile${
                            nickStylePick === option.id ? " is-selected" : ""
                          }`}
                          data-nick-style={option.id}
                          title={option.tip}
                          onClick={() => setNickStylePick(option.id)}
                        >
                          <span
                            className={`public-rating-nick-label profile-nick-style-sample${
                              cssClass ? ` ${cssClass}` : ""
                            }`}
                            data-text="Keech"
                          >
                            Keech
                          </span>
                          <span className="profile-bg-tile-label">
                            {option.label}
                          </span>
                          <span className="profile-bg-tile-hint">
                            Battle Pass · уровень 10
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : (
                <div
                  className="profile-bg-grid"
                  role="listbox"
                  aria-label="Варианты фона"
                >
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
                  {tiles.map((opt) => {
                    const url = profileBgUrl(opt.id);
                    if (!url) return null;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="option"
                        aria-selected={pick === opt.id}
                        className={`profile-bg-tile${
                          pick === opt.id ? " is-selected" : ""
                        }`}
                        style={{ backgroundImage: `url(${url})` }}
                        onClick={() => select(opt.id)}
                      >
                        <span className="profile-bg-tile-label">
                          {opt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

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
        className="btn ghost profile-bg-trigger profile-customize-trigger"
        onClick={openModal}
      >
        Кастомизация профиля
      </button>
      {modal}
    </>
  );
}
