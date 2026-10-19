"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { formatBirthDateInput, formatRuDate } from "@/lib/validation";

type AbsenceKind = "reserve" | "dayoff";

type Player = {
  userId: string;
  nick: string | null;
  name: string | null;
  steamName: string | null;
  steamId: string;
  regNo: number | null;
  clanTag: string;
  clanRole: string;
  inReserve: boolean;
  inDayOff?: boolean;
  stintId: string | null;
  reason: string | null;
  enteredAt: string | null;
  untilAt: string | null;
  untilLabel: string | null;
  enteredLabel: string | null;
};

type HistoryRow = {
  id: string;
  enteredAt: string;
  untilAt: string;
  exitedAt: string | null;
  reason: string;
  source: string;
  enteredBy: string | null;
  exitedBy: string | null;
  open: boolean;
};

function labelOf(p: {
  nick: string | null;
  name?: string | null;
  steamName: string | null;
  steamId: string;
}) {
  return p.nick || p.name || p.steamName || p.steamId;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function AdminReservePanel() {
  const [kind, setKind] = useState<AbsenceKind>("reserve");
  const [players, setPlayers] = useState<Player[]>([]);
  const [inCount, setInCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Player | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [enteredEdit, setEnteredEdit] = useState("");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  const apiBase = kind === "reserve" ? "/api/admin/reserve" : "/api/admin/day-off";
  const isActive = (p: Player) =>
    kind === "reserve" ? p.inReserve : Boolean(p.inDayOff);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(
    async (historyUserId?: string) => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams();
        if (historyUserId) params.set("historyUserId", historyUserId);
        const res = await fetch(`${apiBase}?${params}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Ошибка");
        const list = (json.players || []) as Player[];
        if (kind === "dayoff") {
          for (const p of list) {
            p.inDayOff = Boolean(
              (p as Player & { inDayOff?: boolean }).inDayOff
            );
          }
        }
        setPlayers(list);
        setInCount(
          Number(
            kind === "reserve" ? json.inReserveCount : json.inDayOffCount
          ) || 0
        );
        setTotal(Number(json.total) || 0);
        if (historyUserId) {
          setHistory((json.history || []) as HistoryRow[]);
          const fresh = list.find((p) => p.userId === historyUserId);
          if (fresh) {
            setSelected(fresh);
            if (isActive(fresh) && fresh.enteredLabel) {
              setEnteredEdit(fresh.enteredLabel);
            }
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiBase, kind]
  );

  useEffect(() => {
    setSelected(null);
    setHistory([]);
    setModalOpen(false);
    setConfirmPull(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (!modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [modalOpen, busy]);

  const filtered = useMemo(() => {
    let list = players;
    if (onlyActive) {
      list = list.filter((p) =>
        kind === "reserve" ? p.inReserve : Boolean(p.inDayOff)
      );
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((p) => {
        const blob =
          `${p.nick || ""} ${p.name || ""} ${p.steamName || ""} ${p.steamId}`.toLowerCase();
        return blob.includes(needle);
      });
    }
    return list;
  }, [players, q, onlyActive, kind]);

  function closeModal() {
    setModalOpen(false);
    setConfirmPull(false);
  }

  async function selectPlayer(p: Player) {
    setSelected(p);
    setFrom("");
    setUntil("");
    setReason(isActive(p) ? p.reason || "" : "");
    setEnteredEdit(isActive(p) ? p.enteredLabel || "" : "");
    setConfirmPull(false);
    setModalOpen(true);
    await load(p.userId);
  }

  async function putAbsence() {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selected.userId,
          until,
          reason,
          ...(from.trim() ? { from: from.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      await load(selected.userId);
      setFrom("");
      setUntil("");
      setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function pullAbsence() {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `${apiBase}?userId=${encodeURIComponent(selected.userId)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      setConfirmPull(false);
      await load(selected.userId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function saveEnteredAt(stintId: string, raw: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stintId, enteredAt: raw }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      if (selected) await load(selected.userId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const kindLabel = kind === "reserve" ? "резерв" : "выходной";

  let modal: ReactNode = null;
  if (mounted && modalOpen && selected) {
    modal = createPortal(
      <div
        className="admin-absence-modal"
        role="presentation"
        onClick={() => {
          if (!busy) closeModal();
        }}
      >
        <div
          className="admin-absence-dialog card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-absence-title"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="admin-absence-x"
            aria-label="Закрыть"
            disabled={busy}
            onClick={closeModal}
          >
            ×
          </button>

          <header className="admin-absence-head">
            <h3 id="admin-absence-title" style={{ margin: 0 }}>
              {labelOf(selected)}
            </h3>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              [{selected.clanTag}] · {selected.clanRole}
              {isActive(selected)
                ? ` · ${kindLabel} с ${selected.enteredLabel || "—"} до ${selected.untilLabel || "—"}`
                : " · в строю"}
            </p>
          </header>

          {err ? <p className="form-error">{err}</p> : null}

          {isActive(selected) ? (
            <div className="admin-absence-block">
              {!confirmPull ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setConfirmPull(true)}
                >
                  Снять {kindLabel}
                </button>
              ) : (
                <div className="admin-absence-confirm">
                  <p style={{ margin: "0 0 10px" }}>
                    Снять {kindLabel} у <strong>{labelOf(selected)}</strong>?
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void pullAbsence()}
                    >
                      {busy ? "…" : "Да, снять"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => setConfirmPull(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {isActive(selected) && selected.stintId ? (
            <div className="admin-absence-block">
              <h4 style={{ margin: "0 0 8px" }}>Дата начала</h4>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Влияет на цвет дней в календаре профиля.
              </p>
              <label className="field">
                <span>С (ДД.ММ.ГГГГ)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="ДД.ММ.ГГГГ"
                  value={enteredEdit}
                  onChange={(e) =>
                    setEnteredEdit(formatBirthDateInput(e.target.value))
                  }
                />
              </label>
              <button
                type="button"
                className="btn"
                disabled={
                  busy ||
                  enteredEdit.replace(/\D/g, "").length !== 8 ||
                  enteredEdit === selected.enteredLabel
                }
                onClick={() =>
                  void saveEnteredAt(selected.stintId!, enteredEdit)
                }
              >
                Сохранить дату начала
              </button>
            </div>
          ) : null}

          <div className="admin-absence-block">
            <h4 style={{ margin: "0 0 8px" }}>
              {isActive(selected)
                ? `Обновить ${kindLabel}`
                : `Выдать ${kindLabel}`}
            </h4>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Можно задним числом: укажи «с» и «до» на любые даты.
              {kind === "dayoff"
                ? " Выходной обычно 1–3 дня."
                : " Резерв — от 4 дней."}
            </p>
            <label className="field">
              <span>С (необяз., задним числом)</span>
              <input
                type="text"
                placeholder="ДД.ММ.ГГГГ"
                value={from}
                onChange={(e) =>
                  setFrom(formatBirthDateInput(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>До какой даты</span>
              <input
                type="text"
                placeholder="ДД.ММ.ГГГГ"
                value={until}
                onChange={(e) =>
                  setUntil(formatBirthDateInput(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>Причина</span>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Учёба / работа / отпуск…"
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={busy || !until.trim() || reason.trim().length < 3}
              onClick={() => void putAbsence()}
            >
              {isActive(selected)
                ? `Обновить ${kindLabel}`
                : `Выдать ${kindLabel}`}
            </button>
          </div>

          <div className="admin-absence-block" style={{ marginBottom: 0 }}>
            <h4 style={{ margin: "0 0 8px" }}>История ({kindLabel})</h4>
            <div
              className="admin-table-wrap"
              style={{ maxHeight: 220, overflow: "auto" }}
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Уход</th>
                    <th>До</th>
                    <th>Выход</th>
                    <th>Кто</th>
                    <th>Причина</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{formatWhen(h.enteredAt)}</td>
                      <td>{formatWhen(h.untilAt)}</td>
                      <td>
                        {h.open ? (
                          <span style={{ color: "#facc15" }}>сейчас</span>
                        ) : (
                          formatWhen(h.exitedAt)
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {h.source === "admin" ? "админ" : "сам"}
                        {h.enteredBy ? ` · ${h.enteredBy}` : ""}
                        {h.exitedBy ? ` → ${h.exitedBy}` : ""}
                      </td>
                      <td title={h.reason}>
                        {h.reason.length > 36
                          ? `${h.reason.slice(0, 36)}…`
                          : h.reason}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ fontSize: 12, padding: "2px 8px" }}
                          disabled={busy}
                          onClick={() => {
                            const next = window.prompt(
                              "Дата ухода (ДД.ММ.ГГГГ)",
                              formatRuDate(new Date(h.enteredAt))
                            );
                            if (!next?.trim()) return;
                            void saveEnteredAt(h.id, next.trim());
                          }}
                        >
                          дата
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!history.length ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        {loading ? "Загрузка…" : "История пуста"}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <section className="card journal-card">
      <p className="muted" style={{ marginTop: 0 }}>
        Главный / Зам / HR: выходной (1–3 дня) и резерв (от 4 дней). Кликни
        игрока — управление во всплывающем окне (выдать / снять / даты /
        история). Журнал действий пишется автоматически.
      </p>

      <div className="journal-toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={kind === "reserve" ? "btn" : "btn-ghost"}
            onClick={() => setKind("reserve")}
          >
            Резерв
          </button>
          <button
            type="button"
            className={kind === "dayoff" ? "btn" : "btn-ghost"}
            onClick={() => setKind("dayoff")}
          >
            Выходной
          </button>
        </div>
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
          <span>Поиск</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ник / steam…"
          />
        </label>
        <label
          className="field"
          style={{
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexDirection: "row",
          }}
        >
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
          />
          <span>Только {kindLabel}</span>
        </label>
        <button
          type="button"
          className="btn-ghost"
          disabled={loading}
          onClick={() => void load(selected?.userId)}
        >
          Обновить
        </button>
      </div>

      <p className="muted">
        Сейчас ({kindLabel}): <strong>{inCount}</strong> · всего в списке BB:{" "}
        <strong>{total}</strong>
        {loading ? " · загрузка…" : ""}
      </p>
      {err && !modalOpen ? <p className="form-error">{err}</p> : null}

      <div
        className="admin-table-wrap"
        style={{ maxHeight: 640, overflow: "auto", marginTop: 12 }}
      >
        <table className="admin-table">
          <thead>
            <tr>
              <th>Ник</th>
              <th>Статус</th>
              <th>Ушёл</th>
              <th>До</th>
              <th>Причина</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.userId}
                onClick={() => void selectPlayer(p)}
                style={{
                  cursor: "pointer",
                  background: isActive(p)
                    ? kind === "reserve"
                      ? "rgba(59, 130, 246, 0.12)"
                      : "rgba(20, 184, 166, 0.12)"
                    : undefined,
                }}
              >
                <td>
                  {labelOf(p)}
                  <div className="muted" style={{ fontSize: 11 }}>
                    [{p.clanTag}] · {p.clanRole}
                  </div>
                </td>
                <td>
                  {isActive(p) ? (
                    <span
                      style={{
                        color: kind === "reserve" ? "#93c5fd" : "#5eead4",
                        fontWeight: 700,
                      }}
                    >
                      {kindLabel}
                    </span>
                  ) : (
                    <span className="muted">в строю</span>
                  )}
                </td>
                <td>{p.enteredLabel || "—"}</td>
                <td>{p.untilLabel || "—"}</td>
                <td style={{ maxWidth: 220 }} title={p.reason || undefined}>
                  {p.reason
                    ? p.reason.length > 48
                      ? `${p.reason.slice(0, 48)}…`
                      : p.reason
                    : "—"}
                </td>
              </tr>
            ))}
            {!filtered.length && !loading ? (
              <tr>
                <td colSpan={5} className="muted">
                  {total === 0
                    ? "Клан BlackBerry не найден или пуст"
                    : "Никого нет"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {modal}
    </section>
  );
}
