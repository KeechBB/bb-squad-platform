"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FactionView } from "@/lib/factions";
import {
  clampFactionPane,
  defaultFactionPageLayout,
  type FactionPageLayout,
  type FactionPaneBox,
  type FactionPaneId,
} from "@/lib/factionPageLayoutShared";
import {
  FACTION_EMOJIS,
  FACTION_INFO_COLORS,
  FACTION_INFO_FONTS,
  parseFactionInfo,
  stringifyFactionInfo,
  type FactionInfoDoc,
} from "@/lib/factionInfoDoc";
import { FactionOnline } from "@/components/FactionOnline";
import {
  FactionAnalytics,
  FactionGrowthBoard,
  FactionRatings,
  FactionWeekBoard,
} from "@/components/FactionBoards";

const TABS = [
  ["online", "Онлайн"],
  ["growth", "Развитие"],
  ["train", "Тренировки"],
  ["cw", "Участие КВ"],
  ["analytics", "Аналитика"],
  ["ratings", "Рейтинги"],
] as const;

type TabId = (typeof TABS)[number][0];

const TAB_NOTE: Record<TabId, string> = {
  online: "Сводка онлайна игроков фракции появится здесь.",
  growth: "Развитие игроков фракции появится здесь.",
  train: "Тренировки игроков фракции появятся здесь.",
  cw: "Участие в клановых войнах появится здесь.",
  analytics: "Статистика относительно других фракций появится здесь.",
  ratings: "Доли фракций на тренировках за последние 7 дней.",
};

type ResizeMode = "move" | "e" | "s" | "se";

type DragState = {
  id: FactionPaneId;
  mode: ResizeMode;
  startX: number;
  startY: number;
  orig: FactionPaneBox;
};

type PoolPerson = {
  id: string;
  nick: string;
  name: string;
  steamId?: string;
  steamName?: string;
  blockedIn?: string | null;
};

function normQuery(s: string) {
  return s.trim().toLowerCase().replace(/[-_\s]+/g, "");
}

function boxStyle(box: FactionPaneBox): CSSProperties {
  return {
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
  };
}

