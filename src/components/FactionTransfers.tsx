"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BdAmount } from "@/components/BdMark";
import { DraggableModal } from "@/components/DraggableModal";
import { useFitTablePage } from "@/lib/useFitTablePage";

type XferSubTab = "desk" | "ledger" | "market" | "closed";

function xferSubTabKey(slug: string, staff: boolean) {
  return `bb-xfer-subtab:${slug}:${staff ? "staff" : "member"}`;
}

function normalizeXferSubTab(v: string | null, staff: boolean): XferSubTab | null {
  if (!v) return null;
  if (v === "deals") return "market"; // старое имя вкладки
  if (staff && (v === "desk" || v === "ledger" || v === "market" || v === "closed")) return v;
  if (!staff && (v === "ledger" || v === "market" || v === "closed")) return v;
  return null;
}

function readXferSubTab(slug: string, staff: boolean): XferSubTab {
  const fallback: XferSubTab = staff ? "desk" : "ledger";
  if (typeof window === "undefined") return fallback;
  try {
    return normalizeXferSubTab(window.localStorage.getItem(xferSubTabKey(slug, staff)), staff) || fallback;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeXferSubTab(slug: string, staff: boolean, tab: XferSubTab) {
  try {
    window.localStorage.setItem(xferSubTabKey(slug, staff), tab);
  } catch {
    /* ignore */
  }
}

function XferPager({
  page,
  total,
}: {
  page: ReturnType<typeof useFitTablePage>;
  total: number;
}) {
  if (page.pageCount <= 1) return null;
  const from = total === 0 ? 0 : page.safePage * page.pageSize + 1;
  const to = Math.min(total, (page.safePage + 1) * page.pageSize);
  return (
    <div className="faction-roster-pager xfer-pager">
      <button type="button" className="btn" disabled={page.safePage <= 0} onClick={page.goPrev}>
        Назад
      </button>
      <span className="muted">
        {from}–{to} / {total} · стр. {page.safePage + 1}/{page.pageCount}
      </span>
      <button
        type="button"
        className="btn"
        disabled={page.safePage >= page.pageCount - 1}
        onClick={page.goNext}
      >
        Дальше
      </button>
    </div>
  );
}

type ScarcityRow = {
  kitKey: string;
  label: string;
  count: number;
  level: string;
  hint: string;
};

type PlayerStats = {
  trainDays14: number;
  matches30: number;
  kills30: number;
  deaths30: number;
  res30: number;
  nok30?: number;
  kd: number;
  lastSeenDaysAgo?: number | null;
};

type BoardRow = {
  id: string;
  askPrice: number;
  estimatePrice: number;
  note: string | null;
  createdAt: string;
  isOwn: boolean;
  scarcityBuyHints: string[];
  buyerNeed: string | null;
  faction: { id: string; name: string; slug: string; logoUrl: string | null };
  player: { id: string; nick: string; avatarUrl: string | null; kit: string | null };
  stats?: PlayerStats | null;
};

type OfferPlayerCard = {
  userId: string;
  nick: string;
  kit: string | null;
  estimate: number;
  stats: PlayerStats | null;
};

type OfferRow = {
  id: string;
  type: string;
  cashAmount: number;
  swapUserId: string | null;
  message: string | null;
  createdAt: string;
  fromFaction: { id: string; name: string; slug: string };
  listingId: string;
  askPrice: number;
  playerNick: string;
  playerUserId: string;
  listedPlayer?: OfferPlayerCard | null;
  swapPlayer?: OfferPlayerCard | null;
};

type Listable = {
  userId: string;
  nick: string;
  seat: string;
  kit: string;
  estimate: number;
  sellHints: string[];
  stats?: PlayerStats | null;
};

type Payload = {
  mark: string;
  minRoster: number;
  minAsk?: number;
  minAskRatio?: number;
  estimateLabel?: string;
  estimateHint?: string;
  rosterSize: number;
  eligible: boolean;
  treasury: number;
  treasuryLabel: string;
  canManage: boolean;
  window: {
    isOpen: boolean;
    reason: string | null;
    closedFrom: string | null;
    closedTo: string | null;
    note: string | null;
  };
  scarcity: ScarcityRow[];
  board: BoardRow[];
  myListings: {
    id: string;
    playerUserId: string;
    askPrice: number;
    estimatePrice: number | null;
    note: string | null;
    sellHints: string[];
  }[];
  incomingOffers: OfferRow[];
  listable: Listable[];
  ledger: { id: string; amount: number; kind: string; note: string | null; label: string; createdAt: string }[];
  deals?: {
    pending: DealRow[];
    closed: DealRow[];
  };
};

type DealRow = {
  id: string;
  side: "in" | "out" | "open" | "done";
  status: string;
  statusLabel: string;
  type: string;
  typeLabel: string;
  cashAmount: number;
  askPrice: number;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  fromFaction: { id: string; name: string; slug: string };
  toFaction: { id: string; name: string; slug: string };
  playerNick: string;
  playerUserId: string;
  swapNick: string | null;
  swapUserId: string | null;
};

type Props = {
  slug: string;
  canManage: boolean;
};

type OfferType = "BUY" | "SWAP" | "SWAP_CASH";

type AnalyticsTarget = {
  nick: string;
  kit: string | null;
  factionName: string;
  askPrice?: number | null;
  estimate: number;
  stats: PlayerStats | null;
  hints: string[];
  mode: "board" | "sell" | "offer";
};

function levelClass(level: string) {
  if (level === "critical") return "xfer-scarce is-critical";
  if (level === "thin") return "xfer-scarce is-thin";
  if (level === "surplus") return "xfer-scarce is-surplus";
  return "xfer-scarce";
}

function offerTypeLabel(t: string) {
  if (t === "SWAP_CASH") return "Игрок + доплата";
  if (t === "SWAP") return "Обмен";
  if (t === "BUY") return "Покупка за B$";
  return t;
}

function StatsBlock({ stats }: { stats: PlayerStats | null }) {
  if (!stats) {
    return <p className="muted">Пока мало данных по TR1–TR5 за последние дни.</p>;
  }
  return (
    <div className="xfer-analytics-grid">
      <div>
        <span className="muted">Явка TR 14д</span>
        <strong>
          {stats.trainDays14}/14
        </strong>
      </div>
      <div>
        <span className="muted">Матчи 30д</span>
        <strong>{stats.matches30}</strong>
      </div>
      <div>
        <span className="muted">KD</span>
        <strong>{stats.kd}</strong>
      </div>
      <div>
        <span className="muted">Киллы 30д</span>
        <strong>{stats.kills30}</strong>
      </div>
      <div>
        <span className="muted">Смерти 30д</span>
        <strong>{stats.deaths30}</strong>
      </div>
      <div>
        <span className="muted">Ресы 30д</span>
        <strong>{stats.res30}</strong>
      </div>
      {stats.nok30 != null ? (
        <div>
          <span className="muted">Ноки 30д</span>
          <strong>{stats.nok30}</strong>
        </div>
      ) : null}
      {stats.lastSeenDaysAgo != null ? (
        <div>
          <span className="muted">Был на сайте</span>
          <strong>
            {stats.lastSeenDaysAgo === 0 ? "сегодня" : `${stats.lastSeenDaysAgo} дн. назад`}
          </strong>
        </div>
      ) : null}
    </div>
  );
}

export function FactionTransfers({ slug, canManage }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listUserId, setListUserId] = useState("");
  const [listPrice, setListPrice] = useState(25000);
  const [offerListingId, setOfferListingId] = useState<string | null>(null);
  const [offerType, setOfferType] = useState<OfferType>("SWAP_CASH");
  const [offerCash, setOfferCash] = useState(25000);
  const [offerSwap, setOfferSwap] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsTarget | null>(null);
  const [reviewOfferId, setReviewOfferId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<XferSubTab>(() =>
    readXferSubTab(slug, canManage),
  );

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/transfers`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedListable = useMemo(
    () => data?.listable.find((p) => p.userId === listUserId) || null,
    [data, listUserId],
  );

  const listFloor = useMemo(() => {
    if (!selectedListable) return data?.minAsk || 5000;
    const ratio = data?.minAskRatio ?? 0.8;
    const fromMarket = Math.ceil(selectedListable.estimate * ratio);
    return Math.max(data?.minAsk || 5000, fromMarket);
  }, [selectedListable, data?.minAsk, data?.minAskRatio]);

  const offerTarget = useMemo(
    () => data?.board.find((b) => b.id === offerListingId) || null,
    [data, offerListingId],
  );

  const swapPlayer = useMemo(
    () => data?.listable.find((p) => p.userId === offerSwap) || null,
    [data, offerSwap],
  );

  const reviewOffer = useMemo(
    () => data?.incomingOffers.find((o) => o.id === reviewOfferId) || null,
    [data, reviewOfferId],
  );

  async function postJson(url: string, body: unknown) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      if (json.sellHints?.length) setMsg(json.sellHints.join(" "));
      else if (json.scarcityHints?.buyHints?.length || json.scarcityHints?.sellHints?.length) {
        setMsg(
          [...(json.scarcityHints.buyHints || []), ...(json.scarcityHints.sellHints || [])].join(
            " ",
          ),
        );
      } else setMsg("Готово.");
      await load();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function patchOffer(offerId: string, action: "accept" | "decline") {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/transfers/offers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      setMsg(
        action === "accept"
          ? "Сделка принята. Письма ушли участникам."
          : "Сделка отклонена. Письма ушли участникам.",
      );
      setOfferListingId(null);
      setReviewOfferId(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function openBoardAnalytics(row: BoardRow) {
    setAnalytics({
      nick: row.player.nick,
      kit: row.player.kit,
      factionName: row.faction.name,
      askPrice: row.askPrice,
      estimate: row.estimatePrice,
      stats: row.stats || null,
      hints: row.scarcityBuyHints,
      mode: "board",
    });
  }

  const isStaff = Boolean(canManage && (data?.canManage ?? canManage));
  const ledgerRows = data?.ledger ?? [];
  const pendingDeals = data?.deals?.pending ?? [];
  const closedDeals = data?.deals?.closed ?? [];
  const ledgerPage = useFitTablePage(ledgerRows.length, Boolean(data) && subTab === "ledger");
  const pendingPage = useFitTablePage(pendingDeals.length, Boolean(data) && subTab === "market");
  const closedPage = useFitTablePage(closedDeals.length, Boolean(data) && subTab === "closed");

  useEffect(() => {
    const next = readXferSubTab(slug, isStaff);
    setSubTab(next);
  }, [slug, isStaff]);

  useEffect(() => {
    if (!isStaff && subTab === "desk") setSubTab("ledger");
  }, [isStaff, subTab]);

  function selectSubTab(id: XferSubTab) {
    if (!isStaff && id === "desk") return;
    setSubTab(id);
    writeXferSubTab(slug, isStaff, id);
  }

  const ledgerVisible = ledgerRows.slice(
    ledgerPage.safePage * ledgerPage.pageSize,
    ledgerPage.safePage * ledgerPage.pageSize + ledgerPage.pageSize,
  );
  const pendingVisible = pendingDeals.slice(
    pendingPage.safePage * pendingPage.pageSize,
    pendingPage.safePage * pendingPage.pageSize + pendingPage.pageSize,
  );
  const closedVisible = closedDeals.slice(
    closedPage.safePage * closedPage.pageSize,
    closedPage.safePage * closedPage.pageSize + closedPage.pageSize,
  );

  if (err && !data) {
    return <p className="muted">{err}</p>;
  }
  if (!data) {
    return <p className="muted">Загрузка трансферной доски…</p>;
  }

  return (
    <div className={`xfer-panel${isStaff ? " is-staff" : " is-member"}`}>
      <div className="xfer-head">
        <div>
          <h3 className="xfer-title">Трансферы</h3>
          {isStaff ? (
            <p className="muted xfer-sub">
              Казна:{" "}
              <strong>
                <BdAmount n={data.treasury} />
              </strong>
              {" · "}
              состав {data.rosterSize}/{data.minRoster}
              {!data.eligible ? " — для сделок нужно ≥30" : ""}
            </p>
          ) : null}
        </div>
        {isStaff ? (
          <div className={`xfer-window ${data.window.isOpen ? "is-open" : "is-closed"}`}>
            {data.window.isOpen
              ? "Трансферное окно открыто"
              : data.window.reason || "Трансферное окно закрыто"}
          </div>
        ) : null}
      </div>

      <div className="admin-tabs clan-tabs xfer-subtabs" role="tablist">
        {isStaff ? (
          <button
            type="button"
            className={`admin-tab${subTab === "desk" ? " active" : ""}`}
            onClick={() => selectSubTab("desk")}
          >
            Выставление
          </button>
        ) : null}
        <button
          type="button"
          className={`admin-tab${subTab === "ledger" ? " active" : ""}`}
          onClick={() => selectSubTab("ledger")}
        >
          Движение казны
        </button>
        <button
          type="button"
          className={`admin-tab${subTab === "market" ? " active" : ""}`}
          onClick={() => selectSubTab("market")}
        >
          Оферы · рынок
        </button>
        <button
          type="button"
          className={`admin-tab${subTab === "closed" ? " active" : ""}`}
          onClick={() => selectSubTab("closed")}
        >
          Успешные сделки
        </button>
      </div>

      {msg ? <p className="xfer-msg">{msg}</p> : null}
      {err && data ? <p className="xfer-err">{err}</p> : null}

      {subTab === "desk" && isStaff ? (
        <div className="xfer-tab-body xfer-staff-ops">
          <section className="xfer-section">
            <h4>Баланс ролей вашей фракции</h4>
            <div className="xfer-scarce-grid">
              {data.scarcity.map((r) => (
                <div key={r.kitKey} className={levelClass(r.level)} title={r.hint}>
                  <span className="xfer-scarce-label">{r.label}</span>
                  <span className="xfer-scarce-count">{r.count}</span>
                </div>
              ))}
              {!data.scarcity.length ? <span className="muted">Нет данных по китам</span> : null}
            </div>
          </section>

          <section className="xfer-section">
          <h4>Выставить на продажу</h4>
          {!data.window.isOpen || !data.eligible ? (
            <p className="muted">
              {!data.window.isOpen
                ? "Окно закрыто — выставлять нельзя."
                : `Нужно минимум ${data.minRoster} человек во фракции.`}
            </p>
          ) : (
            <div className="xfer-form">
              <select
                value={listUserId}
                onChange={(e) => {
                  setListUserId(e.target.value);
                  const p = data.listable.find((x) => x.userId === e.target.value);
                  if (p) setListPrice(p.estimate);
                }}
              >
                <option value="">Игрок…</option>
                {data.listable
                  .filter((p) => p.seat !== "LEADER")
                  .map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.nick} · {p.kit} · оценка {p.estimate.toLocaleString("ru-RU")} B$
                    </option>
                  ))}
              </select>
              <input
                type="number"
                min={listFloor}
                step={500}
                value={listPrice}
                onChange={(e) => setListPrice(Number(e.target.value))}
              />
              {selectedListable ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setAnalytics({
                      nick: selectedListable.nick,
                      kit: selectedListable.kit,
                      factionName: "ваша фракция",
                      askPrice: listPrice,
                      estimate: selectedListable.estimate,
                      stats: selectedListable.stats || null,
                      hints: selectedListable.sellHints,
                      mode: "sell",
                    })
                  }
                >
                  Аналитика
                </button>
              ) : null}
              <button
                type="button"
                className="btn primary"
                disabled={busy || !listUserId || listPrice < listFloor}
                onClick={() =>
                  void postJson(`/api/factions/${encodeURIComponent(slug)}/transfers`, {
                    action: "list",
                    userId: listUserId,
                    askPrice: listPrice,
                  })
                }
              >
                На доску
              </button>
            </div>
          )}
          {selectedListable ? (
            <p className="muted xfer-hint">
              {data.estimateLabel || "оценочная стоимость"}:{" "}
              <BdAmount n={selectedListable.estimate} />
              {" · мин. цена (80%): "}
              <BdAmount n={listFloor} />
            </p>
          ) : null}
          {selectedListable && listPrice < listFloor ? (
            <p className="xfer-warn">
              Нельзя ниже 80% рыночной оценки — минимум <BdAmount n={listFloor} />.
            </p>
          ) : null}
          {selectedListable?.sellHints?.length ? (
            <p className="xfer-warn">{selectedListable.sellHints.join(" ")}</p>
          ) : null}
          </section>

          <section className="xfer-section">
            <h4>Входящие сделки</h4>
            <ul className="xfer-list">
              {data.incomingOffers.map((o) => (
                <li key={o.id} className="xfer-card">
                  <div>
                    <strong className="xfer-nick">{o.playerNick}</strong> ← {o.fromFaction.name}
                    <span className="muted">
                      {" "}
                      · {offerTypeLabel(o.type)}
                      {o.cashAmount ? (
                        <>
                          {" · "}
                          <BdAmount n={o.cashAmount} />
                        </>
                      ) : null}
                      {o.swapPlayer ? ` · + ${o.swapPlayer.nick}` : null}
                    </span>
                    {o.message ? <p className="muted">{o.message}</p> : null}
                  </div>
                  <div className="xfer-actions">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => setReviewOfferId(o.id)}
                    >
                      Открыть предложение
                    </button>
                  </div>
                </li>
              ))}
              {!data.incomingOffers.length ? (
                <li className="muted">Пока нет входящих предложений.</li>
              ) : null}
            </ul>
          </section>

          <section className="xfer-section">
            <h4>Доска трансферов</h4>
            <ul className="xfer-list">
              {data.board.map((row) => (
                <li key={row.id} className={`xfer-card ${row.isOwn ? "is-own" : ""}`}>
                  <div className="xfer-card-main">
                    <strong className="xfer-nick">{row.player.nick}</strong>
                    <span className="muted">
                      {" "}
                      · фракция {row.faction.name} · {row.player.kit || "—"} · запрос{" "}
                      <strong>
                        <BdAmount n={row.askPrice} />
                      </strong>
                      {" · "}
                      {data.estimateLabel || "оценочная стоимость"}{" "}
                      <BdAmount n={row.estimatePrice} />
                    </span>
                    {row.stats ? (
                      <p className="muted xfer-hint">
                        явка {row.stats.trainDays14}/14 · KD {row.stats.kd} · {row.stats.kills30}{" "}
                        kill · {row.stats.res30} res
                      </p>
                    ) : null}
                    {row.scarcityBuyHints.length ? (
                      <p className="xfer-hint-inline">{row.scarcityBuyHints[0]}</p>
                    ) : null}
                  </div>
                  <div className="xfer-actions">
                    <button type="button" className="btn" onClick={() => openBoardAnalytics(row)}>
                      Аналитика
                    </button>
                    {!row.isOwn && data.window.isOpen && data.eligible ? (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => {
                          setOfferListingId(row.id);
                          setOfferCash(Math.max(5000, Math.round(row.askPrice * 0.25)));
                          setOfferType("SWAP_CASH");
                          setOfferSwap("");
                        }}
                      >
                        Предложить сделку
                      </button>
                    ) : null}
                    {row.isOwn ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() =>
                          void postJson(`/api/factions/${encodeURIComponent(slug)}/transfers`, {
                            action: "withdraw",
                            listingId: row.id,
                          })
                        }
                      >
                        Снять
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
              {!data.board.length ? <li className="muted">Пока никого нет на доске.</li> : null}
            </ul>
          </section>
        </div>
      ) : null}

      {subTab === "ledger" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-fit" ref={ledgerPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Тип</th>
                    <th>Сумма</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerVisible.map((e) => (
                    <tr key={e.id}>
                      <td>{formatWhen(e.createdAt)}</td>
                      <td>{ledgerKindRu(e.kind)}</td>
                      <td className={e.amount >= 0 ? "is-plus" : "is-minus"}>
                        <BdAmount n={e.amount} signed />
                      </td>
                      <td className="muted">
                        <LedgerNote note={e.note} />
                      </td>
                    </tr>
                  ))}
                  {!ledgerRows.length ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        Пока пусто — гринд с TR1–TR5 пополнит казну.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <XferPager page={ledgerPage} total={ledgerRows.length} />
        </div>
      ) : null}

      {subTab === "market" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-fit" ref={pendingPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <th>Статус</th>
                    <th>Тип</th>
                    <th>Игрок</th>
                    <th>От / Кому</th>
                    <th>Деньги</th>
                    <th>Когда</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingVisible.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className={`xfer-pill is-${d.side}`}>{d.statusLabel}</span>
                      </td>
                      <td>{d.typeLabel}</td>
                      <td>
                        <XferNick>{d.playerNick}</XferNick>
                        {d.swapNick ? (
                          <>
                            {" ↔ "}
                            <XferNick>{d.swapNick}</XferNick>
                          </>
                        ) : null}
                      </td>
                      <td className="muted">
                        {d.fromFaction.name} → {d.toFaction.name}
                      </td>
                      <td>{d.cashAmount ? <BdAmount n={d.cashAmount} /> : "—"}</td>
                      <td>{formatWhen(d.createdAt)}</td>
                    </tr>
                  ))}
                  {!pendingDeals.length ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        На рынке пока нет лотов и оферов.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <XferPager page={pendingPage} total={pendingDeals.length} />
        </div>
      ) : null}

      {subTab === "closed" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-fit" ref={closedPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Игрок</th>
                    <th>От / Кому</th>
                    <th>Деньги</th>
                    <th>Когда</th>
                  </tr>
                </thead>
                <tbody>
                  {closedVisible.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className="xfer-pill is-done">{d.typeLabel}</span>
                      </td>
                      <td>
                        <XferNick>{d.playerNick}</XferNick>
                        {d.swapNick ? (
                          <>
                            {" ↔ "}
                            <XferNick>{d.swapNick}</XferNick>
                          </>
                        ) : null}
                      </td>
                      <td className="muted">
                        {d.fromFaction.name} → {d.toFaction.name}
                      </td>
                      <td>{d.cashAmount ? <BdAmount n={d.cashAmount} /> : "—"}</td>
                      <td>{formatWhen(d.updatedAt || d.createdAt)}</td>
                    </tr>
                  ))}
                  {!closedDeals.length ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        Успешных сделок пока нет.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <XferPager page={closedPage} total={closedDeals.length} />
        </div>
      ) : null}

      {offerListingId && offerTarget && isStaff ? (
        <DraggableModal
          open
          closeOnBackdrop={!busy}
          onClose={() => setOfferListingId(null)}
        >
            <header className="profile-match-modal-head" data-drag-handle title="Перетащить окно">
              <div>
                <p className="muted">Офер · {offerTarget.faction.name}</p>
                <h2 className="profile-mail-modal-title">{offerTarget.player.nick}</h2>
                <p className="muted">
                  {offerTarget.player.kit || "—"} · запрос <BdAmount n={offerTarget.askPrice} /> ·
                  оценка <BdAmount n={offerTarget.estimatePrice} />
                </p>
              </div>
              <button
                type="button"
                className="profile-match-modal-close"
                onClick={() => setOfferListingId(null)}
              >
                ×
              </button>
            </header>

            <div className="xfer-deal-types" role="tablist" aria-label="Тип сделки">
              {(
                [
                  ["SWAP_CASH", "Игрок + доплата"],
                  ["SWAP", "Только обмен"],
                  ["BUY", "Только B$"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`xfer-deal-type${offerType === id ? " is-on" : ""}`}
                  onClick={() => setOfferType(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="xfer-compare">
              <div>
                <div className="muted">Вы получаете</div>
                <strong>{offerTarget.player.nick}</strong>
                <div className="muted">
                  {offerTarget.faction.name} · {offerTarget.player.kit || "—"}
                </div>
              </div>
              <div className="xfer-compare-vs">↔</div>
              <div>
                <div className="muted">Вы отдаёте</div>
                {offerType === "BUY" ? (
                  <strong>
                    <BdAmount n={offerCash} />
                  </strong>
                ) : (
                  <>
                    <strong>{swapPlayer?.nick || "свой игрок…"}</strong>
                    {offerType === "SWAP_CASH" ? (
                      <div>
                        + доплата <BdAmount n={offerCash} />
                      </div>
                    ) : (
                      <div className="muted">без доплаты</div>
                    )}
                  </>
                )}
              </div>
            </div>

            <StatsBlock stats={offerTarget.stats || null} />
            {offerTarget.scarcityBuyHints.map((h) => (
              <p key={h} className="xfer-hint-inline">
                {h}
              </p>
            ))}

            <div className="xfer-form" style={{ marginTop: "0.75rem" }}>
              {offerType !== "SWAP" ? (
                <label className="xfer-field">
                  <span>{offerType === "BUY" ? "Сумма покупки" : "Доплата B$"}</span>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={offerCash}
                    onChange={(e) => setOfferCash(Number(e.target.value))}
                  />
                </label>
              ) : null}
              {offerType !== "BUY" ? (
                <label className="xfer-field">
                  <span>Кого отдаёте взамен</span>
                  <select value={offerSwap} onChange={(e) => setOfferSwap(e.target.value)}>
                    <option value="">Ваш игрок…</option>
                    {data.listable
                      .filter((p) => p.seat !== "LEADER")
                      .map((p) => (
                        <option key={p.userId} value={p.userId}>
                          {p.nick} · {p.kit} · оценка {p.estimate.toLocaleString("ru-RU")}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </div>

            {swapPlayer ? (
              <p className="muted xfer-hint">
                Ваш игрок на обмен: {swapPlayer.nick} · {swapPlayer.kit} · оценка{" "}
                <BdAmount n={swapPlayer.estimate} />
                {" · "}
                <button
                  type="button"
                  className="kv-link"
                  onClick={() =>
                    setAnalytics({
                      nick: swapPlayer.nick,
                      kit: swapPlayer.kit,
                      factionName: "ваша фракция (на обмен)",
                      estimate: swapPlayer.estimate,
                      stats: swapPlayer.stats || null,
                      hints: swapPlayer.sellHints,
                      mode: "offer",
                    })
                  }
                >
                  аналитика
                </button>
              </p>
            ) : null}

            <div className="xfer-actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="btn primary"
                disabled={
                  busy ||
                  (offerType !== "BUY" && !offerSwap) ||
                  (offerType === "BUY" && offerCash < (data.minAsk || 5000))
                }
                onClick={() =>
                  void postJson(`/api/factions/${encodeURIComponent(slug)}/transfers/offers`, {
                    listingId: offerListingId,
                    type: offerType,
                    cashAmount: offerType === "SWAP" ? 0 : offerCash,
                    swapUserId: offerType === "BUY" ? null : offerSwap || null,
                  }).then((ok) => {
                    if (ok) setOfferListingId(null);
                  })
                }
              >
                Отправить офер
              </button>
              <button type="button" className="btn" onClick={() => setOfferListingId(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => openBoardAnalytics(offerTarget)}
              >
                Аналитика игрока
              </button>
            </div>
        </DraggableModal>
      ) : null}

      {reviewOffer && isStaff ? (
        <DraggableModal
          open
          closeOnBackdrop={!busy}
          onClose={() => setReviewOfferId(null)}
        >
            <header className="profile-match-modal-head" data-drag-handle title="Перетащить окно">
              <div>
                <p className="muted">Входящая сделка · {reviewOffer.fromFaction.name}</p>
                <h2 className="profile-mail-modal-title">
                  {offerTypeLabel(reviewOffer.type)}
                </h2>
                <p className="muted">
                  Ваш игрок на доске: <strong>{reviewOffer.playerNick}</strong> · запрос{" "}
                  <BdAmount n={reviewOffer.askPrice} />
                </p>
              </div>
              <button
                type="button"
                className="profile-match-modal-close"
                onClick={() => setReviewOfferId(null)}
              >
                ×
              </button>
            </header>

            <div className="xfer-compare">
              <div>
                <div className="muted">Вы отдаёте</div>
                <strong>{reviewOffer.listedPlayer?.nick || reviewOffer.playerNick}</strong>
                <div className="muted">
                  {reviewOffer.listedPlayer?.kit || "—"}
                  {reviewOffer.listedPlayer ? (
                    <>
                      {" · оценка "}
                      <BdAmount n={reviewOffer.listedPlayer.estimate} />
                    </>
                  ) : null}
                </div>
              </div>
              <div className="xfer-compare-vs">↔</div>
              <div>
                <div className="muted">Вам предлагают</div>
                {reviewOffer.type === "BUY" ? (
                  <strong>
                    <BdAmount n={reviewOffer.cashAmount} />
                  </strong>
                ) : (
                  <>
                    <strong>{reviewOffer.swapPlayer?.nick || "игрок"}</strong>
                    <div className="muted">
                      {reviewOffer.swapPlayer?.kit || "—"}
                      {reviewOffer.swapPlayer ? (
                        <>
                          {" · оценка "}
                          <BdAmount n={reviewOffer.swapPlayer.estimate} />
                        </>
                      ) : null}
                    </div>
                    {reviewOffer.type === "SWAP_CASH" ? (
                      <div>
                        + доплата <BdAmount n={reviewOffer.cashAmount} />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {reviewOffer.message ? (
              <p className="xfer-hint-inline">Комментарий: {reviewOffer.message}</p>
            ) : null}

            <h4 style={{ margin: "0.75rem 0 0.35rem" }}>Ваш игрок</h4>
            <StatsBlock stats={reviewOffer.listedPlayer?.stats || null} />
            {reviewOffer.swapPlayer ? (
              <>
                <h4 style={{ margin: "0.75rem 0 0.35rem" }}>Их игрок на обмен</h4>
                <StatsBlock stats={reviewOffer.swapPlayer.stats || null} />
              </>
            ) : null}

            <div className="xfer-actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void patchOffer(reviewOffer.id, "accept")}
              >
                Подтвердить сделку
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void patchOffer(reviewOffer.id, "decline")}
              >
                Отклонить
              </button>
              <button type="button" className="btn" onClick={() => setReviewOfferId(null)}>
                Закрыть
              </button>
            </div>
        </DraggableModal>
      ) : null}

      {analytics && isStaff ? (
        <DraggableModal open onClose={() => setAnalytics(null)}>
            <header className="profile-match-modal-head" data-drag-handle title="Перетащить окно">
              <div>
                <p className="muted">Аналитика трансфера</p>
                <h2 className="profile-mail-modal-title">{analytics.nick}</h2>
                <p className="muted">
                  {analytics.factionName}
                  {analytics.kit ? ` · ${analytics.kit}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="profile-match-modal-close"
                onClick={() => setAnalytics(null)}
              >
                ×
              </button>
            </header>
            <div className="xfer-analytics-prices">
              <div>
                <span className="muted">{data.estimateLabel || "оценочная стоимость"}</span>
                <strong>
                  <BdAmount n={analytics.estimate} />
                </strong>
              </div>
              {analytics.askPrice != null ? (
                <div>
                  <span className="muted">Запрос / ваша цена</span>
                  <strong>
                    <BdAmount n={analytics.askPrice} />
                  </strong>
                </div>
              ) : null}
            </div>
            <StatsBlock stats={analytics.stats} />
            {analytics.hints.length ? (
              <div className="xfer-analytics-hints">
                {analytics.hints.map((h) => (
                  <p key={h} className="xfer-warn">
                    {h}
                  </p>
                ))}
              </div>
            ) : (
              <p className="muted">По роли баланс нормальный — особых предупреждений нет.</p>
            )}
            <p className="muted xfer-hint" style={{ marginTop: "0.75rem" }}>
              Оценка — ориентир по явке TR, киллам/ресам/KD и редкости роли. Цена сделки всегда
              ваша.
            </p>
            <div className="xfer-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn primary" onClick={() => setAnalytics(null)}>
                Закрыть
              </button>
            </div>
        </DraggableModal>
      ) : null}

    </div>
  );
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ledgerKindRu(kind: string) {
  if (kind === "grind") return "Гринд TR";
  if (kind === "transfer_in") return "Сделка +";
  if (kind === "transfer_out") return "Сделка −";
  if (kind === "admin_adjust") return "Правка";
  return kind;
}

/** Комментарий гринда: «TR tr1 · Map · Nick» — ник жёлтым. */
function LedgerNote({ note }: { note: string | null }) {
  if (!note) return <>—</>;
  const sep = " · ";
  const i = note.lastIndexOf(sep);
  if (i < 0) return <>{note}</>;
  const head = note.slice(0, i + sep.length);
  const nick = note.slice(i + sep.length);
  return (
    <span className="xfer-ledger-note">
      {head}
      <span className="xfer-nick">{nick}</span>
    </span>
  );
}

function XferNick({ children }: { children: ReactNode }) {
  return <span className="xfer-nick">{children}</span>;
}
