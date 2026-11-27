"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type SortKey =
  | "order"
  | "nick"
  | "joined"
  | "value"
  | "avg"
  | "contract"
  | "salary";
type SortDir = "asc" | "desc";

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

function cmpStr(a: string, b: string) {
  return String(a || "").localeCompare(String(b || ""), "ru", {
    sensitivity: "base",
  });
}

function SortTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`xfer-sort${active ? " is-on" : ""}`}
        onClick={onClick}
      >
        {label}
        {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

export function FactionPlayerValuesPanel({ slug }: { slug: string }) {
  const [rows, setRows] = useState<ValueRow[]>([]);
  const [base, setBase] = useState(20_000);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [nickFilter, setNickFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "value",
    dir: "desc",
  });

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

  const nickKey = nickFilter.trim().toLowerCase();

  const sorted = useMemo(() => {
    const filtered = !nickKey
      ? [...rows]
      : rows.filter((r) => r.nick.toLowerCase().includes(nickKey));
    const dir = sort.dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      let c = 0;
      if (sort.key === "nick") c = cmpStr(a.nick, b.nick);
      else if (sort.key === "joined")
        c = new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
      else if (sort.key === "value") c = a.playerValue - b.playerValue;
      else if (sort.key === "avg") c = a.avgPerDay - b.avgPerDay;
      else if (sort.key === "contract")
        c = Number(a.hasContract) - Number(b.hasContract);
      else if (sort.key === "salary") c = a.salaryPct - b.salaryPct;
      else c = a.order - b.order;
      return c * dir || cmpStr(a.nick, b.nick) || cmpStr(a.userId, b.userId);
    });
    return filtered;
  }, [rows, nickKey, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      const descDefault =
        key === "value" || key === "avg" || key === "salary" || key === "order";
      return { key, dir: descDefault ? "desc" : "asc" };
    });
  }

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

      <div className="xfer-nick-filter">
        <label className="xfer-nick-filter-label" htmlFor="faction-values-nick">
          Ник
        </label>
        <input
          id="faction-values-nick"
          className="xfer-nick-filter-input"
          type="search"
          value={nickFilter}
          onChange={(e) => setNickFilter(e.target.value)}
          placeholder="Например Varyag…"
          autoComplete="off"
          spellCheck={false}
        />
        {nickFilter ? (
          <button
            type="button"
            className="xfer-nick-filter-clear"
            onClick={() => setNickFilter("")}
          >
            Сброс
          </button>
        ) : null}
      </div>

      <div className="xfer-table-wrap">
        <table className="xfer-table faction-values-table">
          <thead>
            <tr>
              <SortTh
                label="#"
                active={sort.key === "order"}
                dir={sort.dir}
                onClick={() => toggleSort("order")}
              />
              <SortTh
                label="Ник"
                active={sort.key === "nick"}
                dir={sort.dir}
                onClick={() => toggleSort("nick")}
              />
              <SortTh
                label="Вступил"
                active={sort.key === "joined"}
                dir={sort.dir}
                onClick={() => toggleSort("joined")}
              />
              <SortTh
                label="Стоимость"
                active={sort.key === "value"}
                dir={sort.dir}
                onClick={() => toggleSort("value")}
              />
              <SortTh
                label="Ср. / день"
                active={sort.key === "avg"}
                dir={sort.dir}
                onClick={() => toggleSort("avg")}
              />
              <SortTh
                label="Контракт"
                active={sort.key === "contract"}
                dir={sort.dir}
                onClick={() => toggleSort("contract")}
              />
              <SortTh
                label="ЗП %"
                active={sort.key === "salary"}
                dir={sort.dir}
                onClick={() => toggleSort("salary")}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={r.userId}
                className="xfer-row-click"
                onClick={() => void openDetail(r.userId)}
              >
                <td className="faction-mgmt-roster-num">
                  {sort.key === "order" && !nickKey ? r.order : i + 1}
                </td>
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
            {!sorted.length ? (
              <tr>
                <td colSpan={7} className="muted">
                  {nickKey ? "Нет игроков по этому нику." : "Состав пуст."}
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
