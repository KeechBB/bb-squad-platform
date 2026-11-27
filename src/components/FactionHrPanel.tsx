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

type HrPayload = {
  canManage: boolean;
  treasury: number;
  salaryPresets: number[];
  selfList?: SelfListInfo | null;
  members: HrMember[];
  contracts: HrContract[];
  payouts: HrPayout[];
  error?: string;
};

type HrTab = "contracts" | "salaries" | "history" | "players";

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
  const [contractBlockOpen, setContractBlockOpen] = useState(false);
  const [balanceBlockOpen, setBalanceBlockOpen] = useState(false);
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
        setErr(json.error || "Ошибка");
        return;
      }
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(false);
    }
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
        <div className="xfer-tab-body xfer-tables">
          <p className="muted faction-hr-hint">
            Пресет % от гринда игрока за ночное окно. Выплата на личный B$ в 01:00
            МСК (или раньше, если ночь закрыли вручную). Деньги списываются с
            казны фракции.
          </p>
          <div className="xfer-table-wrap">
            <table className="xfer-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Сейчас</th>
                  <th>Пресет</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.userId}>
                    <td>
                      <strong className="xfer-nick">{m.nick}</strong>
                    </td>
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
                            className={`faction-hr-pct${m.salaryPct === 0 ? " is-on" : ""}`}
                            disabled={busy}
                            onClick={() =>
                              void run("set_salary", { userId: m.userId, pct: 0 })
                            }
                          >
                            0
                          </button>
                          {presets.map((p) => (
                            <button
                              key={p}
                              type="button"
                              className={`faction-hr-pct${m.salaryPct === p ? " is-on" : ""}`}
                              disabled={busy}
                              onClick={() =>
                                void run("set_salary", {
                                  userId: m.userId,
                                  pct: p,
                                })
                              }
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
    </div>
  );
}
