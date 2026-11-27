"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BdAmount } from "@/components/BdMark";
import { DraggableModal } from "@/components/DraggableModal";
import { useFitTablePage } from "@/lib/useFitTablePage";
import { FactionTransfers } from "@/components/FactionTransfers";

type HrMember = {
  userId: string;
  nick: string;
  roleName: string;
  mainKit: string;
  playerValue: number;
  salaryPct: number;
  hasActiveContract: boolean;
};

type HrContract = {
  id: string;
  userId: string;
  nick: string;
  steamId: string;
  costBd: number;
  status: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
};

type HrPayout = {
  id: string;
  userId: string;
  nick: string;
  steamId: string;
  windowId: string;
  pct: number;
  grindBd: number;
  paidBd: number;
  createdAt: string;
};

type SelfListInfo = {
  meUserId: string | null;
  personalBd: number;
  marketBd: number;
  enoughBalance: boolean;
  onAuction: boolean;
  lotId: string | null;
  lotKind: string | null;
  contract: { factionName: string; endsAt: string } | null;
};

type SalaryFaction = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  color: string;
};

type SalaryPlayer = {
  userId: string;
  nick: string;
  seat: string;
  salaryPct: number;
  factionId: string;
  factionName: string;
  factionSlug: string;
  factionLogoUrl: string | null;
  factionColor: string;
  canEdit: boolean;
};

type HrPayload = {
  canManage: boolean;
  isKeech?: boolean;
  myFactionId?: string;
  treasury: number;
  salaryPresets: number[];
  selfList?: SelfListInfo | null;
  members: HrMember[];
  salaryFactions?: SalaryFaction[];
  salaryPlayers?: SalaryPlayer[];
  contracts: HrContract[];
  payouts: HrPayout[];
  error?: string;
};

type HrTab = "contracts" | "salaries" | "history" | "players";
type SalarySortKey = "nick" | "faction" | "seat" | "pct";
type SortDir = "asc" | "desc";

const SEAT_RANK: Record<string, number> = {
  LEADER: 0,
  DEPUTY: 1,
  MEMBER: 2,
};

function seatRu(seat: string): string {
  if (seat === "LEADER") return "глава";
  if (seat === "DEPUTY") return "зам";
  return "боец";
}

