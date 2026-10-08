"use client";

import { useCallback, useEffect, useState } from "react";
import { CW_MODES, CW_SERVER_POOL_NOTE } from "@/lib/cwChallenge";

type ChallengeRow = {
  id: string;
  mode: string;
  format: number;
  scheduledAt: string;
  assignedServer: string | null;
  status: string;
  challenger: { id: string; tag: string; name: string; logoUrl: string | null };
  acceptor: { id: string; tag: string; name: string; logoUrl: string | null } | null;
  createdByNick: string | null;
};

type Props = {
  clanId: string;
  canManage: boolean;
};

function fmtMsk(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function modeLabel(mode: string) {
  return CW_MODES.find((m) => m.id === mode)?.label || mode;
}

export function ClanCwRegistrationPanel({ clanId, canManage }: Props) {
  const [rows, setRows] = useState<ChallengeRow[]>([]);
  const [myClanId, setMyClanId] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("HOTDROP");
  const [format, setFormat] = useState(40);
  const [scheduledLocal, setScheduledLocal] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/cw-challenges", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка загрузки");
        return;
      }
      setRows(data.challenges || []);
      setMyClanId(data.myClanId || null);
      setCanCreate(Boolean(data.canManage));
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createChallenge(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !canCreate) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cw-challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          format: Number(format),
          scheduledAt: scheduledLocal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Не удалось создать");
        return;
      }
      setShowForm(false);
      await load();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function acceptChallenge(id: string) {
    if (!canManage || !canCreate) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/cw-challenges/${id}/accept`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Не удалось принять");
        return;
      }
      await load();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  const onThisClanPage = myClanId === clanId;

  return (
    <section className="card">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h3 className="stats-h3" style={{ marginTop: 0, marginBottom: 4 }}>
            Регистрация на КВ
          </h3>
          <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
            {CW_SERVER_POOL_NOTE}
          </p>
        </div>
        {canManage && canCreate && onThisClanPage ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Скрыть форму" : "Создать заявку на КВ"}
          </button>
        ) : null}
      </div>

      {!canManage || !canCreate ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Создавать и принимать заявки могут только глава или заместитель
          главы своего клана.
        </p>
      ) : null}

      {showForm && canManage && canCreate && onThisClanPage ? (
        <form className="form" style={{ marginTop: 16 }} onSubmit={createChallenge}>
          <label className="field">
            <span>Мод</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              required
            >
              {CW_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Формат (игроков с вашей стороны)</span>
            <input
              type="number"
              min={1}
              max={80}
              value={format}
              onChange={(e) => setFormat(Number(e.target.value))}
              required
            />
          </label>
          <label className="field">
            <span>Дата и время (МСК)</span>
            <input
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
              required
            />
          </label>
          <p className="field-hint">
            Сервер не выбирается здесь — назначается после нахождения матча
            (приоритет TR2 → TR5, затем FCL ARENA 2–4).
          </p>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Создаём…" : "Опубликовать заявку"}
          </button>
        </form>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Загрузка…</p> : null}

      {!loading ? (
        <div className="admin-table-wrap" style={{ marginTop: 16 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Статус</th>
                <th>Клан</th>
                <th>Мод</th>
                <th>Формат</th>
                <th>Когда (МСК)</th>
                <th>Сервер</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Заявок пока нет.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isMine = r.challenger.id === myClanId;
                  const canAccept =
                    canManage &&
                    canCreate &&
                    r.status === "OPEN" &&
                    !isMine &&
                    myClanId != null;
                  return (
                    <tr key={r.id}>
                      <td>
                        {r.status === "OPEN"
                          ? "Открыта"
                          : r.status === "ACCEPTED"
                            ? "Принята"
                            : r.status}
                      </td>
                      <td>
                        [{r.challenger.tag}] {r.challenger.name}
                        {r.acceptor ? (
                          <>
                            {" "}
                            vs [{r.acceptor.tag}]
                          </>
                        ) : null}
                      </td>
                      <td>{modeLabel(r.mode)}</td>
                      <td>{r.format}</td>
                      <td>{fmtMsk(r.scheduledAt)}</td>
                      <td>
                        {r.assignedServer || (
                          <span className="muted">после матчмейкинга</span>
                        )}
                      </td>
                      <td>
                        {canAccept ? (
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy}
                            onClick={() => void acceptChallenge(r.id)}
                          >
                            Принять вызов
                          </button>
                        ) : isMine && r.status === "OPEN" ? (
                          <span className="muted">ваша заявка</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
