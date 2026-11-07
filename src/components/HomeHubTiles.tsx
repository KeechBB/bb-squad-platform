"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import type { HomeHubTile } from "@/lib/homeHub";
import type { HubTileBox, HubTileLayout } from "@/lib/homeHubLayoutShared";

type Props = {
  tiles: HomeHubTile[];
  initialLayout: HubTileLayout;
  canEdit: boolean;
};

type FactionMenuItem = {
  id: string;
  name: string;
  slug: string;
  href: string;
  logoUrl: string | null;
  mine: boolean;
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
  const [factionOpen, setFactionOpen] = useState(false);
  const [factionRows, setFactionRows] = useState<FactionMenuItem[]>([]);
  const [factionLoading, setFactionLoading] = useState(false);
  const [factionError, setFactionError] = useState("");
  const gridRef = useRef<HTMLElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const loadFactions = useCallback(async () => {
    setFactionLoading(true);
    setFactionError("");
    try {
      const res = await fetch("/api/factions", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        factions?: FactionMenuItem[];
      };
      if (!res.ok) {
        setFactionError(data.error || "Список недоступен");
        setFactionRows([]);
        return;
      }
      setFactionRows(Array.isArray(data.factions) ? data.factions : []);
    } catch {
      setFactionError("Сеть недоступна");
      setFactionRows([]);
    } finally {
      setFactionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!factionOpen) return;
    void loadFactions();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      const root = gridRef.current?.querySelector(".home-hub-tile--my-faction");
      if (root && root.contains(t)) return;
      setFactionOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFactionOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [factionOpen, loadFactions]);

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
          const isFaction = tile.id === "my-faction";
          const className = `home-hub-tile home-hub-tile--${tile.id}${
            editing ? " is-editable" : ""
          }${dragging ? " is-dragging" : ""}${
            isFaction && factionOpen ? " is-menu-open" : ""
          }`;
          const art = (
            <>
              <span className="home-hub-tile-plate" aria-hidden="true" />
              <span
                className="home-hub-tile-art"
                aria-hidden="true"
                style={{ backgroundImage: `url(${tile.image}?v=drag1)` }}
              />
            </>
          );
          const dragHandlers = {
            onPointerDown: (e: ReactPointerEvent) => {
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
            },
            onWheel: (e: WheelEvent) => onWheelScale(tile.id, e),
          };

          if (isFaction && !editing) {
            return (
              <div
                key={tile.id}
                className={className}
                title={tile.title}
                aria-label={tile.title}
                aria-expanded={factionOpen}
                aria-haspopup="menu"
                role="button"
                tabIndex={0}
                style={boxStyle(box)}
                onClick={() => setFactionOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setFactionOpen((v) => !v);
                  }
                }}
              >
                {art}
                {factionOpen ? (
                  <div
                    className="home-hub-faction-menu"
                    role="menu"
                    aria-label="Фракции"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="home-hub-faction-menu-title">Фракции</p>
                    {factionLoading ? <p className="muted">Загружаю…</p> : null}
                    {factionError ? <p className="error">{factionError}</p> : null}
                    {!factionLoading && !factionError && factionRows.length === 0 ? (
                      <p className="muted">Пока нет фракций.</p>
                    ) : null}
                    <ul className="home-hub-faction-menu-list">
                      {factionRows.map((f) => (
                        <li key={f.id}>
                          <Link
                            href={f.href}
                            role="menuitem"
                            className={`home-hub-faction-menu-item${f.mine ? " is-mine" : ""}`}
                            onClick={() => setFactionOpen(false)}
                          >
                            {f.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={f.logoUrl} alt="" className="home-hub-faction-menu-logo" />
                            ) : (
                              <span className="home-hub-faction-menu-logo is-empty" aria-hidden="true" />
                            )}
                            <span className="home-hub-faction-menu-name">{f.name}</span>
                            {f.mine ? (
                              <span className="home-hub-faction-menu-mine">моя</span>
                            ) : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <Link
              key={tile.id}
              href={tile.href}
              className={className}
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
                  e.preventDefault();
                }
              }}
              {...dragHandlers}
            >
              {art}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