function PlayerSearchSelect({
  people,
  value,
  onChange,
  placeholder,
}: {
  people: PoolPerson[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = people.find((p) => p.id === value) || null;
  const filtered = useMemo(() => {
    const needle = normQuery(q);
    const list = !needle
      ? people
      : people.filter((p) => {
          const hay = normQuery(
            `${p.nick} ${p.steamName || ""} ${p.name} ${p.steamId || ""}`
          );
          const raw = `${p.nick} ${p.steamName || ""} ${p.name} ${p.steamId || ""}`.toLowerCase();
          return hay.includes(needle) || raw.includes(q.trim().toLowerCase());
        });
    // сначала свободные, потом занятые в других фракциях
    return [...list].sort((a, b) => {
      const ab = a.blockedIn ? 1 : 0;
      const bb = b.blockedIn ? 1 : 0;
      if (ab !== bb) return ab - bb;
      return a.nick.localeCompare(b.nick, "ru");
    });
  }, [people, q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="faction-player-search" ref={rootRef}>
      <input
        className="role-select"
        value={open ? q : selected ? `${selected.nick}${selected.name ? ` (${selected.name})` : ""}` : q}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
      />
      {open ? (
        <ul className="faction-player-search-list" role="listbox">
          {filtered.length ? (
            filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={Boolean(p.blockedIn)}
                  className={p.blockedIn ? "is-blocked" : undefined}
                  onClick={() => {
                    if (p.blockedIn) return;
                    onChange(p.id);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span>
                    {p.nick}
                    {p.name ? ` (${p.name})` : ""}
                    {p.steamName && p.steamName !== p.nick ? ` · ${p.steamName}` : ""}
                  </span>
                  {p.blockedIn ? (
                    <span className="muted">уже: {p.blockedIn}</span>
                  ) : p.steamId ? (
                    <span className="muted">{p.steamId}</span>
                  ) : null}
                </button>
              </li>
            ))
          ) : (
            <li className="muted faction-player-search-empty">Никого не найдено</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

type RosterSortKey = "order" | "nick" | "name" | "kit" | "role";

const ROSTER_COLUMNS: { key: RosterSortKey; label: string }[] = [
  { key: "order", label: "№" },
  { key: "nick", label: "Ник" },
  { key: "name", label: "Имя" },
  { key: "kit", label: "Основной кит" },
  { key: "role", label: "Роль" },
];

function rosterValue(m: FactionView["members"][number], key: RosterSortKey): string | number {
  if (key === "order") return m.order;
  if (key === "nick") return m.nick;
  if (key === "name") return m.name;
  if (key === "kit") return m.mainKit;
  return m.roleName;
}

function compareRoster(
  a: FactionView["members"][number],
  b: FactionView["members"][number],
  key: RosterSortKey,
  dir: "asc" | "desc"
) {
  const va = rosterValue(a, key);
  const vb = rosterValue(b, key);
  let cmp = 0;
  if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
  else cmp = String(va).localeCompare(String(vb), "ru", { sensitivity: "base", numeric: true });
  if (cmp === 0) cmp = a.order - b.order;
  return dir === "asc" ? cmp : -cmp;
}

function FactionRoster({
  members,
  canManage,
  roles,
  base,
  run,
}: {
  members: FactionView["members"];
  canManage: boolean;
  roles: FactionView["roles"];
  base: string;
  run: (path: string, init: RequestInit) => Promise<void>;
}) {
  const fitRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState(8);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<RosterSortKey>("order");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(
    () => [...members].sort((a, b) => compareRoster(a, b, sortKey, sortDir)),
    [members, sortKey, sortDir]
  );
  const pageCount = Math.max(1, Math.ceil(sorted.length / Math.max(1, pageSize)));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const measure = () => {
      const head = el.querySelector("thead")?.getBoundingClientRect().height ?? 44;
      const sample = el.querySelector("tbody tr")?.getBoundingClientRect().height ?? 44;
      const room = Math.max(0, el.clientHeight - head);
      const next = Math.max(1, Math.floor(room / Math.max(sample, 1)));
      setPageSize((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sorted.length, safePage]);

  function onSort(key: RosterSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  return (
    <div className="faction-roster">
      <h2>Состав</h2>
      <div className="faction-roster-fit" ref={fitRef}>
        <table className="admin-table faction-roster-table">
          <thead>
            <tr>
              {ROSTER_COLUMNS.map((col) => {
                const on = sortKey === col.key;
                return (
                  <th key={col.key} aria-sort={on ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button
                      type="button"
                      className={`faction-roster-sort${on ? " is-on" : ""}`}
                      onClick={() => onSort(col.key)}
                    >
                      {col.label}
                      {on ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.id}>
                <td>{m.order}</td>
                <td>
                  <Link
                    className="player-nick-link"
                    href={`/players/${encodeURIComponent(m.nick)}`}
                  >
                    {m.nick}
                  </Link>
                </td>
                <td>{m.name}</td>
                <td>{m.mainKit}</td>
                <td>
                  {canManage && m.seat !== "LEADER" ? (
                    <select
                      className="role-select"
                      value={
                        m.seat === "DEPUTY"
                          ? roles.find((r) => r.isDeputy)?.id || ""
                          : m.roleId || ""
                      }
                      onChange={(e) =>
                        void run(`${base}/members`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            userId: m.userId,
                            roleId: e.target.value || null,
                          }),
                        })
                      }
                    >
                      <option value="">Без роли</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    m.roleName
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <div className="faction-roster-pager">
          <button type="button" className="btn" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)}>
            Назад
          </button>
          <span className="muted">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="btn"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Дальше
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function FactionPageClient({
  initial,
  initialLayout,
}: {
  initial: FactionView;
  initialLayout: FactionPageLayout;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState<TabId>("online");
  const [onlineKey, setOnlineKey] = useState(0);
  const [growthKey, setGrowthKey] = useState(0);
  const [trainKey, setTrainKey] = useState(0);
  const [cwKey, setCwKey] = useState(0);
  const [analyticsKey, setAnalyticsKey] = useState(0);
  const [ratingsKey, setRatingsKey] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(initial.name);
  const [tgUrl, setTgUrl] = useState(initial.tgUrl || "");
  const [infoDoc, setInfoDoc] = useState<FactionInfoDoc>(() => parseFactionInfo(initial.info));
  const [inviteId, setInviteId] = useState("");
  const [kickId, setKickId] = useState("");
  const [kickReason, setKickReason] = useState("");
  const [kickOpen, setKickOpen] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [layout, setLayout] = useState<FactionPageLayout>(initialLayout);
  const [placing, setPlacing] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const infoAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const base = `/api/factions/${encodeURIComponent(view.slug)}`;
  const canPlace = view.keech || view.canManage;
  const memberView = !view.keech && !view.canManage;

  async function reload(href?: string) {
    if (href && href !== `/factions/${encodeURIComponent(view.slug)}`) {
      router.push(href);
      return;
    }
    const res = await fetch(base);
    if (!res.ok) return;
    const next = (await res.json()) as FactionView;
    setView(next);
    setName(next.name);
    setTgUrl(next.tgUrl || "");
    setInfoDoc(parseFactionInfo(next.info));
    setInviteId("");
    setKickId("");
    setKickReason("");
    setKickOpen(false);
    setLeaderId("");
  }

  async function run(path: string, init: RequestInit) {
    setBusy(true);
    setError("");
    const res = await fetch(path, init);
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      href?: string;
      invited?: boolean;
      logoUrl?: string;
    };
    setBusy(false);
    if (!res.ok) {
      setFlash("");
      setError(data.error || "Не вышло");
      return;
    }
    setFlash(
      data.invited
        ? "Приглашение отправлено. Игрок примет или отклонит его в колокольчике."
        : ""
    );
    if (data.logoUrl) {
      setView((v) => ({ ...v, logoUrl: data.logoUrl || v.logoUrl }));
    }
    await reload(data.href);
  }

  const persist = useCallback(
    async (next: FactionPageLayout) => {
      setSaveState("saving");
      try {
        const res = await fetch(`${base}/page-layout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ panes: next.panes }),
        });
        if (!res.ok) throw new Error(`save ${res.status}`);
        const saved = (await res.json()) as FactionPageLayout;
        setLayout(saved);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [base]
  );

  const scheduleSave = useCallback(
    (next: FactionPageLayout) => {
      if (!canPlace) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(next);
      }, 350);
    },
    [canPlace, persist]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dx = ((e.clientX - drag.startX) / rect.width) * 100;
      const dy = ((e.clientY - drag.startY) / rect.height) * 100;
      const orig = drag.orig;
      const nextBox: FactionPaneBox = { ...orig };
      if (drag.mode === "move") {
        nextBox.left = orig.left + dx;
        nextBox.top = orig.top + dy;
      } else {
        if (drag.mode === "e" || drag.mode === "se") nextBox.width = orig.width + dx;
        if (drag.mode === "s" || drag.mode === "se") nextBox.height = orig.height + dy;
      }
      const clamped = clampFactionPane(nextBox, orig);
      const next = {
        ...layoutRef.current,
        panes: { ...layoutRef.current.panes, [drag.id]: clamped },
      };
      layoutRef.current = next;
      setLayout(next);
    };
    const onUp = () => {
      setDrag(null);
      scheduleSave(layoutRef.current);
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

  function beginDrag(id: FactionPaneId, mode: ResizeMode, e: ReactPointerEvent) {
    if (!placing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...paneBox(id) },
    });
  }

  function paneBox(id: FactionPaneId): FactionPaneBox {
    return layout.panes[id];
  }

  const kickable = view.members.filter((m) => {
    if (m.userId === view.myUserId) return false;
    if (m.seat === "LEADER" && !view.keech) return false;
    return true;
  });

  const kickPool: PoolPerson[] = kickable.map((m) => ({
    id: m.userId,
    nick: m.nick,
    name: m.name,
  }));

  const placeHint =
    saveState === "saving"
      ? "сохраняю…"
      : saveState === "saved"
        ? "сохранено · полоска — двигать · края — ширина и высота · угол — оба"
        : saveState === "error"
          ? "не сохранилось"
          : "полоска — двигать · правый край — ширина · нижний — высота · угол — оба";

  function insertEmoji(emoji: string) {
    const el = infoAreaRef.current;
    if (!el) {
      setInfoDoc((d) => ({ ...d, text: `${d.text}${emoji}`.slice(0, 2000) }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = `${el.value.slice(0, start)}${emoji}${el.value.slice(end)}`.slice(0, 2000);
    setInfoDoc((d) => ({ ...d, text: next }));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function pane(id: FactionPaneId, title: string, body: ReactNode) {
    const box = paneBox(id);
    return (
      <section
        className={`card faction-pane faction-pane-${id}${drag?.id === id ? " is-dragging" : ""}`}
        style={memberView && !placing ? undefined : boxStyle(box)}
      >
        {placing ? (
          <div className="faction-move" onPointerDown={(e) => beginDrag(id, "move", e)}>
            {title}
          </div>
        ) : null}
        <div className="faction-pane-body">{body}</div>
        {placing ? (
          <>
            <div className="faction-resize faction-resize-e" onPointerDown={(e) => beginDrag(id, "e", e)} />
            <div className="faction-resize faction-resize-s" onPointerDown={(e) => beginDrag(id, "s", e)} />
            <div className="faction-resize faction-resize-se" onPointerDown={(e) => beginDrag(id, "se", e)} />
          </>
        ) : null}
      </section>
    );
  }

  const infoStyle: CSSProperties = {
    fontFamily: infoDoc.font,
    color: infoDoc.color,
  };

  return (
    <main
      className={`clan-page faction-page${placing ? " is-placing" : ""}${
        memberView ? " is-member" : ""
      }`}
    >
      {canPlace ? (
        <div className="faction-place-bar">
          <button type="button" className="btn primary" onClick={() => setPlacing((v) => !v)}>
            {placing ? "Готово" : "Разместить"}
          </button>
          {placing ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                const next = defaultFactionPageLayout();
                setLayout(next);
                void persist(next);
              }}
            >
              Сетка по умолчанию
            </button>
          ) : null}
          {placing ? <span className="muted">{placeHint}</span> : null}
        </div>
      ) : null}

      <div className="faction-stage" ref={stageRef}>
        {pane(
          "brand",
          "Название",
          view.canEditIdentity ? (
            <>
              <div className="faction-brand">
                {view.logoUrl ? (
                  <img src={view.logoUrl} alt="" width={96} height={96} className="faction-logo" />
                ) : (
                  <div className="faction-logo faction-logo-empty">лого</div>
                )}
                <div>
                  <h1>{view.name}</h1>
                  <p>
                    Глава: <strong>{view.leaderNick || "не назначен"}</strong>
                  </p>
                  <p>
                    Зам:{" "}
                    {view.deputyNicks.length ? view.deputyNicks.join(", ") : "не назначен"}
                  </p>
                  {view.tgUrl ? (
                    <p>
                      <a href={view.tgUrl} target="_blank" rel="noreferrer">
                        ТГ-канал
                      </a>
                    </p>
                  ) : (
                    <p className="muted">Ссылка на ТГ-канал не задана</p>
                  )}
                </div>
              </div>
              <div className="faction-identity-form">
                <label className="field">
                  <span>Название</span>
                  <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field">
                  <span>Ссылка на ТГ-канал</span>
                  <input
                    value={tgUrl}
                    placeholder="https://t.me/..."
                    onChange={(e) => setTgUrl(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Логотип, PNG / JPG / WebP (белый фон срежется)</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const form = new FormData();
                      form.set("logo", file);
                      void run(`${base}/logo`, { method: "POST", body: form });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    void run(base, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name, tgUrl }),
                    })
                  }
                >
                  Сохранить название и ссылку
                </button>
                <label className="field">
                  <span>Сменить главу</span>
                  <PlayerSearchSelect
                    people={view.leaderPool}
                    value={leaderId}
                    onChange={setLeaderId}
                    placeholder="Ник или Steam ID"
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !leaderId}
                  onClick={() =>
                    void run(base, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ leaderUserId: leaderId }),
                    })
                  }
                >
                  Назначить главу
                </button>
              </div>
            </>
          ) : (
            <div className="faction-brand faction-brand--logo-fill">
              {view.logoUrl ? (
                <img
                  src={view.logoUrl}
                  alt={view.name}
                  className="faction-logo faction-logo--fill"
                />
              ) : (
                <div className="faction-logo faction-logo-empty faction-logo--fill">
                  {view.name}
                </div>
              )}
            </div>
          )
        )}

        {view.canManage
          ? pane(
              "controls",
              "Панель управления",
              <>
                <h2>Панель управления</h2>
                <ol className="faction-controls">
                  <li>
                    <span>Пригласить во фракцию</span>
                    <div className="clan-invite-row">
                      <PlayerSearchSelect
                        people={view.invitePool}
                        value={inviteId}
                        onChange={setInviteId}
                        placeholder="Ник или Steam ID"
                      />
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy || !inviteId}
                        onClick={() =>
                          void run(`${base}/members`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId: inviteId }),
                          })
                        }
                      >
                        Пригласить
                      </button>
                    </div>
                    {flash ? <p className="muted">{flash}</p> : null}
                  </li>
                  <li>
                    <span>Исключить из фракции</span>
                    <div className="clan-invite-row">
                      <PlayerSearchSelect
                        people={kickPool}
                        value={kickId}
                        onChange={setKickId}
                        placeholder="Ник"
                      />
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !kickId}
                        onClick={() => {
                          setKickReason("");
                          setKickOpen(true);
                        }}
                      >
                        Исключить
                      </button>
                    </div>
                  </li>
                  <li>
                    <span>Создать роль / удалить</span>
                    <div className="clan-invite-row">
                      <input
                        value={roleName}
                        placeholder="Название роли"
                        maxLength={32}
                        onChange={(e) => setRoleName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || roleName.trim().length < 2}
                        onClick={() =>
                          void run(`${base}/roles`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: roleName }),
                          }).then(() => setRoleName(""))
                        }
                      >
                        Создать
                      </button>
                    </div>
                    <ul className="faction-role-list">
                      {view.roles.map((r) => (
                        <li key={r.id}>
                          {r.name}
                          {r.isDeputy ? (
                            <span className="muted"> · не удаляется</span>
                          ) : (
                            <button
                              type="button"
                              className="btn"
                              disabled={busy}
                              onClick={() =>
                                void run(`${base}/roles?roleId=${encodeURIComponent(r.id)}`, {
                                  method: "DELETE",
                                })
                              }
                            >
                              Удалить
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                </ol>
              </>
            )
          : null}

        {pane(
          "info",
          "Информация для игроков",
          <div className="faction-info-box">
            <h2>Информация для игроков</h2>
            {view.canEditInfo ? (
              <>
                <div className="faction-info-toolbar">
                  <label className="faction-info-tool">
                    <span>Шрифт</span>
                    <select
                      value={infoDoc.font}
                      onChange={(e) => setInfoDoc((d) => ({ ...d, font: e.target.value }))}
                    >
                      {FACTION_INFO_FONTS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="faction-info-tool">
                    <span>Цвет</span>
                    <input
                      type="color"
                      value={infoDoc.color}
                      onChange={(e) => setInfoDoc((d) => ({ ...d, color: e.target.value }))}
                    />
                  </label>
                  <div className="faction-info-swatches" aria-label="Цвета">
                    {FACTION_INFO_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`faction-info-swatch${infoDoc.color === c ? " is-on" : ""}`}
                        style={{ background: c }}
                        title={c}
                        onClick={() => setInfoDoc((d) => ({ ...d, color: c }))}
                      />
                    ))}
                  </div>
                </div>
                <div className="faction-emoji-row" aria-label="Смайлы">
                  {FACTION_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="faction-emoji-btn"
                      onClick={() => insertEmoji(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={infoAreaRef}
                  className="faction-info"
                  style={infoStyle}
                  value={infoDoc.text}
                  maxLength={2000}
                  placeholder="Текст для игроков фракции"
                  onChange={(e) => setInfoDoc((d) => ({ ...d, text: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(base, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ info: stringifyFactionInfo(infoDoc) }),
                    })
                  }
                >
                  Сохранить текст
                </button>
              </>
            ) : (
              <p className="faction-info-read" style={infoStyle}>
                {infoDoc.text || "Пока пусто."}
              </p>
            )}
          </div>
        )}

        {pane(
          "stats",
          "Статистика",
          <>
            {error ? <p className="error">{error}</p> : null}
            <div className="admin-tabs clan-tabs">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`admin-tab${tab === id ? " active" : ""}`}
                  onClick={() => {
                    setTab(id);
                    if (id === "online") setOnlineKey((n) => n + 1);
                    if (id === "growth") setGrowthKey((n) => n + 1);
                    if (id === "train") setTrainKey((n) => n + 1);
                    if (id === "cw") setCwKey((n) => n + 1);
                    if (id === "analytics") setAnalyticsKey((n) => n + 1);
                    if (id === "ratings") setRatingsKey((n) => n + 1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "online" ? <FactionOnline slug={view.slug} loadKey={onlineKey} /> : null}
            {tab === "growth" ? <FactionGrowthBoard slug={view.slug} loadKey={growthKey} /> : null}
            {tab === "train" ? <FactionWeekBoard slug={view.slug} kind="train" loadKey={trainKey} /> : null}
            {tab === "cw" ? <FactionWeekBoard slug={view.slug} kind="cw" loadKey={cwKey} /> : null}
            {tab === "analytics" ? (
              <FactionAnalytics slug={view.slug} loadKey={analyticsKey} />
            ) : null}
            {tab === "ratings" ? <FactionRatings slug={view.slug} loadKey={ratingsKey} /> : null}
          </>
        )}

        {pane(
          "roster",
          "Состав",
          <FactionRoster
            members={view.members}
            canManage={view.canManage}
            roles={view.roles}
            base={base}
            run={run}
          />
        )}
      </div>

      {kickOpen ? (
        <div
          className="profile-match-modal"
          role="presentation"
          onClick={() => !busy && setKickOpen(false)}
        >
          <div className="profile-match-modal-backdrop" />
          <div
            className="profile-match-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="faction-kick-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="profile-match-modal-head">
              <div>
                <h3 id="faction-kick-title">Причина исключения</h3>
                <p className="profile-match-modal-sub muted">
                  {kickPool.find((p) => p.id === kickId)?.nick || "игрок"} · без
                  причины исключить нельзя — уйдёт в лог фракций
                </p>
              </div>
              <button
                type="button"
                className="profile-match-modal-close"
                disabled={busy}
                onClick={() => setKickOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="profile-match-modal-body">
              <label className="admin-tier-log-field admin-tier-log-field-wide">
                <span>Причина</span>
                <textarea
                  value={kickReason}
                  onChange={(e) => setKickReason(e.target.value)}
                  rows={3}
                  maxLength={400}
                  placeholder="Например: не заходит на тренировки / по собственному"
                  autoFocus
                />
              </label>
              <div className="clan-invite-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setKickOpen(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || kickReason.trim().length < 3 || !kickId}
                  onClick={() => {
                    const reason = kickReason.trim();
                    void run(
                      `${base}/members?userId=${encodeURIComponent(kickId)}`,
                      {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ reason }),
                      }
                    ).then(() => {
                      setKickOpen(false);
                      setKickReason("");
                    });
                  }}
                >
                  Исключить
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
