"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CalEvent = {
  id: string;
  mode: string;
  modeLabel: string;
  format: number;
  scheduledAt: string;
  opponentTag: string;
  opponentName: string;
  assignedServer: string | null;
  status: string;
};

type Props = {
  clanId: string;
  clanTag: string;
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

export function ClanCalendarPanel({ clanId, clanTag }: Props) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/clans/${clanId}/calendar`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка загрузки");
        return;
      }
      setEvents(data.events || []);
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }, [clanId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upcoming = useMemo(
    () =>
      events.filter(
        (e) => e.status === "upcoming" || new Date(e.scheduledAt) >= new Date()
      ),
    [events]
  );
  const past = useMemo(
    () =>
      events.filter(
        (e) => e.status !== "upcoming" && new Date(e.scheduledAt) < new Date()
      ),
    [events]
  );

  return (
    <section className="card">
      <h3 className="stats-h3" style={{ marginTop: 0 }}>
        Календарь [{clanTag}]
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Свои КВ этого клана. Появляются после принятия заявки во вкладке
        «Регистрация».
      </p>
      {loading ? <p className="muted">Загрузка…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="muted">Пока пусто — создайте или примите заявку на КВ.</p>
      ) : null}

      {upcoming.length > 0 ? (
        <>
          <h4 className="stats-h3">Предстоящие</h4>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Когда (МСК)</th>
                  <th>Мод</th>
                  <th>Формат</th>
                  <th>Соперник</th>
                  <th>Сервер</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtMsk(e.scheduledAt)}</td>
                    <td>{e.modeLabel}</td>
                    <td>{e.format}</td>
                    <td>
                      [{e.opponentTag}] {e.opponentName}
                    </td>
                    <td>
                      {e.assignedServer || (
                        <span className="muted">после матчмейкинга</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {past.length > 0 ? (
        <>
          <h4 className="stats-h3">Прошедшие</h4>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Когда (МСК)</th>
                  <th>Мод</th>
                  <th>Формат</th>
                  <th>Соперник</th>
                  <th>Сервер</th>
                </tr>
              </thead>
              <tbody>
                {past.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtMsk(e.scheduledAt)}</td>
                    <td>{e.modeLabel}</td>
                    <td>{e.format}</td>
                    <td>
                      [{e.opponentTag}] {e.opponentName}
                    </td>
                    <td>{e.assignedServer || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
