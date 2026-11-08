"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
} from "react";
import { isMobileLayout } from "@/lib/mobileLayout";
import { HomeCwAnnounce, type HomeCwCard } from "@/components/HomeCwAnnounce";
import {
  HOME_HUB_PREVIEW_IDS,
  type HubPreviewId,
  type HubTileBox,
  type HubTileLayout,
} from "@/lib/homeHubLayoutShared";

type Props = {
  showCw: boolean;
  cwCards: HomeCwCard[];
  canEdit: boolean;
  initialLayout: HubTileLayout;
};

type DragState = {
  id: HubPreviewId;
  mode: "move" | "scale";
  startX: number;
  startY: number;
  orig: HubTileBox;
  moved: boolean;
};

const STUB_TITLES: Record<HubPreviewId, string> = {
  junior: "КВ Junior",
  main: "КВ основа",
  clan: "КВ весь клан",
};

function boxStyle(box: HubTileBox): CSSProperties {
  return {
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    /* высота по контенту — иначе пустота под «в разработке» */
    height: "auto",
  };
}

function StubCard({ title }: { title: string }) {
  return (
    <section className="home-hub-cw-stub">
      <p className="home-hub-cw-stub-title">{title}</p>
      <p className="home-hub-cw-stub-meta">дата · время</p>
      <p className="home-hub-cw-stub-meta">против кого · карта</p>
      <div className="home-hub-cw-stub-actions">
        <button type="button" className="home-hub-cw-stub-btn" disabled>
          кто в составе
        </button>
        <button type="button" className="home-hub-cw-stub-btn" disabled>
          буду на КВ
        </button>
        <button type="button" className="home-hub-cw-stub-btn" disabled>
          прогноз
        </button>
      </div>
      <p className="home-hub-cw-stub-dev">заглушка «в разработке»</p>
    </section>
  );
}

export function HomeHubCwDock({
  showCw,
  cwCards,
  canEdit,
  initialLayout,
}: Props) {
  const [layout, setLayout] = useState<HubTileLayout>(initialLayout);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const hostRef = useRef<HTMLElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const editing = canEdit && !layout.locked;

  const persist = useCallback(async (next: HubTileLayout) => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/home-hub-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previews: next.previews }),
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
      if (!editing || isMobileLayout()) return;
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
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dxPct = ((e.clientX - drag.startX) / rect.width) * 100;
      const dyPct = ((e.clientY - drag.startY) / rect.height) * 100;
      const moved =
        Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4;

      setLayout((prev) => {
        const orig = drag.orig;
        let nextBox: HubTileBox;
        if (drag.mode === "scale") {
          const width = Math.min(22, Math.max(6, orig.width + dxPct));
          const aspect = orig.height / Math.max(orig.width, 0.01);
          const height = Math.min(48, Math.max(10, width * aspect));
          nextBox = { left: orig.left, top: orig.top, width, height };
        } else {
          nextBox = {
            left: Math.min(100 - orig.width, Math.max(0, orig.left + dxPct)),
            top: Math.min(100 - orig.height, Math.max(0, orig.top + dyPct)),
            width: orig.width,
            height: orig.height,
          };
        }
        return {
          ...prev,
          previews: { ...prev.previews, [drag.id]: nextBox },
        };
      });

      if (moved && !drag.moved) {
        setDrag((d) => (d ? { ...d, moved: true } : d));
      }
    };

    const onUp = () => {
      setDrag(() => {
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
    (id: HubPreviewId, e: WheelEvent) => {
      if (!editing || isMobileLayout()) return;
      e.preventDefault();
      e.stopPropagation();
      setLayout((prev) => {
        const box = prev.previews[id];
        if (!box) return prev;
        const factor = e.deltaY > 0 ? 0.96 : 1.04;
        const width = Math.min(22, Math.max(6, box.width * factor));
        const aspect = box.height / Math.max(box.width, 0.01);
        const height = Math.min(48, Math.max(10, width * aspect));
        const next = {
          ...prev,
          previews: {
            ...prev.previews,
            [id]: { ...box, width, height },
          },
        };
        scheduleSave(next);
        return next;
      });
    },
    [editing, scheduleSave]
  );

  const hint = useMemo(() => {
    if (!editing) return null;
    if (saveState === "saving") return "превью: сохраняю…";
    if (saveState === "error") return "превью: ошибка сохранения";
    if (saveState === "saved") return "превью: сохранено · тяни · колесо = размер";
    return "превью: режим расстановки · тяни · колесо = размер";
  }, [editing, saveState]);

  function shell(
    id: HubPreviewId,
    children: ReactNode
  ) {
    const box = layout.previews[id];
    if (!box) return null;
    const dragging = drag?.id === id;
    return (
      <div
        key={id}
        className={`home-hub-cw-item${editing ? " is-editable" : ""}${
          dragging ? " is-dragging" : ""
        }`}
        style={boxStyle(box)}
        onPointerDown={(e) => {
          if (!editing || isMobileLayout() || e.button !== 0) return;
          // не перехватываем клики по кнопкам внутри карточки
          const t = e.target as HTMLElement | null;
          if (t?.closest("button, a, input, textarea, select")) return;
          e.preventDefault();
          setDrag({
            id,
            mode: e.altKey ? "scale" : "move",
            startX: e.clientX,
            startY: e.clientY,
            orig: { ...box },
            moved: false,
          });
        }}
        onWheel={(e) => onWheelScale(id, e)}
      >
        {children}
      </div>
    );
  }

  // Зафиксировано: плотный столбик сверху слева, без огромных слотов.
  if (!editing) {
    return (
      <aside className="home-hub-cw home-hub-cw--stack" aria-label="Превью клановых войн">
        {showCw ? (
          <HomeCwAnnounce cards={cwCards} />
        ) : (
          <div className="home-hub-cw-stubs">
            {HOME_HUB_PREVIEW_IDS.map((id) => (
              <StubCard key={id} title={STUB_TITLES[id]} />
            ))}
          </div>
        )}
      </aside>
    );
  }

  return (
    <>
      {hint ? <div className="home-hub-cw-edit-hint">{hint}</div> : null}
      <aside
        className="home-hub-cw home-hub-cw--free is-editing"
        aria-label="Превью клановых войн"
        ref={hostRef}
      >
        {showCw
          ? HOME_HUB_PREVIEW_IDS.map((id) =>
              shell(
                id,
                <HomeCwAnnounce
                  cards={cwCards}
                  singleStack={
                    id === "junior" ? "Junior" : id === "main" ? "Main" : "Clan"
                  }
                />
              )
            )
          : HOME_HUB_PREVIEW_IDS.map((id) =>
              shell(id, <StubCard title={STUB_TITLES[id]} />)
            )}
      </aside>
    </>
  );
}
