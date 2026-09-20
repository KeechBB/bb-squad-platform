import {
  ATTENDANCE_LABEL,
  attendanceTag,
  formatDurationMinutes,
  formatMskDateTime,
  type AttendanceTag,
} from "@/lib/squadSessions";

export type SessionRow = {
  id: string;
  joinedAt: Date;
  leftAt: Date | null;
  nickAtJoin: string | null;
  serverKey: string;
};

type Props = {
  sessions: SessionRow[];
  minutes30d: number;
  sessions30d: number;
  openNow: boolean;
};

function tagClass(tag: AttendanceTag): string {
  if (tag === "on_time") return "att-tag on-time";
  if (tag === "late_ok") return "att-tag late-ok";
  if (tag === "late") return "att-tag late";
  return "att-tag other";
}

export function TrainingSessionsCard({
  sessions,
  minutes30d,
  sessions30d,
  openNow,
}: Props) {
  return (
    <section className="card training-sessions-card">
      <h2>Тренировки / сервер</h2>
      <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
        Заходы на TPUB1 по логам сервера. Только если аккаунт есть на сайте.
      </p>

      <div className="training-stat-row">
        <div>
          <strong>{sessions30d}</strong>
          <span className="muted">сессий / 30 дн</span>
        </div>
        <div>
          <strong>{minutes30d}</strong>
          <span className="muted">мин / 30 дн</span>
        </div>
        <div>
          <strong>{openNow ? "онлайн" : "—"}</strong>
          <span className="muted">сейчас</span>
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="muted" style={{ marginTop: 14 }}>
          Пока нет зафиксированных заходов. Коллектор логов должен работать.
        </p>
      ) : (
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table training-sessions-table">
            <thead>
              <tr>
                <th>Зашёл (МСК)</th>
                <th>Вышел</th>
                <th>Мин</th>
                <th>Метка</th>
                <th>Ник</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const tag = attendanceTag(s.joinedAt);
                const mins = formatDurationMinutes(s.joinedAt, s.leftAt);
                return (
                  <tr key={s.id}>
                    <td>{formatMskDateTime(s.joinedAt)}</td>
                    <td>
                      {s.leftAt ? formatMskDateTime(s.leftAt) : "на сервере"}
                    </td>
                    <td>{mins}</td>
                    <td>
                      <span className={tagClass(tag)}>
                        {ATTENDANCE_LABEL[tag]}
                      </span>
                    </td>
                    <td>{s.nickAtJoin || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
