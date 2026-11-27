"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BdAmount } from "@/components/BdMark";
import { DraggableModal } from "@/components/DraggableModal";
import { factionUiColor } from "@/lib/factionColors";
import { useFitTablePage } from "@/lib/useFitTablePage";

type MyValuePoint = {
  day: string;
  label: string;
  market: number;
  grind: number;
  cw: number;
  founding: number;
  total: number;
};

type MyValueEvent = {
  at: string;
  day: string;
  kind: "founding" | "grind" | "cw_main" | "cw_junior";
  label: string;
  delta: number;
};

type MyValueReport = {
  nick: string;
  kit: string | null;
  marketValue: number;
  grindBroughtBd: number;
  estimate: number;
  mainCwWins: number;
  juniorCwWins: number;
  cwBonus: number;
  foundingBonus: number;
  total: number;
  series: MyValuePoint[];
  events: MyValueEvent[];
};

function MyValueChart({ series }: { series: MyValuePoint[] }) {
  if (!series.length) return null;
  const w = 420;
  const h = 132;
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const vals = series.map((p) => p.total);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = Math.max(1, maxV - minV);
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const pts = series.map((p, i) => {
    const x = padL + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
    const y = padT + innerH - ((p.total - minV) / span) * innerH;
    return { x, y, p };
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area =
    `${line} L${pts[pts.length - 1]!.x.toFixed(1)} ${(padT + innerH).toFixed(1)} ` +
    `L${pts[0]!.x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const mid = series[Math.floor(series.length / 2)]!;
  return (
    <svg className="xfer-myval-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Динамика стоимости">
      <defs>
        <linearGradient id="xfer-myval-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(168,85,247,0.45)" />
          <stop offset="100%" stopColor="rgba(168,85,247,0.02)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#xfer-myval-fill)" />
      <path d={line} fill="none" stroke="#c4b5fd" strokeWidth="2.2" strokeLinejoin="round" />
      {pts.map((pt) => (
        <circle key={pt.p.day} cx={pt.x} cy={pt.y} r="2.4" fill="#e9d5ff" />
      ))}
      <text x={padL} y={h - 6} className="xfer-myval-axis" textAnchor="start">
        {first.label}
      </text>
      <text x={w / 2} y={h - 6} className="xfer-myval-axis" textAnchor="middle">
        {mid.label}
      </text>
      <text x={w - padR} y={h - 6} className="xfer-myval-axis" textAnchor="end">
        {last.label}
      </text>
    </svg>
  );
}

type XferSubTab =
  | "desk"
  | "ledger"
  | "market"
  | "closed"
  | "days"
  | "trains"
  | "players";
type SortDir = "asc" | "desc";

function xferSubTabKey(slug: string, staff: boolean) {
  return `bb-xfer-subtab:${slug}:${staff ? "staff" : "member"}`;
}

function normalizeXferSubTab(v: string | null, staff: boolean): XferSubTab | null {
  if (!v) return null;
  if (v === "deals") return "market"; // старое имя вкладки
  const ok =
    v === "desk" ||
    v === "ledger" ||
    v === "market" ||
    v === "closed" ||
    v === "days" ||
    v === "trains" ||
    v === "players";
  if (!ok) return null;
  if (!staff && v === "desk") return null;
  return v;
}

function timeToMinUi(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = String(t).split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
}

function matchChronoKey(m: {
  year?: number;
  month?: number;
  day?: number;
  timeMsk?: string | null;
  timeLabel?: string;
  dateLabel?: string;
}): number {
  let y = Number(m.year) || 0;
  let mo = Number(m.month) || 0;
  let d = Number(m.day) || 0;
  if ((!y || !mo || !d) && m.dateLabel) {
    const parts = String(m.dateLabel).split(".");
    if (parts.length >= 3) {
      d = Number(parts[0]) || d;
      mo = Number(parts[1]) || mo;
      y = Number(parts[2]) || y;
    }
  }
  return y * 1_000_000_000 + mo * 10_000_000 + d * 10_000 + timeToMinUi(m.timeMsk || m.timeLabel);
}

function cmpStr(a: string, b: string) {
  return String(a || "").localeCompare(String(b || ""), "ru", { sensitivity: "base" });
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
      <button type="button" className={`xfer-sort${active ? " is-on" : ""}`} onClick={onClick}>
        {label}
        {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
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
  grindBroughtBd?: number;
  /** Средний гринд B$ за одну катку. */
  grindAvgPerMatchBd?: number;
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
  listFeeRatio?: number;
  estimateLabel?: string;
  estimateHint?: string;
  rosterSize: number;
  eligible: boolean;
  treasury: number;
  treasuryLabel: string;
  canManage: boolean;
  raceGrace?: {
    endsAt: string;
    endsAtMs: number;
    remainingMs: number;
    windowId: string;
  } | null;
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
  ledger: {
    id: string;
    amount: number;
    kind: string;
    note: string | null;
    label: string;
    createdAt: string;
    userId?: string | null;
    nick?: string | null;
    steamId?: string | null;
  }[];
  grindMatches?: GrindMatchRow[];
  grindPlayers?: GrindPlayerRow[];
  dailyEconomy?: DailyEconomyRow[];
  deals?: {
    pending: DealRow[];
    closed: DealRow[];
  };
};

type DailyEconomyRow = {
  ymd: string;
  dateLabel: string;
  total: number;
  fromPlayers: number;
  fromBets: number;
  otherPlus: number;
  minusTotal: number;
  minusItems: {
    kind: string;
    kindLabel: string;
    note: string | null;
    amount: number;
  }[];
};

type GrindMatchFactionMember = {
  userId: string;
  nick: string;
  amount: number;
};

type GrindMatchFaction = {
  factionId: string;
  name: string;
  slug: string;
  amount: number;
  players: number;
  members?: GrindMatchFactionMember[];
};

type GrindMatchRow = {
  matchId: string;
  legacyId: string | null;
  mapName: string;
  serverKey: string;
  dateLabel: string;
  timeLabel: string;
  year?: number;
  month?: number;
  day?: number;
  timeMsk?: string | null;
  total: number;
  factions: GrindMatchFaction[];
};

type GrindPlayerRow = {
  userId: string;
  nick: string;
  factionId?: string | null;
  factionName?: string | null;
  factionSlug?: string | null;
  total: number;
  matches: number;
  avgPerMatch: number;
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

export type FactionTransfersScope = "full" | "deals" | "economy";

type Props = {
  slug: string;
  canManage: boolean;
  /** full — всё; deals — сделки; economy — казна + заработки. */
  scope?: FactionTransfersScope;
};

const DEAL_TABS: XferSubTab[] = ["desk", "market", "closed"];
const ECONOMY_TABS: XferSubTab[] = ["ledger", "days", "trains", "players"];

function tabsForScope(scope: FactionTransfersScope): XferSubTab[] | null {
  if (scope === "deals") return DEAL_TABS;
  if (scope === "economy") return ECONOMY_TABS;
  return null;
}

function defaultSubTab(scope: FactionTransfersScope, staff: boolean): XferSubTab {
  if (scope === "economy") return "ledger";
  if (scope === "deals") return staff ? "desk" : "market";
  return staff ? "desk" : "ledger";
}

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

/** Цвет ТИП: покупка / продажа относительно своей фракции. */
function dealTypePillClass(label: string) {
  if (label === "Продажа") return "xfer-pill is-sell";
  if (label === "Покупка" || label.startsWith("Покупка")) return "xfer-pill is-buy";
  return "xfer-pill is-done";
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
      {stats.grindBroughtBd != null && stats.grindBroughtBd > 0 ? (
        <div>
          <span className="muted">Гринд в казну</span>
          <strong>
            <BdAmount n={stats.grindBroughtBd} />
          </strong>
        </div>
      ) : null}
    </div>
  );
}

export function FactionTransfers({ slug, canManage, scope = "full" }: Props) {
  const allowedTabs = tabsForScope(scope);
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
  const [grindMatchId, setGrindMatchId] = useState<string | null>(null);
  const [grindMatchFactionId, setGrindMatchFactionId] = useState<string | null>(
    null,
  );
  const [dayYmd, setDayYmd] = useState<string | null>(null);
  const [daysSort, setDaysSort] = useState<{ key: string; dir: SortDir }>({
    key: "date",
    dir: "desc",
  });
  const [subTab, setSubTab] = useState<XferSubTab>(() =>
    defaultSubTab(scope, canManage),
  );
  const [ledgerSort, setLedgerSort] = useState<{ key: string; dir: SortDir }>({
    key: "when",
    dir: "desc",
  });
  const [marketSort, setMarketSort] = useState<{ key: string; dir: SortDir }>({
    key: "when",
    dir: "desc",
  });
  const [closedSort, setClosedSort] = useState<{ key: string; dir: SortDir }>({
    key: "when",
    dir: "desc",
  });
  const [trainsSort, setTrainsSort] = useState<{ key: string; dir: SortDir }>({
    key: "date",
    dir: "desc",
  });
  const [playersSort, setPlayersSort] = useState<{ key: string; dir: SortDir }>({
    key: "total",
    dir: "desc",
  });
  const [nickFilter, setNickFilter] = useState("");
  const nickFilterKey = nickFilter.trim().toLowerCase();
  /** Фильтр «Заработок игроков»: имя фракции или "" = все. */
  const [playersFactionFilter, setPlayersFactionFilter] = useState("");
  const [myValueOpen, setMyValueOpen] = useState(false);
  const [myValue, setMyValue] = useState<MyValueReport | null>(null);
  const [myValueLoading, setMyValueLoading] = useState(false);
  const [myValueErr, setMyValueErr] = useState("");
  const [graceNow, setGraceNow] = useState(() => Date.now());

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

  useEffect(() => {
    if (!data?.raceGrace?.endsAtMs) return;
    const id = window.setInterval(() => setGraceNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [data?.raceGrace?.endsAtMs]);

  const graceCountdown = useMemo(() => {
    const ends = data?.raceGrace?.endsAtMs;
    if (!ends) return null;
    const left = Math.max(0, ends - graceNow);
    const t = Math.floor(left / 1000);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }, [data?.raceGrace?.endsAtMs, graceNow]);

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
  const grindMatches = data?.grindMatches ?? [];
  const grindPlayers = data?.grindPlayers ?? [];
  const dailyEconomy = data?.dailyEconomy ?? [];

  const ledgerSorted = useMemo(() => {
    const q = nickFilterKey;
    const rows = ledgerRows.filter((e) => {
      if (!q) return true;
      const nick = (e.nick || "").toLowerCase();
      const steam = (e.steamId || "").toLowerCase();
      const note = (e.note || "").toLowerCase();
      return nick.includes(q) || steam.includes(q) || note.includes(q);
    });
    const dir = ledgerSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let c = 0;
      if (ledgerSort.key === "type") c = cmpStr(ledgerKindRu(a.kind), ledgerKindRu(b.kind));
      else if (ledgerSort.key === "amount") c = a.amount - b.amount;
      else if (ledgerSort.key === "note") c = cmpStr(a.note || "", b.note || "");
      else c = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return c * dir || cmpStr(a.id, b.id);
    });
    return rows;
  }, [ledgerRows, ledgerSort, nickFilterKey]);

  const pendingSorted = useMemo(() => {
    const rows = [...pendingDeals];
    const dir = marketSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let c = 0;
      if (marketSort.key === "status") c = cmpStr(a.statusLabel, b.statusLabel);
      else if (marketSort.key === "type") c = cmpStr(a.typeLabel, b.typeLabel);
      else if (marketSort.key === "player") c = cmpStr(a.playerNick, b.playerNick);
      else if (marketSort.key === "factions")
        c = cmpStr(`${a.fromFaction.name}${a.toFaction.name}`, `${b.fromFaction.name}${b.toFaction.name}`);
      else if (marketSort.key === "cash") c = (a.cashAmount || 0) - (b.cashAmount || 0);
      else c = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return c * dir || cmpStr(a.id, b.id);
    });
    return rows;
  }, [pendingDeals, marketSort]);

  const closedSorted = useMemo(() => {
    const rows = [...closedDeals];
    const dir = closedSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let c = 0;
      if (closedSort.key === "type") c = cmpStr(a.typeLabel, b.typeLabel);
      else if (closedSort.key === "player") c = cmpStr(a.playerNick, b.playerNick);
      else if (closedSort.key === "from") c = cmpStr(a.fromFaction.name, b.fromFaction.name);
      else if (closedSort.key === "to") c = cmpStr(a.toFaction.name, b.toFaction.name);
      else if (closedSort.key === "factions")
        c = cmpStr(`${a.fromFaction.name}${a.toFaction.name}`, `${b.fromFaction.name}${b.toFaction.name}`);
      else if (closedSort.key === "cash") c = (a.cashAmount || 0) - (b.cashAmount || 0);
      else {
        const ta = new Date(a.updatedAt || a.createdAt).getTime();
        const tb = new Date(b.updatedAt || b.createdAt).getTime();
        c = ta - tb;
      }
      return c * dir || cmpStr(a.id, b.id);
    });
    return rows;
  }, [closedDeals, closedSort]);

  const daysSorted = useMemo(() => {
    const rows = [...dailyEconomy];
    const dir = daysSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let c = 0;
      if (daysSort.key === "total") c = a.total - b.total;
      else if (daysSort.key === "players") c = a.fromPlayers - b.fromPlayers;
      else if (daysSort.key === "bets") c = a.fromBets - b.fromBets;
      else if (daysSort.key === "minus") c = a.minusTotal - b.minusTotal;
      else c = cmpStr(a.ymd, b.ymd);
      return c * dir || cmpStr(a.ymd, b.ymd);
    });
    return rows;
  }, [dailyEconomy, daysSort]);

  const dayOpen = useMemo(
    () => daysSorted.find((d) => d.ymd === dayYmd) || null,
    [daysSorted, dayYmd],
  );

  const trainsSorted = useMemo(() => {
    const rows = [...grindMatches];
    const dir = trainsSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let c = 0;
      if (trainsSort.key === "map") c = cmpStr(a.mapName, b.mapName);
      else if (trainsSort.key === "time") c = timeToMinUi(a.timeLabel) - timeToMinUi(b.timeLabel);
      else c = matchChronoKey(a) - matchChronoKey(b);
      return c * dir || cmpStr(a.matchId, b.matchId);
    });
    return rows;
  }, [grindMatches, trainsSort]);

  const playersFactionOptions = useMemo(() => {
    const byName = new Map<string, string>();
    for (const p of grindPlayers) {
      const name = (p.factionName || "").trim();
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, p.factionSlug || name);
    }
    return [...byName.entries()]
      .map(([name, slug]) => ({ name, slug }))
      .sort((a, b) => cmpStr(a.name, b.name));
  }, [grindPlayers]);

  const playersSorted = useMemo(() => {
    const q = nickFilterKey;
    const fac = playersFactionFilter;
    const rows = grindPlayers.filter((p) => {
      if (fac && (p.factionName || "") !== fac) return false;
      if (!q) return true;
      return (
        p.nick.toLowerCase().includes(q) ||
        p.userId.toLowerCase().includes(q) ||
        (p.factionName || "").toLowerCase().includes(q)
      );
    });
    const dir = playersSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let c = 0;
      if (playersSort.key === "nick") c = cmpStr(a.nick, b.nick);
      else if (playersSort.key === "faction")
        c = cmpStr(a.factionName || "", b.factionName || "");
      else if (playersSort.key === "matches") c = a.matches - b.matches;
      else if (playersSort.key === "avg") c = a.avgPerMatch - b.avgPerMatch;
      else c = a.total - b.total;
      return c * dir || cmpStr(a.userId, b.userId);
    });
    return rows;
  }, [grindPlayers, playersSort, nickFilterKey, playersFactionFilter]);

  const ledgerPage = useFitTablePage(ledgerSorted.length, Boolean(data) && subTab === "ledger");
  const pendingPage = useFitTablePage(pendingSorted.length, Boolean(data) && subTab === "market");
  const closedPage = useFitTablePage(closedSorted.length, Boolean(data) && subTab === "closed");
  const daysPage = useFitTablePage(daysSorted.length, Boolean(data) && subTab === "days");
  const trainsPage = useFitTablePage(trainsSorted.length, Boolean(data) && subTab === "trains");
  const playersPage = useFitTablePage(playersSorted.length, Boolean(data) && subTab === "players");

  useEffect(() => {
    ledgerPage.setPage(0);
    playersPage.setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset pages when filters change
  }, [nickFilterKey, playersFactionFilter]);
  const grindMatchOpen = useMemo(
    () => grindMatches.find((m) => m.matchId === grindMatchId) || null,
    [grindMatches, grindMatchId],
  );
  const grindMatchFactionOpen = useMemo(() => {
    if (!grindMatchOpen || !grindMatchFactionId) return null;
    return (
      grindMatchOpen.factions.find((f) => f.factionId === grindMatchFactionId) ||
      null
    );
  }, [grindMatchOpen, grindMatchFactionId]);

  function openGrindMatch(matchId: string) {
    setGrindMatchFactionId(null);
    setGrindMatchId(matchId);
  }
  function closeGrindMatch() {
    setGrindMatchFactionId(null);
    setGrindMatchId(null);
  }

  async function openMyValue() {
    setMyValueOpen(true);
    setMyValueErr("");
    setMyValueLoading(true);
    try {
      const res = await fetch(`/api/factions/${encodeURIComponent(slug)}/transfers/my-value`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as MyValueReport & { error?: string };
      if (!res.ok) {
        setMyValue(null);
        setMyValueErr(data.error || "Не удалось загрузить стоимость");
        return;
      }
      setMyValue(data);
    } catch {
      setMyValue(null);
      setMyValueErr("Сеть недоступна");
    } finally {
      setMyValueLoading(false);
    }
  }

  useEffect(() => {
    if (scope !== "full") {
      setSubTab(defaultSubTab(scope, isStaff));
      return;
    }
    const next = readXferSubTab(slug, isStaff);
    setSubTab(next);
  }, [slug, isStaff, scope]);

  useEffect(() => {
    if (allowedTabs && !allowedTabs.includes(subTab)) {
      setSubTab(defaultSubTab(scope, isStaff));
      return;
    }
    if (!isStaff && subTab === "desk") {
      setSubTab(scope === "deals" ? "market" : "ledger");
    }
  }, [isStaff, subTab, allowedTabs, scope]);

  function selectSubTab(id: XferSubTab) {
    if (!isStaff && id === "desk") return;
    if (allowedTabs && !allowedTabs.includes(id)) return;
    setSubTab(id);
    if (scope === "full") writeXferSubTab(slug, isStaff, id);
  }

  function showTab(id: XferSubTab) {
    if (id === "desk" && !isStaff) return false;
    if (allowedTabs) return allowedTabs.includes(id);
    return true;
  }

  function toggleSort(
    current: { key: string; dir: SortDir },
    set: (v: { key: string; dir: SortDir }) => void,
    key: string,
    resetPage: (n: number) => void,
  ) {
    if (current.key === key) set({ key, dir: current.dir === "asc" ? "desc" : "asc" });
    else set({ key, dir: key === "when" || key === "date" || key === "total" ? "desc" : "asc" });
    resetPage(0);
  }

  const ledgerVisible = ledgerSorted.slice(
    ledgerPage.safePage * ledgerPage.pageSize,
    ledgerPage.safePage * ledgerPage.pageSize + ledgerPage.pageSize,
  );
  const pendingVisible = pendingSorted.slice(
    pendingPage.safePage * pendingPage.pageSize,
    pendingPage.safePage * pendingPage.pageSize + pendingPage.pageSize,
  );
  const closedVisible = closedSorted.slice(
    closedPage.safePage * closedPage.pageSize,
    closedPage.safePage * closedPage.pageSize + closedPage.pageSize,
  );
  const daysVisible = daysSorted.slice(
    daysPage.safePage * daysPage.pageSize,
    daysPage.safePage * daysPage.pageSize + daysPage.pageSize,
  );
  const trainsVisible = trainsSorted.slice(
    trainsPage.safePage * trainsPage.pageSize,
    trainsPage.safePage * trainsPage.pageSize + trainsPage.pageSize,
  );
  const playersVisible = playersSorted.slice(
    playersPage.safePage * playersPage.pageSize,
    playersPage.safePage * playersPage.pageSize + playersPage.pageSize,
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
          <h3 className="xfer-title">
            {scope === "economy" ? "Экономика фракции" : "Трансферы"}
          </h3>
          {isStaff ? (
            <p className="muted xfer-sub">
              Казна:{" "}
              <strong>
                <BdAmount n={data.treasury} />
              </strong>
              {" · "}
              состав {data.rosterSize}/{data.minRoster}
              {!data.eligible ? " — для сделок нужно ≥30" : ""}
              {graceCountdown ? (
                <>
                  {" · "}
                  <span
                    className="xfer-race-grace"
                    title="До автоштрафа гонки фракций: кик случайного участника, если не будет исходящего трансфера"
                  >
                    {graceCountdown}
                  </span>
                </>
              ) : null}
            </p>
          ) : graceCountdown ? (
            <p className="xfer-sub">
              <span className="xfer-race-grace" title="До автоштрафа гонки фракций">
                {graceCountdown}
              </span>
            </p>
          ) : null}
        </div>
        <div className="xfer-head-aside">
          <button type="button" className="xfer-my-value-btn" onClick={() => void openMyValue()}>
            Изменения моей стоимости
          </button>
          {isStaff ? (
            <div className={`xfer-window ${data.window.isOpen ? "is-open" : "is-closed"}`}>
              {data.window.isOpen
                ? "Трансферное окно открыто"
                : data.window.reason || "Трансферное окно закрыто"}
            </div>
          ) : null}
        </div>
      </div>

      <div className="admin-tabs clan-tabs xfer-subtabs" role="tablist">
        {showTab("desk") ? (
          <button
            type="button"
            className={`admin-tab${subTab === "desk" ? " active" : ""}`}
            onClick={() => selectSubTab("desk")}
          >
            Выставление
          </button>
        ) : null}
        {showTab("ledger") ? (
          <button
            type="button"
            className={`admin-tab${subTab === "ledger" ? " active" : ""}`}
            onClick={() => selectSubTab("ledger")}
          >
            Движение казны
          </button>
        ) : null}
        {showTab("market") ? (
          <button
            type="button"
            className={`admin-tab${subTab === "market" ? " active" : ""}`}
            onClick={() => selectSubTab("market")}
          >
            Оферы · рынок
          </button>
        ) : null}
        {showTab("closed") ? (
          <button
            type="button"
            className={`admin-tab${subTab === "closed" ? " active" : ""}`}
            onClick={() => selectSubTab("closed")}
          >
            Успешные сделки
          </button>
        ) : null}
        {showTab("days") ? (
          <button
            type="button"
            className={`admin-tab${subTab === "days" ? " active" : ""}`}
            onClick={() => selectSubTab("days")}
          >
            Доход по дням
          </button>
        ) : null}
        {showTab("trains") ? (
          <button
            type="button"
            className={`admin-tab${subTab === "trains" ? " active" : ""}`}
            onClick={() => selectSubTab("trains")}
          >
            Заработок фракций
          </button>
        ) : null}
        {showTab("players") ? (
          <button
            type="button"
            className={`admin-tab${subTab === "players" ? " active" : ""}`}
            onClick={() => selectSubTab("players")}
          >
            Заработок игроков
          </button>
        ) : null}
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
              {" · комиссия 1% с казны: "}
              <BdAmount
                n={Math.max(
                  1,
                  Math.round(listPrice * (data.listFeeRatio ?? 0.01))
                )}
              />
              {" (не возвращается)"}
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
          <div className="xfer-nick-filter">
            <label className="xfer-nick-filter-label" htmlFor="xfer-ledger-nick">
              Ник / Steam ID
            </label>
            <input
              id="xfer-ledger-nick"
              className="xfer-nick-filter-input"
              type="search"
              value={nickFilter}
              onChange={(e) => setNickFilter(e.target.value)}
              placeholder="Например Bahus или 7656119…"
              autoComplete="off"
              spellCheck={false}
            />
            {nickFilterKey ? (
              <button
                type="button"
                className="xfer-nick-filter-clear"
                onClick={() => setNickFilter("")}
              >
                Сброс
              </button>
            ) : null}
          </div>
          <div className="xfer-fit" ref={ledgerPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <SortTh
                      label="Когда"
                      active={ledgerSort.key === "when"}
                      dir={ledgerSort.dir}
                      onClick={() => toggleSort(ledgerSort, setLedgerSort, "when", ledgerPage.setPage)}
                    />
                    <SortTh
                      label="Тип"
                      active={ledgerSort.key === "type"}
                      dir={ledgerSort.dir}
                      onClick={() => toggleSort(ledgerSort, setLedgerSort, "type", ledgerPage.setPage)}
                    />
                    <SortTh
                      label="Сумма"
                      active={ledgerSort.key === "amount"}
                      dir={ledgerSort.dir}
                      onClick={() =>
                        toggleSort(ledgerSort, setLedgerSort, "amount", ledgerPage.setPage)
                      }
                    />
                    <SortTh
                      label="Комментарий"
                      active={ledgerSort.key === "note"}
                      dir={ledgerSort.dir}
                      onClick={() => toggleSort(ledgerSort, setLedgerSort, "note", ledgerPage.setPage)}
                    />
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
                  {!ledgerSorted.length ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        {nickFilterKey
                          ? "Нет строк по этому нику / Steam ID."
                          : "Пока пусто — гринд с TR1–TR5 пополнит казну."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <XferPager page={ledgerPage} total={ledgerSorted.length} />
        </div>
      ) : null}

      {subTab === "market" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-fit" ref={pendingPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <SortTh
                      label="Статус"
                      active={marketSort.key === "status"}
                      dir={marketSort.dir}
                      onClick={() =>
                        toggleSort(marketSort, setMarketSort, "status", pendingPage.setPage)
                      }
                    />
                    <SortTh
                      label="Тип"
                      active={marketSort.key === "type"}
                      dir={marketSort.dir}
                      onClick={() => toggleSort(marketSort, setMarketSort, "type", pendingPage.setPage)}
                    />
                    <SortTh
                      label="Игрок"
                      active={marketSort.key === "player"}
                      dir={marketSort.dir}
                      onClick={() =>
                        toggleSort(marketSort, setMarketSort, "player", pendingPage.setPage)
                      }
                    />
                    <SortTh
                      label="От / Кому"
                      active={marketSort.key === "factions"}
                      dir={marketSort.dir}
                      onClick={() =>
                        toggleSort(marketSort, setMarketSort, "factions", pendingPage.setPage)
                      }
                    />
                    <SortTh
                      label="Деньги"
                      active={marketSort.key === "cash"}
                      dir={marketSort.dir}
                      onClick={() => toggleSort(marketSort, setMarketSort, "cash", pendingPage.setPage)}
                    />
                    <SortTh
                      label="Когда"
                      active={marketSort.key === "when"}
                      dir={marketSort.dir}
                      onClick={() => toggleSort(marketSort, setMarketSort, "when", pendingPage.setPage)}
                    />
                  </tr>
                </thead>
                <tbody>
                  {pendingVisible.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className={`xfer-pill is-${d.side}`}>{d.statusLabel}</span>
                      </td>
                      <td>
                        <span className={dealTypePillClass(d.typeLabel)}>{d.typeLabel}</span>
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
                      <td>{formatWhen(d.createdAt)}</td>
                    </tr>
                  ))}
                  {!pendingSorted.length ? (
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
          <XferPager page={pendingPage} total={pendingSorted.length} />
        </div>
      ) : null}

      {subTab === "closed" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-fit" ref={closedPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <SortTh
                      label="Тип"
                      active={closedSort.key === "type"}
                      dir={closedSort.dir}
                      onClick={() => toggleSort(closedSort, setClosedSort, "type", closedPage.setPage)}
                    />
                    <SortTh
                      label="Игрок"
                      active={closedSort.key === "player"}
                      dir={closedSort.dir}
                      onClick={() =>
                        toggleSort(closedSort, setClosedSort, "player", closedPage.setPage)
                      }
                    />
                    <SortTh
                      label="От"
                      active={closedSort.key === "from"}
                      dir={closedSort.dir}
                      onClick={() =>
                        toggleSort(closedSort, setClosedSort, "from", closedPage.setPage)
                      }
                    />
                    <SortTh
                      label="Кому"
                      active={closedSort.key === "to"}
                      dir={closedSort.dir}
                      onClick={() =>
                        toggleSort(closedSort, setClosedSort, "to", closedPage.setPage)
                      }
                    />
                    <SortTh
                      label="Деньги"
                      active={closedSort.key === "cash"}
                      dir={closedSort.dir}
                      onClick={() => toggleSort(closedSort, setClosedSort, "cash", closedPage.setPage)}
                    />
                    <SortTh
                      label="Когда"
                      active={closedSort.key === "when"}
                      dir={closedSort.dir}
                      onClick={() => toggleSort(closedSort, setClosedSort, "when", closedPage.setPage)}
                    />
                  </tr>
                </thead>
                <tbody>
                  {closedVisible.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className={dealTypePillClass(d.typeLabel)}>{d.typeLabel}</span>
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
                      <td className="xfer-faction-from">{d.fromFaction.name}</td>
                      <td className="xfer-faction-to">{d.toFaction.name}</td>
                      <td>{d.cashAmount ? <BdAmount n={d.cashAmount} /> : "—"}</td>
                      <td>{formatWhen(d.updatedAt || d.createdAt)}</td>
                    </tr>
                  ))}
                  {!closedSorted.length ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        Успешных сделок пока нет.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <XferPager page={closedPage} total={closedSorted.length} />
        </div>
      ) : null}

      {subTab === "days" ? (
        <div className="xfer-tab-body xfer-tables">
          <p className="muted faction-hr-hint">
            Итог казны за календарный день (МСК). Нажми день — разбивка: игроки,
            ставки, минусы.
          </p>
          <div className="xfer-fit" ref={daysPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <SortTh
                      label="Дата"
                      active={daysSort.key === "date"}
                      dir={daysSort.dir}
                      onClick={() =>
                        toggleSort(daysSort, setDaysSort, "date", daysPage.setPage)
                      }
                    />
                    <SortTh
                      label="Итого"
                      active={daysSort.key === "total"}
                      dir={daysSort.dir}
                      onClick={() =>
                        toggleSort(daysSort, setDaysSort, "total", daysPage.setPage)
                      }
                    />
                  </tr>
                </thead>
                <tbody>
                  {daysVisible.map((d) => (
                    <tr
                      key={d.ymd}
                      className="xfer-row-click"
                      onClick={() => setDayYmd(d.ymd)}
                    >
                      <td>{d.dateLabel}</td>
                      <td className={d.total >= 0 ? "is-plus" : "is-minus"}>
                        <BdAmount n={d.total} signed />
                      </td>
                    </tr>
                  ))}
                  {!daysSorted.length ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        Пока нет движений казны.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <XferPager page={daysPage} total={daysSorted.length} />
        </div>
      ) : null}

      {subTab === "trains" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-fit" ref={trainsPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <SortTh
                      label="Дата"
                      active={trainsSort.key === "date"}
                      dir={trainsSort.dir}
                      onClick={() => toggleSort(trainsSort, setTrainsSort, "date", trainsPage.setPage)}
                    />
                    <SortTh
                      label="Время"
                      active={trainsSort.key === "time"}
                      dir={trainsSort.dir}
                      onClick={() => toggleSort(trainsSort, setTrainsSort, "time", trainsPage.setPage)}
                    />
                    <SortTh
                      label="Карта"
                      active={trainsSort.key === "map"}
                      dir={trainsSort.dir}
                      onClick={() => toggleSort(trainsSort, setTrainsSort, "map", trainsPage.setPage)}
                    />
                  </tr>
                </thead>
                <tbody>
                  {trainsVisible.map((m) => (
                    <tr
                      key={m.matchId}
                      className="xfer-row-click"
                      onClick={() => openGrindMatch(m.matchId)}
                    >
                      <td>{m.dateLabel}</td>
                      <td>{m.timeLabel}</td>
                      <td>
                        {m.mapName}
                        {m.serverKey ? (
                          <span className="muted"> · {String(m.serverKey).toUpperCase()}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!trainsSorted.length ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        Пока нет тренировок с гриндом B$.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <XferPager page={trainsPage} total={trainsSorted.length} />
        </div>
      ) : null}

      {subTab === "players" ? (
        <div className="xfer-tab-body xfer-tables">
          <div className="xfer-nick-filter xfer-players-filters">
            <label className="xfer-nick-filter-label" htmlFor="xfer-players-faction">
              Фракция
            </label>
            <select
              id="xfer-players-faction"
              className="xfer-nick-filter-input xfer-faction-filter-select"
              value={playersFactionFilter}
              onChange={(e) => setPlayersFactionFilter(e.target.value)}
            >
              <option value="">Все фракции</option>
              {playersFactionOptions.map((f) => (
                <option key={f.slug || f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
            <label className="xfer-nick-filter-label" htmlFor="xfer-players-nick">
              Ник / Steam ID
            </label>
            <input
              id="xfer-players-nick"
              className="xfer-nick-filter-input"
              type="search"
              value={nickFilter}
              onChange={(e) => setNickFilter(e.target.value)}
              placeholder="Например Bahus или 7656119…"
              autoComplete="off"
              spellCheck={false}
            />
            {nickFilterKey || playersFactionFilter ? (
              <button
                type="button"
                className="xfer-nick-filter-clear"
                onClick={() => {
                  setNickFilter("");
                  setPlayersFactionFilter("");
                }}
              >
                Сброс
              </button>
            ) : null}
          </div>
          <div className="xfer-fit" ref={playersPage.fitRef}>
            <div className="xfer-table-wrap">
              <table className="xfer-table">
                <thead>
                  <tr>
                    <SortTh
                      label="Ник"
                      active={playersSort.key === "nick"}
                      dir={playersSort.dir}
                      onClick={() =>
                        toggleSort(playersSort, setPlayersSort, "nick", playersPage.setPage)
                      }
                    />
                    <SortTh
                      label="Фракция"
                      active={playersSort.key === "faction"}
                      dir={playersSort.dir}
                      onClick={() =>
                        toggleSort(playersSort, setPlayersSort, "faction", playersPage.setPage)
                      }
                    />
                    <SortTh
                      label="Всего"
                      active={playersSort.key === "total"}
                      dir={playersSort.dir}
                      onClick={() =>
                        toggleSort(playersSort, setPlayersSort, "total", playersPage.setPage)
                      }
                    />
                    <SortTh
                      label="Игр"
                      active={playersSort.key === "matches"}
                      dir={playersSort.dir}
                      onClick={() =>
                        toggleSort(playersSort, setPlayersSort, "matches", playersPage.setPage)
                      }
                    />
                    <SortTh
                      label="Среднее за игру"
                      active={playersSort.key === "avg"}
                      dir={playersSort.dir}
                      onClick={() =>
                        toggleSort(playersSort, setPlayersSort, "avg", playersPage.setPage)
                      }
                    />
                  </tr>
                </thead>
                <tbody>
                  {playersVisible.map((p) => (
                    <tr key={p.userId}>
                      <td>
                        <XferNick>{p.nick}</XferNick>
                      </td>
                      <td>
                        {p.factionName ? (
                          <span
                            className="xfer-faction-name"
                            style={{
                              color: factionUiColor(p.factionName, p.factionSlug),
                            }}
                          >
                            {p.factionName}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="is-plus">
                        <BdAmount n={p.total} />
                      </td>
                      <td>{p.matches}</td>
                      <td className="is-plus">
                        <BdAmount n={p.avgPerMatch} />
                      </td>
                    </tr>
                  ))}
                  {!playersSorted.length ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        {nickFilterKey || playersFactionFilter
                          ? "Нет игроков по выбранному фильтру."
                          : "Пока никто не капнул гринд B$ в казну."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <XferPager page={playersPage} total={playersSorted.length} />
        </div>
      ) : null}

      {dayOpen ? (
        <DraggableModal open closeOnBackdrop onClose={() => setDayYmd(null)}>
          <header className="profile-match-modal-head" data-drag-handle title="Перетащить окно">
            <div>
              <p className="muted">Доход фракции за день</p>
              <h2 className="profile-mail-modal-title">{dayOpen.dateLabel}</h2>
              <p className="muted">Календарный день · МСК</p>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => setDayYmd(null)}
            >
              ×
            </button>
          </header>

          <div className="xfer-day-detail">
            <div className="xfer-day-total">
              <span className="muted">Итого</span>
              <strong className={dayOpen.total >= 0 ? "is-plus" : "is-minus"}>
                <BdAmount n={dayOpen.total} signed />
              </strong>
            </div>

            <ul className="xfer-day-summary">
              <li>
                <span>От игроков (гринд)</span>
                <span className="is-plus">
                  <BdAmount n={dayOpen.fromPlayers} signed />
                </span>
              </li>
              <li>
                <span>От ставок (выигрыш / возврат)</span>
                <span className="is-plus">
                  <BdAmount n={dayOpen.fromBets} signed />
                </span>
              </li>
              {dayOpen.otherPlus > 0 ? (
                <li>
                  <span>Прочий плюс</span>
                  <span className="is-plus">
                    <BdAmount n={dayOpen.otherPlus} signed />
                  </span>
                </li>
              ) : null}
              <li>
                <span>Минус</span>
                <span className="is-minus">
                  <BdAmount n={dayOpen.minusTotal} signed />
                </span>
              </li>
            </ul>

            <h4 className="faction-hr-sub">Минусы · за что</h4>
            {dayOpen.minusItems.length ? (
              <ul className="xfer-day-minus">
                {dayOpen.minusItems.map((item, i) => (
                  <li key={`${item.kind}-${i}-${item.amount}`}>
                    <div>
                      <strong>{item.kindLabel}</strong>
                      {item.note ? (
                        <p className="muted xfer-day-minus-note">{item.note}</p>
                      ) : null}
                    </div>
                    <span className="is-minus">
                      <BdAmount n={item.amount} signed />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Минусов за этот день не было.</p>
            )}
          </div>
        </DraggableModal>
      ) : null}

      {grindMatchOpen ? (
        <DraggableModal open closeOnBackdrop onClose={closeGrindMatch}>
          <header className="profile-match-modal-head" data-drag-handle title="Перетащить окно">
            <div>
              <p className="muted">Тренировочный матч · гринд B$</p>
              <h2 className="profile-mail-modal-title">{grindMatchOpen.mapName}</h2>
              <p className="muted">
                {grindMatchOpen.dateLabel} · {grindMatchOpen.timeLabel}
                {grindMatchOpen.serverKey
                  ? ` · ${String(grindMatchOpen.serverKey).toUpperCase()}`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={closeGrindMatch}
            >
              ×
            </button>
          </header>

          {grindMatchFactionOpen ? (
            <>
              <div className="xfer-grind-drill-head">
                <button
                  type="button"
                  className="xfer-grind-back"
                  onClick={() => setGrindMatchFactionId(null)}
                >
                  ← Все фракции
                </button>
                <p className="muted" style={{ margin: 0 }}>
                  {grindMatchFactionOpen.name} · приход по этой карте
                </p>
              </div>

              <ol className="xfer-grind-rank">
                {(grindMatchFactionOpen.members || []).length ? (
                  (grindMatchFactionOpen.members || []).map((p, i) => (
                    <li key={p.userId} className="is-earn">
                      <span className="xfer-grind-rank-n">{i + 1}</span>
                      <span className="xfer-grind-rank-name">{p.nick}</span>
                      <span className="xfer-grind-rank-people" aria-hidden="true" />
                      <span className="xfer-grind-rank-sum is-plus">
                        <BdAmount n={p.amount} signed />
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="is-zero">
                    <span className="xfer-grind-rank-n">—</span>
                    <span className="xfer-grind-rank-name">Нет игроков</span>
                    <span className="xfer-grind-rank-people" />
                    <span className="xfer-grind-rank-sum">—</span>
                  </li>
                )}
              </ol>

              <p className="muted" style={{ margin: "0.85rem 0 0" }}>
                Итого {grindMatchFactionOpen.name}:{" "}
                <BdAmount n={grindMatchFactionOpen.amount} />
              </p>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: "0 0 0.65rem" }}>
                Кто больше заработал в этой катке · ткни фракцию
              </p>

              <ol className="xfer-grind-rank">
                {grindMatchOpen.factions.map((f, i) => {
                  const clickable = f.amount > 0 && (f.members?.length || f.players) > 0;
                  return (
                    <li
                      key={f.factionId}
                      className={`${f.amount > 0 ? "is-earn" : "is-zero"}${
                        clickable ? " is-click" : ""
                      }`}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={
                        clickable
                          ? () => setGrindMatchFactionId(f.factionId)
                          : undefined
                      }
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setGrindMatchFactionId(f.factionId);
                              }
                            }
                          : undefined
                      }
                    >
                      <span className="xfer-grind-rank-n">{i + 1}</span>
                      <span className="xfer-grind-rank-name">{f.name}</span>
                      <span className="xfer-grind-rank-people">
                        {f.players > 0 ? `${f.players} чел.` : "—"}
                      </span>
                      <span
                        className={`xfer-grind-rank-sum${f.amount > 0 ? " is-plus" : ""}`}
                      >
                        {f.amount > 0 ? <BdAmount n={f.amount} signed /> : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <p className="muted" style={{ margin: "0.85rem 0 0" }}>
                Всего по матчу: <BdAmount n={grindMatchOpen.total} />
              </p>
            </>
          )}
        </DraggableModal>
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
              <div>
                <span className="muted">Среднее за игру</span>
                <strong>
                  {analytics.stats?.grindAvgPerMatchBd != null &&
                  analytics.stats.grindAvgPerMatchBd > 0 ? (
                    <BdAmount n={analytics.stats.grindAvgPerMatchBd} />
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
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

      {myValueOpen ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => setMyValueOpen(false)}
          className="xfer-myval-overlay"
          panelClassName="xfer-myval-panel"
        >
          <div className="profile-match-modal-head" data-drag-handle>
            <strong>Изменения моей стоимости</strong>
            <button type="button" className="btn" onClick={() => setMyValueOpen(false)}>
              Закрыть
            </button>
          </div>
          {myValueLoading ? (
            <p className="muted xfer-myval-msg">Считаем динамику…</p>
          ) : myValueErr ? (
            <p className="xfer-err xfer-myval-msg">{myValueErr}</p>
          ) : myValue ? (
            <div className="xfer-myval-body">
              <div className="xfer-myval-total">
                <span className="xfer-myval-total-label">
                  {myValue.nick}
                  {myValue.kit ? ` · ${myValue.kit}` : ""}
                </span>
                <strong className="xfer-myval-total-num">
                  <BdAmount n={myValue.total} />
                </strong>
              </div>
              <div className="xfer-myval-grid">
                <div className="xfer-myval-stat">
                  <span>Рынок</span>
                  <strong>
                    <BdAmount n={myValue.marketValue} />
                  </strong>
                </div>
                <div className="xfer-myval-stat">
                  <span>Гринд TR</span>
                  <strong>
                    <BdAmount n={myValue.grindBroughtBd} />
                  </strong>
                </div>
                <div className="xfer-myval-stat">
                  <span>КВ Main×{myValue.mainCwWins}</span>
                  <strong>
                    <BdAmount n={myValue.mainCwWins * 10000} />
                  </strong>
                </div>
                <div className="xfer-myval-stat">
                  <span>КВ Junior×{myValue.juniorCwWins}</span>
                  <strong>
                    <BdAmount n={myValue.juniorCwWins * 5000} />
                  </strong>
                </div>
                {myValue.foundingBonus > 0 ? (
                  <div className="xfer-myval-stat">
                    <span>Стартовый Main</span>
                    <strong>
                      <BdAmount n={myValue.foundingBonus} />
                    </strong>
                  </div>
                ) : null}
              </div>
              <MyValueChart series={myValue.series} />
              <p className="muted xfer-myval-hint">14 дней · рынок + накопленный гринд/КВ</p>
              {myValue.events.length ? (
                <ul className="xfer-myval-events">
                  {myValue.events.map((e, i) => (
                    <li key={`${e.at}-${e.kind}-${i}`}>
                      <span className="xfer-myval-ev-day">
                        {e.day.slice(8, 10)}.{e.day.slice(5, 7)}
                      </span>
                      <span className="xfer-myval-ev-label">{e.label}</span>
                      <strong className="xfer-myval-ev-delta">
                        +<BdAmount n={e.delta} />
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted xfer-myval-msg">Пока нет отдельных событий по гринду/КВ</p>
              )}
            </div>
          ) : null}
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
  if (kind === "listing_fee") return "Комиссия лота";
  if (kind === "admin_adjust") return "Правка";
  if (kind === "contract_fee") return "Контракт";
  if (kind === "salary_out") return "Зарплата";
  if (kind === "night_bet") return "Ставка";
  if (kind === "night_bet_win") return "Выигрыш ставки";
  if (kind === "night_bet_refund") return "Возврат ставки";
  if (kind === "auction_bid") return "Ставка аукциона";
  if (kind === "auction_refund") return "Возврат аукциона";
  if (kind === "market_buy") return "Маркет −";
  if (kind === "market_sell") return "Маркет +";
  if (kind === "officer_deposit") return "Взнос";
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
