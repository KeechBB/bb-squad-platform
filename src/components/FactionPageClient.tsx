"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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

const TABS = [
  ["online", "онлайн"],
  ["growth", "развитие"],
  ["train", "Тренировки"],
  ["cw", "Участие КВ"],
  ["pb1", "Игра PB1"],
  ["analytics", "Аналитика"],
] as const;

type TabId = (typeof TABS)[number][0];

const TAB_NOTE: Record<TabId, string> = {
  online: "Сводка онлайна игроков фракции появится здесь.",
  growth: "Развитие игроков фракции появится здесь.",
  train: "Тренировки игроков фракции появятся здесь.",
  cw: "Участие в клановых войнах появится здесь.",
  pb1: "Игра на PB1 появится здесь.",
  analytics: "Статистика относительно других фракций появится здесь.",
};

/** Участник (не штаб): компактное лого слева, инфо справа. */
const MEMBER_BRAND: FactionPaneBox = { left: 0, top: 0, width: 24, height: 52 };
const MEMBER_INFO: FactionPaneBox = { left: 25.2, top: 0, width: 41.2, height: 52 };

type ResizeMode = "move" | "e" | "s" | "se";

type DragState = {
  id: FactionPaneId;
  mode: ResizeMode;
  startX: number;
  startY: number;
  orig: FactionPaneBox;
};

type PoolPerson = { id: string; nick: string; name: string; steamId?: string };

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
    const needle = q.trim().toLowerCase();
    if (!needle) return people.slice(0, 80);
    return people
      .filter((p) => {
        const hay = `${p.nick} ${p.name} ${p.steamId || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 80);
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
                  onClick={() => {
                    onChange(p.id);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span>{p.nick}{p.name ? ` (${p.name})` : ""}</span>
                  {p.steamId ? <span className="muted">{p.steamId}</span> : null}
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
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(initial.name);
  const [tgUrl, setTgUrl] = useState(initial.tgUrl || "");
  const [infoDoc, setInfoDoc] = useState<FactionInfoDoc>(() => parseFactionInfo(initial.info));
  const [inviteId, setInviteId] = useState("");
  const [kickId, setKickId] = useState("");
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
    if (memberView && !placing) {
      if (id === "brand") return MEMBER_BRAND;
      if (id === "info") return MEMBER_INFO;
    }
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
        style={boxStyle(box)}
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
                        onClick={() =>
                          void run(`${base}/members?userId=${encodeURIComponent(kickId)}`, {
                            method: "DELETE",
                          })
                        }
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
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="muted faction-stat-note">{TAB_NOTE[tab]}</p>
          </>
        )}

        {pane(
          "roster",
          "Состав",
          <>
            <h2>Состав</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Ник</th>
                    <th>Имя</th>
                    <th>Основной кит</th>
                    <th>Роль</th>
                  </tr>
                </thead>
                <tbody>
                  {view.members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.order}</td>
                      <td>{m.nick}</td>
                      <td>{m.name}</td>
                      <td>{m.mainKit}</td>
                      <td>
                        {view.canManage && m.seat !== "LEADER" ? (
                          <select
                            className="role-select"
                            value={
                              m.seat === "DEPUTY"
                                ? view.roles.find((r) => r.isDeputy)?.id || ""
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
                            {view.roles.map((r) => (
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
          </>
        )}
      </div>
    </main>
  );
}
