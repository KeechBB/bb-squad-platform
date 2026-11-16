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
};

type Payload = {
  mark: string;
  minRoster: number;
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

function levelClass(level: string) {
  if (level === "critical") return "xfer-scarce is-critical";
  if (level === "thin") return "xfer-scarce is-thin";
  if (level === "surplus") return "xfer-scarce is-surplus";
  return "xfer-scarce";
}

export function FactionTransfers({ slug, canManage }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listUserId, setListUserId] = useState("");
  const [listPrice, setListPrice] = useState(100);
  const [offerListingId, setOfferListingId] = useState<string | null>(null);
  const [offerType, setOfferType] = useState<"BUY" | "SWAP" | "SWAP_CASH">("BUY");
  const [offerCash, setOfferCash] = useState(100);
  const [offerSwap, setOfferSwap] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
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
        </div>
        <div className={`xfer-window ${data.window.isOpen ? "is-open" : "is-closed"}`}>
          {data.window.isOpen ? "Окно открыто" : data.window.reason || "Окно закрыто"}
        </div>
      </div>

      {msg ? <p className="xfer-msg">{msg}</p> : null}
      {err ? <p className="xfer-err">{err}</p> : null}

      <section className="xfer-section">
        <h4>Баланс ролей</h4>
        <p className="muted xfer-hint">
          Система подмечает дефицит при покупке и предупреждает при продаже редких ролей.
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
          <h4>Выставить игрока</h4>
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
                      {p.nick} · {p.kit} · ≈{p.estimate} $
                    </option>
                  ))}
              </select>
              <input
                type="number"
                min={40}
                step={5}
                value={listPrice}
                onChange={(e) => setListPrice(Number(e.target.value))}
              />
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
                    · {o.type}
                    {o.cashAmount ? (
                      <>
                        {" · "}
                        <BdAmount n={o.cashAmount} />
                      </>
                    ) : (
                      ""
                    )}
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
                  · {row.faction.name} · {row.player.kit || "—"} · запрос{" "}
                  <strong>
                    <BdAmount n={row.askPrice} />
                  </strong>
                  {" · оценка "}
                  <BdAmount n={row.estimatePrice} />
                </span>
                {row.scarcityBuyHints.length ? (
                  <p className="xfer-hint-inline">{row.scarcityBuyHints[0]}</p>
                ) : null}
              </div>
              {canManage && data.canManage && !row.isOwn && data.window.isOpen && data.eligible ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setOfferListingId(row.id);
                    setOfferCash(row.askPrice);
                    setOfferType("BUY");
                  }}
                >
                  Офер
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
            </li>
          ))}
          {!data.board.length ? <li className="muted">Пока никого нет на доске.</li> : null}
        </ul>
      </section>

      {offerListingId && offerTarget && canManage ? (
        <section className="xfer-section xfer-offer-box">
          <h4>Офер на {offerTarget.player.nick}</h4>
          <div className="xfer-compare">
            <div>
              <div className="muted">Они отдают</div>
              <strong>{offerTarget.player.nick}</strong>
              <div>
                {offerTarget.player.kit || "—"} · <BdAmount n={offerTarget.askPrice} />
              </div>
            </div>
            <div className="xfer-compare-vs">↔</div>
            <div>
              <div className="muted">Вы даёте</div>
              {offerType === "BUY" ? (
                <strong>
                  <BdAmount n={offerCash} />
                </strong>
              ) : (
                <strong>
                  игрок
                  {offerType === "SWAP_CASH" ? (
                    <>
                      {" + "}
                      <BdAmount n={offerCash} />
                    </>
                  ) : (
                    " · обмен"
                  )}
                </strong>
              )}
            </div>
          </div>
          {offerTarget.scarcityBuyHints.map((h) => (
            <p key={h} className="xfer-hint-inline">
              {h}
            </p>
          ))}
          <div className="xfer-form">
            <select
              value={offerType}
              onChange={(e) => setOfferType(e.target.value as typeof offerType)}
            >
              <option value="BUY">Покупка за B$</option>
              <option value="SWAP">Обмен игроками</option>
              <option value="SWAP_CASH">Обмен + доплата</option>
            </select>
            {offerType !== "SWAP" ? (
              <input
                type="number"
                min={0}
                step={5}
                value={offerCash}
                onChange={(e) => setOfferCash(Number(e.target.value))}
              />
            ) : null}
            {offerType !== "BUY" ? (
              <select value={offerSwap} onChange={(e) => setOfferSwap(e.target.value)}>
                <option value="">Ваш игрок…</option>
                {data.listable
                  .filter((p) => p.seat !== "LEADER")
                  .map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.nick} · {p.kit}
                    </option>
                  ))}
              </select>
            ) : null}
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() =>
                void postJson(`/api/factions/${encodeURIComponent(slug)}/transfers/offers`, {
                  listingId: offerListingId,
                  type: offerType,
                  cashAmount: offerCash,
                  swapUserId: offerSwap || null,
                }).then(() => setOfferListingId(null))
              }
            >
              Отправить
            </button>
            <button type="button" className="btn" onClick={() => setOfferListingId(null)}>
              Отмена
            </button>
          </div>
        </section>
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
