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
import {
  MEDAL_SHELF_SLOTS,
  normalizeMedalShelfIds,
  type ProfileMedalItem,
} from "@/lib/profileMedals";

type Tab = "awards" | "patches" | "nick" | "bg";

type Props = {
  options: ProfileBgChoice[];
  patchOptions?: ProfilePatchChoice[];
  nickStyleOptions?: ProfileNickStyleChoice[];
  medalInventory?: ProfileMedalItem[];
  medalShelfIds?: string[];
  value: ProfileBgId | null;
  patchValue?: ProfilePatchId | null;
  nickStyleValue?: ProfileNickStyleId | null;
  /** Живое превью фона на странице (пока модалка открыта) */
  onPreview: (bg: ProfileBgId | null) => void;
  /** После успешного сохранения */
  onSaved: (bg: ProfileBgId | null) => void;
  onPatchSaved?: (patch: ProfilePatchId | null) => void;
  onNickStyleSaved?: (style: ProfileNickStyleId | null) => void;
  onMedalShelfSaved?: (ids: string[]) => void;
};

export function ProfileBgPicker({
  options,
  patchOptions = [],
  nickStyleOptions = [],
  medalInventory = [],
  medalShelfIds = [],
  value,
  patchValue = null,
  nickStyleValue = null,
  onPreview,
  onSaved,
  onPatchSaved,
  onNickStyleSaved,
  onMedalShelfSaved,
}: Props) {
  const titleId = useId();
  const tiles = Array.isArray(options) ? options : [];
  const patches = Array.isArray(patchOptions) ? patchOptions : [];
  const nickStyles = Array.isArray(nickStyleOptions) ? nickStyleOptions : [];
  const inventory = Array.isArray(medalInventory) ? medalInventory : [];
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("awards");
  const [pick, setPick] = useState<ProfileBgId | null>(value);
  const [patchPick, setPatchPick] = useState<ProfilePatchId | null>(patchValue);
  const [nickStylePick, setNickStylePick] =
    useState<ProfileNickStyleId | null>(nickStyleValue);
  function padShelf(ids: unknown): string[] {
    const owned = new Set(inventory.map((m) => m.id));
    const n = normalizeMedalShelfIds(ids, owned);
    return Array.from(
      { length: MEDAL_SHELF_SLOTS },
      (_, i) => n[i] || ""
    );
  }

  const [shelfPick, setShelfPick] = useState<string[]>(() =>
    padShelf(medalShelfIds)
  );
  const [activeSlot, setActiveSlot] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setPick(value);
      setPatchPick(patchValue);
      setNickStylePick(nickStyleValue);
      setShelfPick(padShelf(medalShelfIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, patchValue, nickStyleValue, medalShelfIds, medalInventory, open]);

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
    setShelfPick(padShelf(medalShelfIds));
    setActiveSlot(0);
    setTab("awards");
    onPreview(value);
    setOpen(true);
  }

  function placeMedal(id: string) {
    setShelfPick((prev) => {
      const owned = new Set(inventory.map((m) => m.id));
      if (!owned.has(id)) return prev;
      const next = Array.from(
        { length: MEDAL_SHELF_SLOTS },
        (_, i) => prev[i] || ""
      );
      for (let i = 0; i < next.length; i++) {
        if (next[i] === id) next[i] = "";
      }
      const i = Math.min(Math.max(0, activeSlot), MEDAL_SHELF_SLOTS - 1);
      next[i] = id;
      return next;
    });
  }

  function clearSlot(i: number) {
    setShelfPick((prev) => {
      const next = Array.from(
        { length: MEDAL_SHELF_SLOTS },
        (_, j) => prev[j] || ""
      );
      if (i >= 0 && i < next.length) next[i] = "";
      return next;
    });
    setActiveSlot(i);
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
          medalShelfIds: shelfPick.filter(Boolean),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        bg?: unknown;
        nickPatch?: unknown;
        nickStyle?: unknown;
        medalShelfIds?: unknown;
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
      const nextShelf = padShelf(data?.medalShelfIds ?? shelfPick).filter(
        Boolean
      );
      onSaved(nextBg);
      onPatchSaved?.(nextPatch);
      onNickStyleSaved?.(nextNickStyle);
      onMedalShelfSaved?.(nextShelf);
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
                    Награды на полке · нашивки и стиль ника в рейтингах · фон на
                    профиле.
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
                  aria-selected={tab === "awards"}
                  className={`profile-customize-tab${
                    tab === "awards" ? " is-active" : ""
                  }`}
                  onClick={() => setTab("awards")}
                >
                  Награды
                </button>
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

              {tab === "awards" ? (
                <div className="profile-award-customize" aria-label="Полка наград">
                  <p className="profile-award-hint muted">
                    Выбери слот, затем награду из инвентаря — на полке до{" "}
                    {MEDAL_SHELF_SLOTS} мест.
                  </p>
                  <div className="profile-award-slots" role="list">
                    {Array.from({ length: MEDAL_SHELF_SLOTS }, (_, i) => {
                      const id = shelfPick[i] || "";
                      const item = inventory.find((m) => m.id === id) || null;
                      return (
                        <div
                          key={`slot-${i}`}
                          className={`profile-award-slot${
                            activeSlot === i ? " is-active" : ""
                          }${item ? "" : " is-empty"}`}
                          role="listitem"
                        >
                          <button
                            type="button"
                            className="profile-award-slot-btn"
                            aria-label={
                              item
                                ? `Слот ${i + 1}: ${item.name}`
                                : `Пустой слот ${i + 1}`
                            }
                            aria-pressed={activeSlot === i}
                            onClick={() => setActiveSlot(i)}
                          >
                            {item ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.icon} alt="" />
                            ) : (
                              <span>{i + 1}</span>
                            )}
                          </button>
                          {item ? (
                            <button
                              type="button"
                              className="profile-award-slot-clear"
                              aria-label="Убрать"
                              onClick={() => clearSlot(i)}
                            >
                              ×
                            </button>
                          ) : null}
                          <span className="profile-award-slot-name">
                            {item ? item.short : "пусто"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {inventory.length === 0 ? (
                    <div className="profile-patch-empty" role="status">
                      Пока нет открытых наград.
                      <span>Регистрация и Battle Pass</span>
                    </div>
                  ) : (
                    <div
                      className="profile-bg-grid profile-award-inventory"
                      role="listbox"
                      aria-label="Инвентарь наград"
                    >
                      {inventory.map((opt) => {
                        const onShelf = shelfPick.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="option"
                            aria-selected={onShelf}
                            className={`profile-bg-tile profile-award-tile${
                              onShelf ? " is-selected" : ""
                            }`}
                            title={opt.hover}
                            onClick={() => placeMedal(opt.id)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              className="profile-award-tile-art"
                              src={opt.icon}
                              alt=""
                            />
                            <span className="profile-bg-tile-label">
                              {opt.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : tab === "patches" ? (
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
