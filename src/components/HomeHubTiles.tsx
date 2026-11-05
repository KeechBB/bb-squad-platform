"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent,
} from "react";
import type { HomeHubTile } from "@/lib/homeHub";
import type { HubTileBox, HubTileLayout } from "@/lib/homeHubLayoutShared";

type Props = {
  tiles: HomeHubTile[];
  initialLayout: HubTileLayout;
  canEdit: boolean;
};

type DragState = {
  id: string;
  mode: "move" | "scale";
  startX: number;
  startY: number;
  orig: HubTileBox;
  moved: boolean;
};

function boxStyle(box: HubTileBox): CSSProperties {
  return {
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
  };
}

export function HomeHubTiles({ tiles, initialLayout, canEdit }: Props) {
  const [layout, setLayout] = useState<HubTileLayout>(initialLayout);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const gridRef = useRef<HTMLElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const editing = canEdit && !layout.locked;

  const persist = useCallback(async (next: HubTileLayout) => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/home-hub-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiles: next.tiles, previews: next.previews }),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      const saved = (await res.json()) as HubTileLayout;
      setLayout(saved);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const scheduleSave = useCallback(
    (next: HubTileLayout) => {
      if (!editing) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(next);
      }, 350);
    },
    [editing, persist]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const grid = gridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dxPct = ((e.clientX - drag.startX) / rect.width) * 100;
      const dyPct = ((e.clientY - drag.startY) / rect.height) * 100;
      const moved =
        Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4;

      setLayout((prev) => {
        const orig = drag.orig;
        let nextBox: HubTileBox;
        if (drag.mode === "scale") {
          const width = Math.min(28, Math.max(4.5, orig.width + dxPct));
          const aspect = orig.height / Math.max(orig.width, 0.01);
          const height = Math.min(40, Math.max(7, width * aspect));
          nextBox = { left: orig.left, top: orig.top, width, height };
        } else {
          nextBox = {
            left: Math.min(100 - orig.width, Math.max(0, orig.left + dxPct)),
            top: Math.min(100 - orig.height, Math.max(0, orig.top + dyPct)),
            width: orig.width,
            height: orig.height,
          };
        }
        return { ...prev, tiles: { ...prev.tiles, [drag.id]: nextBox } };
      });

      if (moved && !drag.moved) {
        setDrag((d) => (d ? { ...d, moved: true } : d));
      }
    };

    const onUp = () => {
      setDrag((d) => {
        if (d?.moved) suppressClick.current = true;
        scheduleSave(layoutRef.current);
        return null;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, scheduleSave]);

  const onWheelScale = useCallback(
    (id: string, e: WheelEvent) => {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
      setLayout((prev) => {
        const box = prev.tiles[id];
        if (!box) return prev;
        const factor = e.deltaY > 0 ? 0.96 : 1.04;
        const width = Math.min(28, Math.max(4.5, box.width * factor));
        const aspect = box.height / Math.max(box.width, 0.01);
        const height = Math.min(40, Math.max(7, width * aspect));
        const next = {
          ...prev,
          tiles: { ...prev.tiles, [id]: { ...box, width, height } },
        };
        scheduleSave(next);
        return next;
      });
    },
    [editing, scheduleSave]
  );

  const hint = useMemo(() => {
    if (!editing) return null;
    if (saveState === "saving") return "сохраняю…";
    if (saveState === "error") return "ошибка сохранения";
    if (saveState === "saved") return "сохранено · тяни · колесо = размер";
    return "режим расстановки · тяни · колесо = размер";
  }, [editing, saveState]);

  return (
    <>
      {hint ? <div className="home-hub-edit-hint">{hint}</div> : null}
      <nav
        className={`home-hub-grid${editing ? " is-editing" : ""}`}
        aria-label="Быстрые разделы"
        ref={gridRef}
      >
        {tiles.map((tile) => {
          const box = layout.tiles[tile.id];
          if (!box) return null;
          const dragging = drag?.id === tile.id;
          return (
            <Link
              key={tile.id}
              href={tile.href}
              className={`home-hub-tile home-hub-tile--${tile.id}${
                editing ? " is-editable" : ""
              }${dragging ? " is-dragging" : ""}`}
              title={tile.title}
              aria-label={tile.title}
              style={boxStyle(box)}
              draggable={false}
              onClick={(e) => {
                if (editing) {
                  if (suppressClick.current) {
                    e.preventDefault();
                    suppressClick.current = false;
                    return;
                  }
                  // в режиме расстановки клик не уводит со страницы
                  e.preventDefault();
                }
              }}
              onPointerDown={(e) => {
                if (!editing || e.button !== 0) return;
                e.preventDefault();
                setDrag({
                  id: tile.id,
                  mode: e.altKey ? "scale" : "move",
                  startX: e.clientX,
                  startY: e.clientY,
                  orig: { ...box },
                  moved: false,
                });
              }}
              onWheel={(e) => onWheelScale(tile.id, e)}
            >
              <span className="home-hub-tile-plate" aria-hidden="true" />
              <span
                className="home-hub-tile-art"
                aria-hidden="true"
                style={{ backgroundImage: `url(${tile.image}?v=drag1)` }}
              />
            </Link>
          );
        })}
      </nav>
    </>
  );
}
