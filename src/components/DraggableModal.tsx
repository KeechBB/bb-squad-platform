"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Не закрывать по клику на фон (если busy). */
  closeOnBackdrop?: boolean;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
};

/**
 * Оверлей поверх всего сайта (portal → body) + панель,
 * которую можно таскать за шапку (`.profile-match-modal-head` / `[data-drag-handle]`).
 */
export function DraggableModal({
  open,
  onClose,
  closeOnBackdrop = true,
  className = "",
  panelClassName = "",
  children,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) setOffset({ x: 0, y: 0 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setOffset({ x: drag.current.origX + dx, y: drag.current.origY + dy });
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  }, [onPointerMove]);

  const onHeadPointerDown = (e: ReactPointerEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest("button, a, input, select, textarea, label")) return;
    if (!t.closest("[data-drag-handle], .profile-match-modal-head")) return;
    e.preventDefault();
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={`profile-match-modal xfer-overlay ${className}`.trim()}
      role="presentation"
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        className={`profile-match-modal-panel xfer-modal is-draggable ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onHeadPointerDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
