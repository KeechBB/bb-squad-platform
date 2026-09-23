"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [players, setPlayers] = useState<Player[]>([]);
  const [inReserveCount, setInReserveCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [onlyReserve, setOnlyReserve] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Player | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (historyUserId?: string) => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (historyUserId) params.set("historyUserId", historyUserId);
      const res = await fetch(`/api/admin/reserve?${params}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      setPlayers((json.players || []) as Player[]);
      setInReserveCount(Number(json.inReserveCount) || 0);
      setTotal(Number(json.total) || 0);
      if (historyUserId) {
        setHistory((json.history || []) as HistoryRow[]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = players;
    if (onlyReserve) list = list.filter((p) => p.inReserve);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((p) => {
        const blob = `${p.nick || ""} ${p.name || ""} ${p.steamName || ""} ${p.steamId}`.toLowerCase();
        return blob.includes(needle);
      });
    }
    return list;
  }, [players, q, onlyReserve]);

  async function selectPlayer(p: Player) {
    setSelected(p);
    setUntil("");
    setReason(p.inReserve ? p.reason || "" : "");
    await load(p.userId);
  }

  async function putInReserve() {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selected.userId,
          until,
          reason,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      await load(selected.userId);
      setUntil("");
      setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function pullFromReserve() {
    if (!selected) return;
    if (!confirm(`Вернуть ${labelOf(selected)} из резерва?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/reserve?userId=${encodeURIComponent(selected.userId)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      await load(selected.userId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card journal-card">
      <p className="muted" style={{ marginTop: 0 }}>
        Весь состав BlackBerry: кто в резерве и кто в строю. Можно вручную
        отправить в резерв или вернуть. Действия пишутся в{" "}
        <strong>Журнал действий</strong>. История резервов — справа по игроку.
      </p>

      <div className="journal-toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
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
            checked={onlyReserve}
            onChange={(e) => setOnlyReserve(e.target.checked)}
          />
          <span>Только резерв</span>
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
        В резерве: <strong>{inReserveCount}</strong> · всего в списке BB:{" "}
        <strong>{total}</strong>
        {loading ? " · загрузка…" : ""}
      </p>
      {err ? <p className="form-error">{err}</p> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 1.2fr) minmax(260px, 1fr)",
          gap: 16,
          marginTop: 12,
        }}
      >
        <div
          className="admin-table-wrap"
          style={{ maxHeight: 560, overflow: "auto" }}
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
              {filtered.map((p) => {
                const active = selected?.userId === p.userId;
                return (
                  <tr
                    key={p.userId}
                    onClick={() => void selectPlayer(p)}
                    style={{
                      cursor: "pointer",
                      background: active
                        ? "rgba(255,255,255,0.08)"
                        : p.inReserve
                          ? "rgba(250, 204, 21, 0.08)"
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
                      {p.inReserve ? (
                        <span style={{ color: "#facc15", fontWeight: 700 }}>
                          резерв
                        </span>
                      ) : (
                        <span className="muted">в строю</span>
                      )}
                    </td>
                    <td>{p.enteredLabel || "—"}</td>
                    <td>{p.untilLabel || "—"}</td>
                    <td
                      style={{ maxWidth: 160 }}
                      title={p.reason || undefined}
                    >
                      {p.reason
                        ? p.reason.length > 40
                          ? `${p.reason.slice(0, 40)}…`
                          : p.reason
                        : "—"}
                    </td>
                  </tr>
                );
              })}
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

        <div>
          {!selected ? (
            <p className="muted">Выбери игрока слева</p>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>{labelOf(selected)}</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                {selected.inReserve
                  ? `Сейчас в резерве · ушёл ${selected.enteredLabel || "—"} · до ${selected.untilLabel || "—"}`
                  : "Сейчас в строю"}
              </p>

              {selected.inReserve ? (
                <p style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void pullFromReserve()}
                  >
                    Вернуть из резерва
                  </button>
                </p>
              ) : null}

              <div className="card" style={{ margin: "0 0 14px", padding: 12 }}>
                <h4 style={{ margin: "0 0 8px" }}>
                  {selected.inReserve
                    ? "Продлить / сменить причину (заново в резерв)"
                    : "Отправить в резерв"}
                </h4>
                <label className="field">
                  <span>До какой даты</span>
                  <input
                    type="text"
                    placeholder="ДД.ММ.ГГГГ"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
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
                  onClick={() => void putInReserve()}
                >
                  {selected.inReserve ? "Обновить резерв" : "В резерв"}
                </button>
              </div>

              <h4 style={{ margin: "0 0 8px" }}>История резервов</h4>
              <div
                className="admin-table-wrap"
                style={{ maxHeight: 280, overflow: "auto" }}
              >
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Уход</th>
                      <th>До</th>
                      <th>Выход</th>
                      <th>Кто</th>
                      <th>Причина</th>
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
                      </tr>
                    ))}
                    {!history.length ? (
                      <tr>
                        <td colSpan={5} className="muted">
                          История пуста
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
