"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BdAmount } from "@/components/BdMark";

type Listable = {
  userId: string;
  nick: string;
  seat: string;
  kit: string;
  estimate: number;
  trainDays7?: number;
  trainDays30?: number;
  auctionListAllowed?: boolean;
  inReserve?: boolean;
};

/** >3 TR-дней за неделю → актив; резерв — всегда можно. */
const MIN_TRAIN_DAYS_WEEK = 4;

type AuctionTone = "active" | "reserve" | "inactive";

function auctionTone(p: Listable): AuctionTone {
  if (p.inReserve) return "reserve";
  const days7 = p.trainDays7 ?? p.trainDays30 ?? 0;
  const allowed =
    p.auctionListAllowed === true ||
    (p.auctionListAllowed !== false && days7 >= MIN_TRAIN_DAYS_WEEK);
  return allowed ? "active" : "inactive";
}

function toneLabel(tone: AuctionTone): string {
  if (tone === "reserve") return "резерв";
  if (tone === "inactive") return "неактив";
  return "актив";
}

function canListTone(tone: AuctionTone): boolean {
  return tone !== "inactive";
}

type LotBid = {
  factionId: string;
  factionName: string;
  amountBd: number;
  status: string;
};

type Lot = {
  id: string;
  status: string;
  endsAt: string;
  remainingMs: number;
  nick: string;
  steamId: string;
  userId: string;
  winningBidBd: number | null;
  lotKind?: string;
  minBidBd?: number | null;
  sourceFactionId?: string | null;
  topBid: {
    amountBd: number;
    factionName: string;
    factionId: string;
    status: string;
  } | null;
  myBid: { amountBd: number; status: string } | null;
  bids: LotBid[];
};

type AuctionPayload = {
  canManage: boolean;
  factionId: string;
  factionName: string;
  treasury: number;
  bankBalance: number;
  hours: number;
  factionListDays?: number;
  presetFactions?: string[];
  lots: Lot[];
  error?: string;
};

const FALLBACK_FACTIONS = ["Орда", "Улей", "Сброд", "Стая", "Табор"];

