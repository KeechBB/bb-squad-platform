"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BdAmount } from "@/components/BdMark";
import { getCurrentSeason } from "@/lib/factionSeasons";

type LotBid = {
  factionId: string;
  factionName: string;
  amountBd: number;
  status: string;
};

type Lot = {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  remainingMs: number;
  nick: string;
  steamId: string;
  userId: string;
  winningBidBd: number | null;
  recruitCutBd: number | null;
  topBid: {
    amountBd: number;
    factionName: string;
    factionId: string;
    status: string;
  } | null;
  myBid: { amountBd: number; status: string } | null;
  bids: LotBid[];
};

type Payload = {
  canManage: boolean;
  factionId: string;
  factionName: string;
  treasury: number;
  bankBalance: number;
  hours: number;
  recruitCutRatio: number;
  presetFactions?: string[];
  lots: Lot[];
  error?: string;
};

const FALLBACK_FACTIONS = ["Орда", "Улей", "Сброд", "Стая", "Табор"];

function fmtRemain(ms: number) {
  if (ms <= 0) return "завершён";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
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

export function FactionAuctionPanel({
  slug,
  canManage,
}: {
  slug: string;
  canManage: boolean;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [bidDraft, setBidDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/auction`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as Payload;
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

  const season = useMemo(() => getCurrentSeason(), []);

  async function placeBid(lotId: string) {
    if (!data?.canManage && !canManage) return;
    const raw = bidDraft[lotId] || "";
    const amountBd = Math.round(Number(String(raw).replace(/\s+/g, "")) || 0);
    if (amountBd < 1) {
      setErr("Укажи сумму ставки");
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
  if (!data) {
    return <p className="error">{err || "Нет данных"}</p>;
  }

  const manage = canManage && data.canManage;
  const openLots = data.lots.filter((l) => l.status === "OPEN");
  const doneLots = data.lots.filter((l) => l.status !== "OPEN");
  const presets =
    data.presetFactions?.length === 5 ? data.presetFactions : FALLBACK_FACTIONS;

  return (
    <div className="faction-auction">
      <div className="faction-auction-head">
        <h3 className="xfer-title">Аукцион</h3>
        <p className="muted xfer-sub">
          СРИ на паузе. Новичок после бота — {data.hours} ч торгов. Победитель
          забирает игрока; проигравшие получают B$ обратно.{" "}
          {Math.round(data.recruitCutRatio * 100)}% победной ставки — рекруту,
          остальное в банк Аукциона.
        </p>
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
          {season ? (
            <>
              {" · "}
              {season.label}
              {!season.endAuctionEnabled ? " · межсезон пропуск" : null}
            </>
          ) : null}
        </p>
      </div>

      {err ? <p className="xfer-err">{err}</p> : null}

      <h4 className="faction-hr-sub">Открытые лоты</h4>
      {!openLots.length ? (
        <p className="muted">Сейчас никто не на торгах.</p>
      ) : (
        <div className="faction-auction-lots">
          {openLots.map((l) => (
            <article key={l.id} className="faction-auction-lot">
              <header className="faction-auction-lot-head">
                <div className="faction-auction-lot-who">
                  <strong className="xfer-nick">{l.nick}</strong>
                  <span className="muted"> · {l.steamId || "—"}</span>
                </div>
                <span className="xfer-pill is-buy">
                  ещё {fmtRemain(l.remainingMs)}
                </span>
              </header>

              <div className="faction-auction-lot-body">
                <div className="faction-auction-lot-meta">
                  <p className="muted">
                    До {fmtWhen(l.endsAt)} МСК
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
                    </div>
                  ) : (
                    <p className="muted">Ставки — только штаб фракции.</p>
                  )}
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
                    const isMine = name === data.factionName;
                    return (
                      <div
                        key={name}
                        className={`faction-auction-preset${
                          isLead ? " is-lead" : ""
                        }${isMine ? " is-mine" : ""}${
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
                          {amt > 0 ? (
                            <BdAmount n={amt} />
                          ) : (
                            <span>0</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <h4 className="faction-hr-sub">Недавние итоги</h4>
      <div className="xfer-table-wrap">
        <table className="xfer-table">
          <thead>
            <tr>
              <th>Игрок</th>
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
                <td colSpan={4} className="muted">
                  Пока пусто.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
