import {
  ATTENDANCE_LABEL,
  attendanceTag,
  formatDurationMinutes,
  formatMskDateTime,
  mskParts,
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

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function tagClass(tag: AttendanceTag): string {
  if (tag === "on_time") return "att-tag on-time";
  if (tag === "late_ok") return "att-tag late-ok";
  if (tag === "late") return "att-tag late";
  return "att-tag other";
}

/** JS getUTCDay mapped via MSK weekday: Mon=0 … Sun=6 */
function mskWeekdayIndex(d: Date): number {
  const p = mskParts(d);
  const utcish = Date.UTC(p.y, p.m - 1, p.day);
  const dow = new Date(utcish).getUTCDay(); // 0 Sun
  return dow === 0 ? 6 : dow - 1;
}

function buildCharts(sessions: SessionRow[]) {
  const weekday = WEEKDAYS.map((label) => ({ label, count: 0, minutes: 0 }));
  let totalMin = 0;
  for (const s of sessions) {
    const mins = formatDurationMinutes(s.joinedAt, s.leftAt);
    totalMin += mins;
    const wi = mskWeekdayIndex(s.joinedAt);
    weekday[wi].count += 1;
    weekday[wi].minutes += mins;
  }
  const avgMin =
    sessions.length > 0 ? Math.round(totalMin / sessions.length) : 0;
  const maxDay = Math.max(1, ...weekday.map((d) => d.count));
  return { weekday, avgMin, maxDay, totalMin };
}

export function TrainingSessionsCard({
  sessions,
  minutes30d,
  sessions30d,
  openNow,
}: Props) {
  const monthSessions = sessions.slice(0, 60);
  const charts = buildCharts(
    sessions.filter(
      (s) => s.joinedAt.getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000
    )
  );

  return (
    <section className="card training-sessions-card">
      <h2>Посещаемость тренировок</h2>
      <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
        Заходы на TPUB1 за последний месяц: время входа/выхода и сводка.
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
          <strong>{charts.avgMin || "—"}</strong>
          <span className="muted">сред. мин / сессия</span>
        </div>
        <div>
          <strong>{openNow ? "онлайн" : "—"}</strong>
          <span className="muted">сейчас</span>
        </div>
      </div>

      <div className="training-charts">
        <div className="training-chart-block">
          <h3>По дням недели</h3>
          <div className="training-bars" aria-label="Заходы по дням недели">
            {charts.weekday.map((d) => (
              <div key={d.label} className="training-bar-col">
                <div className="training-bar-track">
                  <div
                    className="training-bar-fill"
                    style={{
                      height: `${Math.round((100 * d.count) / charts.maxDay)}%`,
                    }}
                    title={`${d.count} сессий · ${d.minutes} мин`}
                  />
                </div>
                <span>{d.label}</span>
                <strong>{d.count}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="training-chart-block">
          <h3>Среднее время на сервере</h3>
          <p className="training-avg-big">
            {charts.avgMin > 0 ? (
              <>
                <strong>{charts.avgMin}</strong>
                <span>мин за заход</span>
              </>
            ) : (
              <span className="muted">Пока мало данных</span>
            )}
          </p>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
            Сумма за 30 дней: {charts.totalMin} мин · {sessions30d} заходов
          </p>
        </div>
      </div>

      {monthSessions.length === 0 ? (
        <p className="muted" style={{ marginTop: 14 }}>
          Пока нет зафиксированных заходов. Коллектор логов должен работать.
        </p>
      ) : (
        <div className="admin-table-wrap" style={{ marginTop: 14 }}>
          <table className="admin-table training-sessions-table">
            <thead>
              <tr>
                <th>Зашёл (МСК)</th>
                <th>Вышел</th>
                <th>Мин</th>
                <th>Метка</th>
                <th>Ник на сервере</th>
              </tr>
            </thead>
            <tbody>
              {monthSessions.map((s) => {
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
