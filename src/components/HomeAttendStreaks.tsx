"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { AttendanceStreakRow } from "@/lib/attendanceStreaks";

type Board = {
  registered: number;
  anchorYmd: string;
  top10: AttendanceStreakRow[];
  updatedAt: string;
};

type Props = {
  initial: Board;
};

function emptyBoard(): Board {
  return {
    registered: 0,
    anchorYmd: "",
    top10: [],
    updatedAt: new Date().toISOString(),
  };
}

export function HomeAttendStreaks({ initial }: Props) {
  const [data, setData] = useState<Board>(initial || emptyBoard());
  const [pulse, setPulse] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/home-attendance-streaks", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const next = (await res.json()) as Board;
      setData(next);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 700);
    } catch {
      /* keep previous */
    }
  }, []);

  useAutoRefresh(refresh, { intervalMs: 60_000 });

  useEffect(() => {
    setData(initial || emptyBoard());
  }, [initial]);

  const rows = data.top10 || [];

  return (
    <div
      className={`home-attend-streaks${pulse ? " home-attend-streaks-pulse" : ""}`}
      aria-label="Топ стриков посещаемости тренировок"
    >
      <div className="home-attend-streaks-head">
        <p className="home-attend-streaks-title">Стрик явки · ТОП 10</p>
        <p className="home-attend-streaks-sub muted">
          Дней подряд на TR1 · обновляется само
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="home-attend-streaks-empty muted">Пока нет серий</p>
      ) : (
        <ol className="home-attend-streaks-list">
          {rows.map((r, i) => (
            <li key={r.userId || r.nick} className="home-attend-streaks-row">
              <span className="home-attend-streaks-rank">{i + 1}</span>
              <Link
                className="home-attend-streaks-nick"
                href={`/players/${encodeURIComponent(r.nick)}`}
                title={r.nick}
              >
                {r.nick}
              </Link>
              <span className="home-attend-streaks-days">
                <b>{r.attendStreak}</b>
                <span>дн</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
