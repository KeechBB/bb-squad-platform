"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BdAmount } from "@/components/BdMark";

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
  if (t === "SWAP_CASH") return "Обмен + доплата";
  if (t === "SWAP") return "Обмен";
  if (t === "BUY") return "Покупка";
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
  const [offerType, setOfferType] = useState<OfferType>("BUY");
  const [offerCash, setOfferCash] = useState(25000);
  const [offerSwap, setOfferSwap] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsTarget | null>(null);

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

  const offerTarget = useMemo(
    () => data?.board.find((b) => b.id === offerListingId) || null,
    [data, offerListingId],
  );

  const swapPlayer = useMemo(
    () => data?.listable.find((p) => p.userId === offerSwap) || null,
    [data, offerSwap],
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
      setMsg(action === "accept" ? "Сделка закрыта. Игрок получил письмо." : "Офер отклонён.");
      setOfferListingId(null);
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

  if (err && !data) {
    return <p className="muted">{err}</p>;
  }
  if (!data) {
    return <p className="muted">Загрузка трансферной доски…</p>;
  }

  return (
    <div className="xfer-panel">
      <div className="xfer-head">
        <div>
          <h3 className="xfer-title">Трансферы</h3>
          <p className="muted xfer-sub">
            Казна:{" "}
            <strong>
              <BdAmount n={data.treasury} />
            </strong>
            {" · "}
            состав {data.rosterSize}/{data.minRoster}
            {!data.eligible ? " — для сделок нужно ≥30" : ""}
            {" · "}
            гринд только TR1–TR5
          </p>
          <p className="muted xfer-hint">
            Типы сделок: <strong>покупка</strong>, <strong>обмен</strong>,{" "}
            <strong>обмен + доплата</strong>. По игроку — кнопка «Аналитика».
          </p>
        </div>
        <div className={`xfer-window ${data.window.isOpen ? "is-open" : "is-closed"}`}>
          {data.window.isOpen ? "Окно открыто" : data.window.reason || "Окно закрыто"}
        </div>
      </div>

      {msg ? <p className="xfer-msg">{msg}</p> : null}
      {err ? <p className="xfer-err">{err}</p> : null}

      <section className="xfer-section">
        <h4>Баланс ролей вашей фракции</h4>
        <p className="muted xfer-hint">
          Дефицит подсвечивается при покупке; при продаже редких ролей — предупреждение.
          {data.estimateHint ? ` ${data.estimateHint}` : ""}
        </p>
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

      {canManage && data.canManage ? (
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
                min={data.minAsk || 5000}
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
                disabled={busy || !listUserId}
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
            </p>
          ) : null}
          {selectedListable?.sellHints?.length ? (
            <p className="xfer-warn">{selectedListable.sellHints.join(" ")}</p>
          ) : null}
        </section>
      ) : null}

      {canManage && data.incomingOffers.length ? (
        <section className="xfer-section">
          <h4>Входящие оферы</h4>
          <ul className="xfer-list">
            {data.incomingOffers.map((o) => (
              <li key={o.id} className="xfer-card">
                <div>
                  <strong>{o.playerNick}</strong> ← {o.fromFaction.name}
                  <span className="muted">
                    {" "}
                    · {offerTypeLabel(o.type)}
                    {o.cashAmount ? (
                      <>
                        {" · "}
                        <BdAmount n={o.cashAmount} />
                      </>
                    ) : null}
                  </span>
                  {o.message ? <p className="muted">{o.message}</p> : null}
                </div>
                <div className="xfer-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void patchOffer(o.id, "accept")}
                  >
                    Принять
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void patchOffer(o.id, "decline")}
                  >
                    Отклонить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="xfer-section">
        <h4>Доска трансферов</h4>
        <ul className="xfer-list">
          {data.board.map((row) => (
            <li key={row.id} className={`xfer-card ${row.isOwn ? "is-own" : ""}`}>
              <div className="xfer-card-main">
                <strong>{row.player.nick}</strong>
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
                    явка {row.stats.trainDays14}/14 · KD {row.stats.kd} · {row.stats.kills30} kill ·{" "}
                    {row.stats.res30} res
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
                {canManage && data.canManage && !row.isOwn && data.window.isOpen && data.eligible ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      setOfferListingId(row.id);
                      setOfferCash(row.askPrice);
                      setOfferType("BUY");
                      setOfferSwap("");
                    }}
                  >
                    Сделать офер
                  </button>
                ) : null}
                {canManage && row.isOwn ? (
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

      {offerListingId && offerTarget && canManage ? (
        <div
          className="profile-match-modal"
          role="presentation"
          onClick={() => !busy && setOfferListingId(null)}
        >
          <div
            className="profile-match-modal-panel xfer-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="profile-match-modal-head">
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
                  ["BUY", "Покупка за B$"],
                  ["SWAP", "Обмен игроками"],
                  ["SWAP_CASH", "Обмен + доплата"],
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
          </div>
        </div>
      ) : null}

      {analytics ? (
        <div
          className="profile-match-modal"
          role="presentation"
          onClick={() => setAnalytics(null)}
        >
          <div
            className="profile-match-modal-panel xfer-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="profile-match-modal-head">
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
          </div>
        </div>
      ) : null}

      <section className="xfer-section">
        <h4>Движения казны</h4>
        <ul className="xfer-ledger">
          {data.ledger.map((e) => (
            <li key={e.id}>
              <span className={e.amount >= 0 ? "is-plus" : "is-minus"}>
                <BdAmount n={e.amount} signed />
              </span>
              <span className="muted">
                {" "}
                · {e.kind}
                {e.note ? ` · ${e.note}` : ""}
              </span>
            </li>
          ))}
          {!data.ledger.length ? (
            <li className="muted">Пока пусто — гринд с TR1–TR5 пополнит казну.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
