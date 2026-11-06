"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  message: string;
  onClose: () => void;
};

/** Короткий ответ сайта вместо window.alert. */
export function SiteNoticeModal({ message, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="site-notice-modal">
      <button
        type="button"
        className="site-notice-backdrop"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        className="site-notice-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-notice-text"
      >
        <p id="site-notice-text">{message}</p>
        <button type="button" className="btn primary" autoFocus onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>,
    document.body
  );
}