function fmtRemain(ms: number) {
  if (ms <= 0) return "завершён";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}д ${h}ч`;
  return `${h}ч ${m}м`;
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

function bidAmountFor(lot: Lot, factionName: string): number {
  const hit = lot.bids.find((b) => b.factionName === factionName);
  return hit ? hit.amountBd : 0;
}

function lotKindLabel(kind?: string) {
  if (kind === "faction_list") return "фракция";
  if (kind === "self_list") return "сам";
  if (kind === "race_penalty") return "штраф гонки";
  if (kind === "recruit") return "рекрут";
  return kind || "";
}

export function FactionTransferAuctionTab({
  slug,
  canManage,
  listable,
  windowOpen,
}: {
  slug: string;
  canManage: boolean;
  listable: Listable[];
  windowOpen: boolean;
}) {
  const [data, setData] = useState<AuctionPayload | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [listUserId, setListUserId] = useState("");
  const [askPrice, setAskPrice] = useState("");
  const [bidDraft, setBidDraft] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);

  const members = useMemo(
    () => listable.filter((p) => p.seat === "MEMBER"),
    [listable],
  );

  const selected = useMemo(
    () => members.find((p) => p.userId === listUserId) || null,
    [members, listUserId],
  );

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/auction`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as AuctionPayload;
      if (!res.ok) {
        setErr(json.error || "Не удалось загрузить аукцион");
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
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setAskPrice("");
      return;
    }
    setAskPrice(String(selected.estimate || ""));
  }, [selected]);

  const onAuctionIds = useMemo(() => {
    const open = (data?.lots || []).filter((l) => l.status === "OPEN");
    return new Set(open.map((l) => l.userId));
  }, [data?.lots]);

  const openLots = useMemo(
    () => (data?.lots || []).filter((l) => l.status === "OPEN"),
    [data?.lots],
  );
  const doneLots = useMemo(
    () =>
      (data?.lots || []).filter(
        (l) =>
          l.status !== "OPEN" &&
          (l.lotKind === "faction_list" ||
            l.lotKind === "self_list" ||
            l.lotKind === "race_penalty"),
      ),
    [data?.lots],
  );

  const days = data?.factionListDays ?? 7;
  const manage = Boolean(canManage && data?.canManage);
  const presets =
    data?.presetFactions?.length === 5
      ? data.presetFactions
      : FALLBACK_FACTIONS;

  async function listPlayer() {
    if (!manage || !selected) return;
    const tone = auctionTone(selected);
    const days7 = selected.trainDays7 ?? selected.trainDays30 ?? 0;
    if (!canListTone(tone)) {
      setErr(
        `Неактив: явка ${days7}/7д (нужно ≥${MIN_TRAIN_DAYS_WEEK} за неделю). Резерв можно выставлять всегда.`,
      );
      return;
    }
    const amount = Math.round(
      Number(String(askPrice).replace(/\s+/g, "")) || 0,
    );
    if (amount < 1) {
      setErr("Укажите стартовую цену");
      return;
    }
    if (amount < selected.estimate) {
      setErr(
        `Нельзя ниже рынка (${selected.estimate.toLocaleString("ru-RU")} B$)`,
      );
      return;
    }
    if (
      !window.confirm(
        `Выставить ${selected.nick} на аукцион?\n` +
          `Категория: ${toneLabel(tone)}\n` +
          `Явка: ${days7} TR-дней за неделю` +
          (selected.trainDays30 != null
            ? ` · ${selected.trainDays30}/30д`
            : "") +
          `\n` +
          `Рынок: ${selected.estimate.toLocaleString("ru-RU")} B$\n` +
          `Старт / мин.: ${amount.toLocaleString("ru-RU")} B$\n` +
          `Срок: ${days} дн.\n` +
          `Игрок остаётся в составе, пока кого-то не купят или не истечёт срок без ставок.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/auction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "faction_list",
            userId: selected.userId,
            askPrice: amount,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        marketBd?: number;
        nick?: string;
      };
      if (!res.ok) {
        setErr(json.message || json.error || "Не удалось выставить");
        return;
      }
      setMsg(`${json.nick || selected.nick} на аукционе`);
      setListUserId("");
      setAskPrice("");
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function cancelLot(lotId: string, nick: string) {
    if (!manage) return;
    if (!window.confirm(`Снять ${nick} с аукциона? Ставки вернутся.`)) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/auction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "cancel_faction_list", lotId }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(json.error || "Не удалось снять");
        return;
      }
      setMsg(`${nick} снят с аукциона`);
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function placeBid(lotId: string) {
    if (!manage) return;
    const raw = bidDraft[lotId] || "";
    const amountBd = Math.round(Number(String(raw).replace(/\s+/g, "")) || 0);
    if (amountBd < 1) {
      setErr("Укажите сумму ставки");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/auction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "bid", lotId, amountBd }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(json.error || "Ставка не принята");
        return;
      }
      setBidDraft((d) => ({ ...d, [lotId]: "" }));
      setMsg("Ставка принята");
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !err) {
    return <p className="muted">Загрузка аукциона…</p>;
  }

  return (
    <div className="xfer-tab-body xfer-staff-ops faction-xfer-auction">
      <section className="xfer-section">
        <h4>Аукцион игроков</h4>
        <p className="muted">
          Штаб выставляет бойца на торги. Минимум — рыночная стоимость; можно
          выше. Срок — {days} дней. Явка за 30 суток — не меньше{" "}
          <mark className="faction-guide-hi">{MIN_TRAIN_DAYS_30} TR-дней</mark>
          . Пока идут торги, игрок{" "}
          <mark className="faction-guide-hi">остаётся в составе</mark>. Без
          ставок к дедлайну — лот снимается, боец остаётся у вас. Победа другой
          фракции: <mark className="faction-guide-hi">20%</mark> игроку,{" "}
          <mark className="faction-guide-hi">80%</mark> вашей казне. Игроку и
          штабу — письма цветом фракции.
        </p>
        {data ? (
          <p className="faction-auction-meta">
            Казна «{data.factionName}»:{" "}
            <strong>
              <BdAmount n={data.treasury} />
            </strong>
            {" · "}
            Банк Аукциона:{" "}
            <strong>
              <BdAmount n={data.bankBalance} />
            </strong>
          </p>
        ) : null}
      </section>

      {msg ? <p className="xfer-msg">{msg}</p> : null}
      {err ? <p className="xfer-err">{err}</p> : null}

      {manage ? (
        <section className="xfer-section">
          <h4>Выставить на аукцион</h4>
          {!windowOpen ? (
            <p className="muted">
              Трансферное окно закрыто — выставление недоступно. Ставки по
              открытым лотам можно ставить.
            </p>
          ) : null}
          <div className="xfer-form xfer-auction-list-form">
            <div className="xfer-auction-picker">
              <button
                type="button"
                className={`xfer-nick-filter-input xfer-auction-picker-btn${
                  selected ? ` is-${auctionTone(selected)}` : ""
                }`}
                disabled={!windowOpen || busy}
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((v) => !v)}
              >
                {selected ? (
                  <>
                    <span className="xfer-auction-picker-nick">
                      {selected.nick}
                    </span>
                    <span className="xfer-auction-picker-meta">
                      {" "}
                      · рынок {selected.estimate.toLocaleString("ru-RU")} B$ ·
                      явка {selected.trainDays7 ?? selected.trainDays30 ?? 0}
                      /7д · {toneLabel(auctionTone(selected))}
                    </span>
                  </>
                ) : (
                  "Игрок…"
                )}
              </button>
              {pickerOpen ? (
                <ul className="xfer-auction-picker-list" role="listbox">
                  {members
                    .filter((p) => !onAuctionIds.has(p.userId))
                    .map((p) => {
                      const tone = auctionTone(p);
                      const days7 = p.trainDays7 ?? p.trainDays30 ?? 0;
                      const can = canListTone(tone);
                      return (
                        <li key={p.userId}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={p.userId === listUserId}
                            className={`xfer-auction-picker-opt is-${tone}${
                              p.userId === listUserId ? " is-selected" : ""
                            }`}
                            onClick={() => {
                              if (!can) {
                                setErr(
                                  `Неактив (явка ${days7}/7д): нужно ≥${MIN_TRAIN_DAYS_WEEK} TR за неделю. Резерв — всегда можно.`,
                                );
                                setListUserId("");
                                setPickerOpen(false);
                                return;
                              }
                              setErr("");
                              setListUserId(p.userId);
                              setPickerOpen(false);
                            }}
                          >
                            <span className="xfer-auction-picker-nick">
                              {p.nick}
                            </span>
                            <span className="xfer-auction-picker-meta">
                              {" "}
                              · рынок {p.estimate.toLocaleString("ru-RU")} B$ ·
                              явка {days7}/7д · {toneLabel(tone)}
                              {!can ? " · нельзя" : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              ) : null}
            </div>
            <input
              className="xfer-nick-filter-input"
              type="text"
              inputMode="numeric"
              placeholder="Старт ≥ рынок"
              value={askPrice}
              disabled={!windowOpen || busy || !selected}
              onChange={(e) => setAskPrice(e.target.value)}
            />
            <button
              type="button"
              className="btn primary"
              disabled={!windowOpen || busy || !selected}
              onClick={() => void listPlayer()}
            >
              На аукцион
            </button>
          </div>
          <p className="muted xfer-auction-tone-legend">
            <span className="xfer-opt-active-label">белый</span> — актив (≥
            {MIN_TRAIN_DAYS_WEEK}/7д) ·{" "}
            <span className="xfer-opt-reserve-label">голубой</span> — резерв
            (можно всегда) ·{" "}
            <span className="xfer-opt-inactive-label">красный</span> — неактив
            (&lt;{MIN_TRAIN_DAYS_WEEK}/7д, нельзя)
          </p>
          {selected ? (
            <p className="muted">
              <span className={`xfer-opt-${auctionTone(selected)}-label`}>
                {toneLabel(auctionTone(selected))}
              </span>
              {" · "}
              явка {selected.trainDays7 ?? 0}/7д
              {selected.trainDays30 != null
                ? ` · ${selected.trainDays30}/30д`
                : ""}
              {" · рынок "}
              <BdAmount n={selected.estimate} /> · ниже нельзя
            </p>
          ) : null}
        </section>
      ) : (
        <p className="muted">Выставлять и ставить может только командир или зам.</p>
      )}

      <section className="xfer-section">
        <h4>Открытые лоты</h4>
        {!openLots.length ? (
          <p className="muted">Сейчас никто не на торгах.</p>
        ) : (
          <div className="faction-auction-lots">
            {openLots.map((l) => {
              const mine =
                l.lotKind === "faction_list" &&
                l.sourceFactionId === data?.factionId;
              return (
                <article key={l.id} className="faction-auction-lot">
                  <header className="faction-auction-lot-head">
                    <div className="faction-auction-lot-who">
                      <strong className="xfer-nick">{l.nick}</strong>
                      {l.lotKind ? (
                        <span className="xfer-pill is-sell">
                          {" "}
                          {lotKindLabel(l.lotKind)}
                        </span>
                      ) : null}
                    </div>
                    <span className="xfer-pill is-buy">
                      ещё {fmtRemain(l.remainingMs)}
                    </span>
                  </header>
                  <div className="faction-auction-lot-body">
                    <div className="faction-auction-lot-meta">
                      <p className="muted">
                        До {fmtWhen(l.endsAt)} МСК
                        {l.minBidBd ? (
                          <>
                            {" · мин. "}
                            <BdAmount n={l.minBidBd} />
                          </>
                        ) : null}
                        {l.topBid
                          ? ` · лидер: ${l.topBid.factionName}`
                          : " · ставок нет"}
                        {l.myBid ? (
                          <>
                            {" · ваша: "}
                            <BdAmount n={l.myBid.amountBd} />
                          </>
                        ) : null}
                      </p>
                      {manage ? (
                        <div className="faction-auction-bidform">
                          <input
                            className="xfer-nick-filter-input"
                            type="text"
                            inputMode="numeric"
                            placeholder="Сумма B$"
                            value={bidDraft[l.id] || ""}
                            onChange={(e) =>
                              setBidDraft((d) => ({
                                ...d,
                                [l.id]: e.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy}
                            onClick={() => void placeBid(l.id)}
                          >
                            Поставить
                          </button>
                          {mine ? (
                            <button
                              type="button"
                              className="btn"
                              disabled={busy}
                              onClick={() => void cancelLot(l.id, l.nick)}
                            >
                              Снять
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div
                      className="faction-auction-presets"
                      aria-label="Ставки фракций"
                    >
                      {presets.map((name) => {
                        const amt = bidAmountFor(l, name);
                        const isLead =
                          Boolean(l.topBid) &&
                          l.topBid!.factionName === name &&
                          amt > 0;
                        const isMineName = name === data?.factionName;
                        return (
                          <div
                            key={name}
                            className={`faction-auction-preset${
                              isLead ? " is-lead" : ""
                            }${isMineName ? " is-mine" : ""}${
                              amt > 0 ? " has-bid" : ""
                            }`}
                          >
                            <span className="faction-auction-preset-name">
                              {name}
                            </span>
                            <span
                              className={`faction-auction-preset-amt${
                                amt > 0 ? " is-plus" : " is-zero"
                              }`}
                            >
                              {amt > 0 ? <BdAmount n={amt} /> : <span>0</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="xfer-section">
        <h4>Недавние итоги</h4>
        <div className="xfer-table-wrap">
          <table className="xfer-table">
            <thead>
              <tr>
                <th>Игрок</th>
                <th>Тип</th>
                <th>Статус</th>
                <th>Итог</th>
                <th>До</th>
              </tr>
            </thead>
            <tbody>
              {doneLots.slice(0, 20).map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong className="xfer-nick">{l.nick}</strong>
                  </td>
                  <td className="muted">{lotKindLabel(l.lotKind)}</td>
                  <td>{l.status}</td>
                  <td>
                    {l.winningBidBd != null ? (
                      <>
                        <BdAmount n={l.winningBidBd} />
                        {l.topBid ? ` · ${l.topBid.factionName}` : ""}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted">{fmtWhen(l.endsAt)}</td>
                </tr>
              ))}
              {!doneLots.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    Пока пусто.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
