"use client";

import { useCallback, useEffect, useState } from "react";
import { BdAmount } from "@/components/BdMark";

type ValueRow = {
  order: number;
  userId: string;
  nick: string;
  joinedAt: string;
  playerValue: number;
  base: number;
  grindBroughtBd: number;
  avgPerDay: number;
  daysInFaction: number;
  hasContract: boolean;
  salaryPct: number;
};

type DayRow = { day: string; amount: number };

type DetailPayload = {
  userId: string;
  nick: string;
  base: number;
  grindBroughtBd: number;
  playerValue: number;
  days: DayRow[];
};

function fmtJoined(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDay(ymd: string) {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

export function FactionPlayerValuesPanel({ slug }: { slug: string }) {
  const [rows, setRows] = useState<ValueRow[]>([]);
  const [base, setBase] = useState(20_000);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/player-values`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        error?: string;
        base?: number;
        rows?: ValueRow[];
      };
      if (!res.ok) {
        setErr(json.error || "Не удалось загрузить");
        setRows([]);
        return;
      }
      setBase(json.base ?? 20_000);
      setRows(json.rows || []);
    } catch {
      setErr("Сеть недоступна");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(userId: string) {
    setDetailLoading(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/player-values?userId=${encodeURIComponent(userId)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as DetailPayload & { error?: string };
      if (!res.ok) {
        setErr(json.error || "Не удалось загрузить детали");
        return;
      }
      setDetail(json);
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setDetailLoading(false);
    }
  }

  if (loading && !rows.length) {
    return <p className="muted">Загрузка стоимости игроков…</p>;
  }

  return (
    <div className="faction-values">
      <div className="faction-values-head">
        <h3 className="xfer-title">Стоимость игроков</h3>
        <p className="muted xfer-sub">
          Формула: <strong>{base.toLocaleString("ru-RU")}</strong> + весь гринд в
          казну. Кликни строку — заработок по дням.
        </p>
      </div>
      {err ? <p className="xfer-err">{err}</p> : null}

      <div className="xfer-table-wrap">
        <table className="xfer-table faction-values-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Ник</th>
              <th>Вступил</th>
              <th>Стоимость</th>
              <th>Ср. / день</th>
              <th>Контракт</th>
              <th>ЗП %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.userId}
                className="xfer-row-click"
                onClick={() => void openDetail(r.userId)}
              >
                <td className="faction-mgmt-roster-num">{r.order}</td>
                <td>
                  <strong className="xfer-nick">{r.nick}</strong>
                </td>
                <td className="muted">{fmtJoined(r.joinedAt)}</td>
                <td>
                  <BdAmount n={r.playerValue} />
                </td>
                <td className="is-plus">
                  <BdAmount n={r.avgPerDay} />
                </td>
                <td>
                  {r.hasContract ? (
                    <span className="xfer-pill is-buy">да</span>
                  ) : (
                    <span className="muted">нет</span>
                  )}
                </td>
                <td>
                  {r.salaryPct > 0 ? (
                    <strong>{r.salaryPct}%</strong>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="muted">
                  Состав пуст.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {detailLoading ? <p className="muted">Загрузка дней…</p> : null}

      {detail ? (
        <div
          className="profile-match-modal"
          role="presentation"
          onClick={() => setDetail(null)}
        >
          <div className="profile-match-modal-backdrop" />
          <div
            className="profile-match-modal-panel faction-values-detail"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="profile-match-modal-head">
              <div>
                <h3>
                  <span className="xfer-nick">{detail.nick}</span>
                </h3>
                <p className="profile-match-modal-sub muted">
                  Стоимость <BdAmount n={detail.playerValue} />
                  {" · "}
                  база {detail.base.toLocaleString("ru-RU")} + гринд{" "}
                  <BdAmount n={detail.grindBroughtBd} />
                </p>
              </div>
              <button
                type="button"
                className="profile-match-modal-close"
                onClick={() => setDetail(null)}
              >
                ×
              </button>
            </header>
            <div className="profile-match-modal-body">
              <div className="xfer-table-wrap">
                <table className="xfer-table">
                  <thead>
                    <tr>
                      <th>День (МСК)</th>
                      <th>Заработок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.days.map((d) => (
                      <tr key={d.day}>
                        <td>{fmtDay(d.day)}</td>
                        <td className="is-plus">
                          <BdAmount n={d.amount} />
                        </td>
                      </tr>
                    ))}
                    {!detail.days.length ? (
                      <tr>
                        <td colSpan={2} className="muted">
                          Пока нет гринда по дням.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
