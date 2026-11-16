"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

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
 * Оверлей + панель, которую можно таскать за шапку (`.profile-match-modal-head`
 * или элемент с `data-drag-handle`).
 */
export function DraggableModal({
  open,
  onClose,
  closeOnBackdrop = true,
  className = "",
  panelClassName = "",
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    if (!open) setOffset({ x: 0, y: 0 });
  }, [open]);

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

  if (!open) return null;

  return (
    <div
      className={`profile-match-modal ${className}`.trim()}
      role="presentation"
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        ref={panelRef}
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
    </div>
  );
}