function cmpStr(a: string, b: string) {
  return String(a || "").localeCompare(String(b || ""), "ru", {
    sensitivity: "base",
  });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusRu(s: string) {
  if (s === "ACTIVE") return "Активен";
  if (s === "EXPIRED") return "Истёк";
  if (s === "CANCELLED") return "Отменён";
  return s;
}

export function FactionHrPanel({
  slug,
  canManage,
}: {
  slug: string;
  canManage: boolean;
}) {
  const [data, setData] = useState<HrPayload | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<HrTab>("contracts");
  const [nickFilter, setNickFilter] = useState("");
  const nickKey = nickFilter.trim().toLowerCase();
  const [salaryNickFilter, setSalaryNickFilter] = useState("");
  const [salaryFactionFilter, setSalaryFactionFilter] = useState<string>("all");
  const [salarySort, setSalarySort] = useState<{
    key: SalarySortKey;
    dir: SortDir;
  }>({ key: "pct", dir: "desc" });
  const [contractBlockOpen, setContractBlockOpen] = useState(false);
  const [balanceBlockOpen, setBalanceBlockOpen] = useState(false);
  const [salaryForeignOpen, setSalaryForeignOpen] = useState(false);
  const [salaryForeignNick, setSalaryForeignNick] = useState("");
  const [selfBusy, setSelfBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/hr`, {
        cache: "no-store",
      });
      const json = (await res.json()) as HrPayload;
      if (!res.ok) {
        setErr(json.error || "Не удалось загрузить");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setErr("Сеть недоступна");
      setData(null);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function selfListToAuction() {
    const sl = data?.selfList;
    if (!sl || sl.onAuction) return;
    if (sl.contract) {
      setContractBlockOpen(true);
      return;
    }
    if (!sl.enoughBalance) {
      setBalanceBlockOpen(true);
      return;
    }
    const ok = window.confirm(
      `Выставить себя на аукцион?\nРыночная стоимость / мин. ставка: ${sl.marketBd.toLocaleString("ru-RU")} B$.\nТы остаёшься во фракции, пока кого-то не купят. При покупке другой фракцией тебе 20% победной ставки на личный B$. Свою фракцию тоже могут выкупить.`,
    );
    if (!ok) return;
    setSelfBusy(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/auction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "self_list" }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        until?: string;
        factionName?: string;
      };
      if (!res.ok) {
        if (json.error === "contract_active") {
          setContractBlockOpen(true);
          return;
        }
        setErr(json.message || json.error || "Не удалось выставить");
        return;
      }
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setSelfBusy(false);
    }
  }

  async function run(op: string, body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/hr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ...body }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = json.error || "Ошибка";
        if (
          op === "set_salary" &&
          /не состоит в вашей фракции/i.test(msg)
        ) {
          setSalaryForeignNick(String(body.nick || ""));
          setSalaryForeignOpen(true);
          return;
        }
        setErr(msg);
        return;
      }
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  function trySetSalary(player: SalaryPlayer, pct: number) {
    const myId = data?.myFactionId;
    const keech = Boolean(data?.isKeech);
    if (!keech && myId && player.factionId !== myId) {
      setSalaryForeignNick(player.nick);
      setSalaryForeignOpen(true);
      return;
    }
    void run("set_salary", {
      userId: player.userId,
      factionId: player.factionId,
      pct,
      nick: player.nick,
    });
  }

  const salaryFactions = data?.salaryFactions || [];
  const filteredSalaryPlayers = useMemo(() => {
    const q = salaryNickFilter.trim().toLowerCase();
    const rows = (data?.salaryPlayers || []).filter((p) => {
      if (salaryFactionFilter !== "all" && p.factionId !== salaryFactionFilter) {
        return false;
      }
      if (!q) return true;
      return (
        p.nick.toLowerCase().includes(q) ||
        p.factionName.toLowerCase().includes(q)
      );
    });
    const dir = salarySort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let c = 0;
      if (salarySort.key === "nick") c = cmpStr(a.nick, b.nick);
      else if (salarySort.key === "faction")
        c = cmpStr(a.factionName, b.factionName) || cmpStr(a.nick, b.nick);
      else if (salarySort.key === "seat")
        c =
          (SEAT_RANK[a.seat] ?? 9) - (SEAT_RANK[b.seat] ?? 9) ||
          cmpStr(a.nick, b.nick);
      else c = a.salaryPct - b.salaryPct || cmpStr(a.nick, b.nick);
      return c * dir;
    });
  }, [
    data?.salaryPlayers,
    salaryNickFilter,
    salaryFactionFilter,
    salarySort,
  ]);

  function toggleSalarySort(key: SalarySortKey) {
    setSalarySort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "nick" || key === "faction" ? "asc" : "desc" },
    );
  }

  const payoutsFiltered = useMemo(() => {
    const rows = data?.payouts ?? [];
    if (!nickKey) return rows;
    return rows.filter(
      (p) =>
        p.nick.toLowerCase().includes(nickKey) ||
        p.steamId.toLowerCase().includes(nickKey) ||
        p.userId.toLowerCase().includes(nickKey),
    );
  }, [data?.payouts, nickKey]);

  const histPage = useFitTablePage(
    payoutsFiltered.length,
    Boolean(data) && tab === "history",
  );
  useEffect(() => {
    histPage.setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nickKey]);

  const histVisible = payoutsFiltered.slice(
    histPage.safePage * histPage.pageSize,
    histPage.safePage * histPage.pageSize + histPage.pageSize,
  );

  if (!data && !err) {
    return <p className="muted">Загрузка контрактов и зарплат…</p>;
  }
  if (!data) {
    return <p className="error">{err || "Нет данных"}</p>;
  }

  const presets = data.salaryPresets?.length
    ? data.salaryPresets
    : [10, 20, 30, 40, 50, 60, 70];
  const manage = canManage && data.canManage;
  const selfList = data.selfList || null;

  return (
    <div className="faction-hr">
      <div className="faction-hr-head">
        <div>
          <h3 className="xfer-title">Контракты и зарплаты</h3>
          <p className="muted xfer-sub">
            Казна:{" "}
            <strong>
              <BdAmount n={data.treasury} />
            </strong>
            {" · "}
            контракт = бронь на 30 календарных дней (стоимость игрока)
            {" · "}
            20% стоимости → личный B$ игрока + письмо от фракции
            {" · "}
            ЗП % от гринда — в 01:00 или при ручном закрытии ночи
            {" · "}
            сам на аукцион: личный B$ ≥ рыночной стоимости (без контракта)
          </p>
        </div>
      </div>

      <div className="admin-tabs clan-tabs xfer-subtabs" role="tablist">
        <button
          type="button"
          className={`admin-tab${tab === "contracts" ? " active" : ""}`}
          onClick={() => setTab("contracts")}
        >
          Контракты
        </button>
        <button
          type="button"
          className={`admin-tab${tab === "salaries" ? " active" : ""}`}
          onClick={() => setTab("salaries")}
        >
          Зарплаты %
          {data?.salaryPlayers?.length
            ? ` (${data.salaryPlayers.length})`
            : ""}
        </button>
        <button
          type="button"
          className={`admin-tab${tab === "history" ? " active" : ""}`}
          onClick={() => setTab("history")}
        >
          История выплат
        </button>
        <button
          type="button"
          className={`admin-tab${tab === "players" ? " active" : ""}`}
          onClick={() => setTab("players")}
        >
          Заработок игроков
        </button>
      </div>

      {err ? <p className="xfer-err">{err}</p> : null}

      {tab === "contracts" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-table-wrap">
            <table className="xfer-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Стоимость</th>
                  <th>Контракт</th>
                  <th>До</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => {
                  const active = data.contracts.find(
                    (c) => c.userId === m.userId && c.status === "ACTIVE",
                  );
                  const isMe = Boolean(
                    selfList?.meUserId && selfList.meUserId === m.userId,
                  );
                  return (
                    <tr key={m.userId}>
                      <td>
                        <strong className="xfer-nick">{m.nick}</strong>
                      </td>
                      <td>
                        <BdAmount n={m.playerValue} />
                      </td>
                      <td>
                        {active ? (
                          <span className="xfer-pill is-buy">Активен</span>
                        ) : (
                          <span className="muted">нет</span>
                        )}
                      </td>
                      <td className="muted">
                        {active ? fmtDate(active.endsAt) : "—"}
                      </td>
                      <td>
                        <div className="faction-hr-actions">
                          {manage ? (
                            active ? (
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() =>
                                  void run("cancel_contract", {
                                    contractId: active.id,
                                  })
                                }
                              >
                                Снять
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn primary"
                                disabled={busy}
                                onClick={() => {
                                  const cut = Math.floor(m.playerValue * 0.2);
                                  const ok = window.confirm(
                                    `Подписать контракт с ${m.nick} на 30 календарных дней?\nС казны спишется ${m.playerValue.toLocaleString("ru-RU")} B$ (оценка игрока).\nИгроку на личный баланс: ${cut.toLocaleString("ru-RU")} B$ (20%) + письмо от фракции.\nДо конца срока игрок не сможет выйти за свои B$.`,
                                  );
                                  if (!ok) return;
                                  void run("sign_contract", {
                                    userId: m.userId,
                                  });
                                }}
                              >
                                Подписать
                              </button>
                            )
                          ) : null}
                          {isMe ? (
                            selfList?.onAuction ? (
                              <span className="xfer-pill is-sell">на аукционе</span>
                            ) : (
                              <button
                                type="button"
                                className="btn"
                                disabled={selfBusy}
                                title={
                                  selfList?.contract
                                    ? "Контракт блокирует самовыставление"
                                    : selfList?.enoughBalance
                                      ? "Выставить себя на аукцион"
                                      : "Нужен личный B$ ≥ рыночной стоимости"
                                }
                                onClick={() => void selfListToAuction()}
                              >
                                На аукцион
                              </button>
                            )
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h4 className="faction-hr-sub">История контрактов</h4>
          <div className="xfer-table-wrap">
            <table className="xfer-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Статус</th>
                  <th>Цена</th>
                  <th>С</th>
                  <th>До</th>
                </tr>
              </thead>
              <tbody>
                {data.contracts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong className="xfer-nick">{c.nick}</strong>
                    </td>
                    <td>{statusRu(c.status)}</td>
                    <td>
                      <BdAmount n={c.costBd} />
                    </td>
                    <td className="muted">{fmtDate(c.startsAt)}</td>
                    <td className="muted">{fmtDate(c.endsAt)}</td>
                  </tr>
                ))}
                {!data.contracts.length ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Контрактов пока нет.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "salaries" ? (
        <div className="xfer-tab-body xfer-tables faction-hr-salaries">
          <p className="muted faction-hr-hint">
            Все игроки пятёрки и Легиона. Пресет % от гринда за ночное окно →
            личный B$ в 01:00 МСК (с казны фракции игрока). Глава и зам ставят
            ЗП только своим; чужая фракция — заглушка «не состоит в вашей
            фракции»{data.isKeech ? " · Keech может любой" : ""}.
          </p>
          <div className="faction-balances-filters">
            <div className="xfer-nick-filter">
              <label className="xfer-nick-filter-label" htmlFor="hr-sal-nick">
                Поиск
              </label>
              <input
                id="hr-sal-nick"
                className="xfer-nick-filter-input"
                type="search"
                value={salaryNickFilter}
                onChange={(e) => setSalaryNickFilter(e.target.value)}
                placeholder="Ник…"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="xfer-nick-filter">
              <label className="xfer-nick-filter-label" htmlFor="hr-sal-faction">
                Фракция
              </label>
              <select
                id="hr-sal-faction"
                className="xfer-nick-filter-input faction-balances-faction-select"
                value={salaryFactionFilter}
                onChange={(e) => setSalaryFactionFilter(e.target.value)}
              >
                <option value="all">Все фракции</option>
                {salaryFactions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div
            className="faction-balances-faction-chips"
            role="group"
            aria-label="Быстрый фильтр фракции"
          >
            <button
              type="button"
              className={`faction-balances-chip${
                salaryFactionFilter === "all" ? " is-on" : ""
              }`}
              onClick={() => setSalaryFactionFilter("all")}
            >
              Все
            </button>
            {salaryFactions.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`faction-balances-chip${
                  salaryFactionFilter === f.id ? " is-on" : ""
                }`}
                style={{ ["--fb-accent" as string]: f.color }}
                onClick={() => setSalaryFactionFilter(f.id)}
              >
                <span
                  className="faction-balances-logo"
                  style={{
                    width: 18,
                    height: 18,
                    boxShadow: `0 0 0 2px ${f.color}55`,
                  }}
                >
                  {f.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.logoUrl} alt="" width={18} height={18} />
                  ) : (
                    <span style={{ color: f.color }}>{f.name.slice(0, 1)}</span>
                  )}
                </span>
                {f.name}
              </button>
            ))}
          </div>
          <div className="xfer-table-wrap">
            <table className="xfer-table faction-balances-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className={`xfer-sort${
                        salarySort.key === "nick" ? " is-on" : ""
                      }`}
                      onClick={() => toggleSalarySort("nick")}
                    >
                      Игрок
                      {salarySort.key === "nick"
                        ? salarySort.dir === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`xfer-sort${
                        salarySort.key === "faction" ? " is-on" : ""
                      }`}
                      onClick={() => toggleSalarySort("faction")}
                    >
                      Фракция
                      {salarySort.key === "faction"
                        ? salarySort.dir === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`xfer-sort${
                        salarySort.key === "seat" ? " is-on" : ""
                      }`}
                      onClick={() => toggleSalarySort("seat")}
                    >
                      Роль
                      {salarySort.key === "seat"
                        ? salarySort.dir === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`xfer-sort${
                        salarySort.key === "pct" ? " is-on" : ""
                      }`}
                      onClick={() => toggleSalarySort("pct")}
                    >
                      Сейчас
                      {salarySort.key === "pct"
                        ? salarySort.dir === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </button>
                  </th>
                  <th>Пресет</th>
                </tr>
              </thead>
              <tbody>
                {filteredSalaryPlayers.map((m) => (
                  <tr key={`${m.factionId}:${m.userId}`}>
                    <td>
                      <strong className="xfer-nick">{m.nick}</strong>
                    </td>
                    <td>
                      <span className="faction-balances-player-fac">
                        <span
                          className="faction-balances-logo"
                          style={{
                            width: 28,
                            height: 28,
                            boxShadow: `0 0 0 2px ${m.factionColor}55`,
                          }}
                        >
                          {m.factionLogoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.factionLogoUrl}
                              alt=""
                              width={28}
                              height={28}
                            />
                          ) : (
                            <span style={{ color: m.factionColor }}>
                              {m.factionName.slice(0, 1)}
                            </span>
                          )}
                        </span>
                        <span style={{ color: m.factionColor }}>
                          {m.factionName}
                        </span>
                      </span>
                    </td>
                    <td className="muted">{seatRu(m.seat)}</td>
                    <td>
                      {m.salaryPct > 0 ? (
                        <strong>{m.salaryPct}%</strong>
                      ) : (
                        <span className="muted">выкл</span>
                      )}
                    </td>
                    <td>
                      {manage ? (
                        <div className="faction-hr-pct-row">
                          <button
                            type="button"
                            className={`faction-hr-pct${
                              m.salaryPct === 0 ? " is-on" : ""
                            }`}
                            disabled={busy}
                            onClick={() => trySetSalary(m, 0)}
                          >
                            0
                          </button>
                          {presets.map((p) => (
                            <button
                              key={p}
                              type="button"
                              className={`faction-hr-pct${
                                m.salaryPct === p ? " is-on" : ""
                              }`}
                              disabled={busy}
                              onClick={() => trySetSalary(m, p)}
                            >
                              {p}%
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">только штаб</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredSalaryPlayers.length ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Никого не найдено.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-nick-filter">
            <label className="xfer-nick-filter-label" htmlFor="hr-payout-nick">
              Ник / Steam ID
            </label>
            <input
              id="hr-payout-nick"
              className="xfer-nick-filter-input"
              type="search"
              value={nickFilter}
              onChange={(e) => setNickFilter(e.target.value)}
              placeholder="Например Bahus или 7656119…"
              autoComplete="off"
              spellCheck={false}
            />
            {nickKey ? (
              <button
                type="button"
                className="xfer-nick-filter-clear"
                onClick={() => setNickFilter("")}
              >
                Сброс
              </button>
            ) : null}
          </div>
          <div className="xfer-fit" ref={histPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Игрок</th>
                    <th>Steam</th>
                    <th>%</th>
                    <th>Гринд</th>
                    <th>Выплачено</th>
                    <th>Ночь</th>
                  </tr>
                </thead>
                <tbody>
                  {histVisible.map((p) => (
                    <tr key={p.id}>
                      <td className="muted">{fmtWhen(p.createdAt)}</td>
                      <td>
                        <strong className="xfer-nick">{p.nick}</strong>
                      </td>
                      <td className="muted">{p.steamId || "—"}</td>
                      <td>{p.pct}%</td>
                      <td>
                        <BdAmount n={p.grindBd} />
                      </td>
                      <td className="is-plus">
                        <BdAmount n={p.paidBd} />
                      </td>
                      <td className="muted">{p.windowId}</td>
                    </tr>
                  ))}
                  {!payoutsFiltered.length ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        {nickKey
                          ? "Нет выплат по фильтру."
                          : "Выплат пока нет."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          {histPage.pageCount > 1 ? (
            <div className="faction-roster-pager xfer-pager">
              <button
                type="button"
                className="btn"
                disabled={histPage.safePage <= 0}
                onClick={histPage.goPrev}
              >
                Назад
              </button>
              <span className="muted">
                стр. {histPage.safePage + 1}/{histPage.pageCount}
              </span>
              <button
                type="button"
                className="btn"
                disabled={histPage.safePage >= histPage.pageCount - 1}
                onClick={histPage.goNext}
              >
                Дальше
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "players" ? (
        <div className="xfer-tab-body faction-hr-players">
          <p className="muted faction-hr-hint">
            Сколько B$ игроки принесли гриндом в казны. Фильтр по фракции и нику.
          </p>
          <FactionTransfers slug={slug} canManage={canManage} scope="playerEarn" />
        </div>
      ) : null}

      {contractBlockOpen && selfList?.contract ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => setContractBlockOpen(false)}
        >
          <header
            className="profile-match-modal-head"
            data-drag-handle
            title="Перетащить окно"
          >
            <div>
              <h2 className="profile-mail-modal-title">Контракт активен</h2>
              <p className="muted">Самовыставление на аукцион недоступно</p>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => setContractBlockOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="profile-match-modal-body">
            <p>
              У вас контракт с фракцией{" "}
              <strong>«{selfList.contract.factionName}»</strong> до{" "}
              <strong>{fmtDate(selfList.contract.endsAt)}</strong>.
            </p>
            <p className="muted">
              Пока контракт жив, себя на аукцион выставить нельзя. После окончания
              срока (или если штаб снимет контракт) кнопка снова заработает, если
              на личном балансе хватает рыночной стоимости.
            </p>
            <div className="clan-invite-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => setContractBlockOpen(false)}
              >
                Понятно
              </button>
            </div>
          </div>
        </DraggableModal>
      ) : null}

      {balanceBlockOpen && selfList ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => setBalanceBlockOpen(false)}
        >
          <header
            className="profile-match-modal-head"
            data-drag-handle
            title="Перетащить окно"
          >
            <div>
              <h2 className="profile-mail-modal-title">Мало B$ на кошельке</h2>
              <p className="muted">Нужна рыночная стоимость</p>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => setBalanceBlockOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="profile-match-modal-body">
            <p>
              Чтобы выставить себя на аукцион, на личном балансе нужно не меньше
              рыночной стоимости:{" "}
              <strong>
                <BdAmount n={selfList.marketBd} />
              </strong>
              . Сейчас у вас{" "}
              <strong>
                <BdAmount n={selfList.personalBd} />
              </strong>
              .
            </p>
            <p className="muted">
              Не хватает{" "}
              {(
                Math.max(0, selfList.marketBd - selfList.personalBd)
              ).toLocaleString("ru-RU")}{" "}
              B$. Копите гриндом / ЗП / долями — кнопка всегда на месте.
            </p>
            <div className="clan-invite-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => setBalanceBlockOpen(false)}
              >
                Понятно
              </button>
            </div>
          </div>
        </DraggableModal>
      ) : null}

      {salaryForeignOpen ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => setSalaryForeignOpen(false)}
        >
          <header
            className="profile-match-modal-head"
            data-drag-handle
            title="Перетащить окно"
          >
            <div>
              <h2 className="profile-mail-modal-title">Чужая фракция</h2>
              <p className="muted">Зарплату ставить нельзя</p>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => setSalaryForeignOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="profile-match-modal-body">
            <p>
              {salaryForeignNick ? (
                <>
                  Игрок <strong className="xfer-nick">{salaryForeignNick}</strong>{" "}
                  не состоит в вашей фракции.
                </>
              ) : (
                <>Игрок не состоит в вашей фракции.</>
              )}
            </p>
            <p className="muted">
              Глава и зам назначают % только своим бойцам. ЗП чужой фракции
              трогать нельзя.
            </p>
            <div className="clan-invite-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => setSalaryForeignOpen(false)}
              >
                Понятно
              </button>
            </div>
          </div>
        </DraggableModal>
      ) : null}
    </div>
  );
}
