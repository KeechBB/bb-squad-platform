"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { FactionView } from "@/lib/factions";
import {
  clampFactionPane,
  defaultFactionPageLayout,
  type FactionPageLayout,
  type FactionPaneBox,
  type FactionPaneId,
} from "@/lib/factionPageLayoutShared";

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

type ResizeMode = "move" | "e" | "s" | "se";

type DragState = {
  id: FactionPaneId;
  mode: ResizeMode;
  startX: number;
  startY: number;
  orig: FactionPaneBox;
};

function boxStyle(box: FactionPaneBox): CSSProperties {
  return {
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
  };
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
  const [info, setInfo] = useState(initial.info);
  const [inviteId, setInviteId] = useState("");
  const [kickId, setKickId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [layout, setLayout] = useState<FactionPageLayout>(initialLayout);
  const [placing, setPlacing] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const base = `/api/factions/${encodeURIComponent(view.slug)}`;

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
    setInfo(next.info);
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
    await reload(data.href);
  }

  const persist = useCallback(async (next: FactionPageLayout) => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/factions/page-layout", {
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
  }, []);

  const scheduleSave = useCallback(
    (next: FactionPageLayout) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(next);
      }, 350);
    },
    [persist]
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
      orig: { ...layout.panes[id] },
    });
  }

  const kickable = view.members.filter((m) => {
    if (m.userId === view.myUserId) return false;
    if (m.seat === "LEADER" && !view.keech) return false;
    return true;
  });

  const placeHint =
    saveState === "saving"
      ? "сохраняю…"
      : saveState === "saved"
        ? "сохранено · полоска — двигать · края — ширина и высота · угол — оба"
        : saveState === "error"
          ? "не сохранилось"
          : "полоска — двигать · правый край — ширина · нижний — высота · угол — оба";

  function pane(id: FactionPaneId, title: string, body: ReactNode) {
    const box = layout.panes[id];
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

  return (
    <main className={`clan-page faction-page${placing ? " is-placing" : ""}`}>
      {view.keech ? (
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
                  <span>Логотип, PNG / JPG / WebP</span>
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
                  <select
                    className="role-select"
                    value={leaderId}
                    onChange={(e) => setLeaderId(e.target.value)}
                  >
                    <option value="">Выбери из клана</option>
                    {view.leaderPool.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nick}
                        {p.name ? ` (${p.name})` : ""}
                      </option>
                    ))}
                  </select>
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
                      <select className="role-select" value={inviteId} onChange={(e) => setInviteId(e.target.value)}>
                        <option value="">Игрок клана</option>
                        {view.invitePool.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nick}
                            {p.name ? ` (${p.name})` : ""}
                          </option>
                        ))}
                      </select>
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
                      <select className="role-select" value={kickId} onChange={(e) => setKickId(e.target.value)}>
                        <option value="">Ник</option>
                        {kickable.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.nick}
                          </option>
                        ))}
                      </select>
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
            <p className="muted faction-info-lead">Сюда глава пишет текст для состава.</p>
            {view.canEditInfo ? (
              <>
                <textarea
                  className="faction-info"
                  value={info}
                  maxLength={2000}
                  placeholder="Текст для игроков фракции"
                  onChange={(e) => setInfo(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(base, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ info }),
                    })
                  }
                >
                  Сохранить текст
                </button>
              </>
            ) : (
              <p className="faction-info-read">{view.info || "Пока пусто."}</p>
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
                            value={m.seat === "DEPUTY" ? view.roles.find((r) => r.isDeputy)?.id || "" : m.roleId || ""}
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
            <p className="muted">Номер — порядок вступления. Самим выйти нельзя.</p>
          </>
        )}
      </div>
    </main>
  );
}
