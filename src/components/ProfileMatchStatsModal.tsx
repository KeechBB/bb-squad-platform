"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { abbreviateFaction } from "@/lib/factionAbbrev";

export type MatchStatsOpen =
  | {
      kind: "cw";
      matchId: string;
      title: string;
      sub: string;
      playersUrl: string;
      meeting?: string;
      /** Тег соперника — для вкладок oppR1/oppR2 */
      opp?: string;
      r1Label: string;
      r2Label: string;
      r1Tickets?: string;
      r2Tickets?: string;
      highlightNick?: string;
    }
  | {
      kind: "train";
      matchId: string;
      title: string;
      sub: string;
      playersUrl: string;
      factionA: string;
      ticketsA: number | null;
      factionB: string;
      ticketsB: number | null;
      winner?: string;
      duration?: string;
      highlightNick?: string;
    };

type PlayerRow = {
  nick: string;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
  kd: number;
  team?: string;
};

type MvpBlock = {
  medic: string[];
  killer: string[];
  damage: string[];
  antiDeath: string[];
};

type LoadedPlayers = {
  total: PlayerRow[];
  bbTotal: PlayerRow[];
  r1: PlayerRow[];
  r2: PlayerRow[];
  oppTotal: PlayerRow[];
  oppR1: PlayerRow[];
  oppR2: PlayerRow[];
  teamA: PlayerRow[];
  teamB: PlayerRow[];
  details: {
    r1?: { tickets?: string; len?: string };
    r2?: { tickets?: string; len?: string };
  } | null;
  mvpByRound: {
    r1: MvpBlock;
    r2: MvpBlock;
    oppR1: MvpBlock;
    oppR2: MvpBlock;
  };
  training: boolean;
  hasOpp: boolean;
};

type SortKey = "nick" | "res" | "nok" | "kills" | "deaths" | "kd" | "dmg" | "pwrDelta";
type TabKey =
  | "total"
  | "bbTotal"
  | "r1"
  | "r2"
  | "oppTotal"
  | "oppR1"
  | "oppR2"
  | "teamA"
  | "teamB";

function flipTickets(t?: string | null): string {
  if (!t || t === "—") return "—";
  const parts = String(t).split(":");
  if (parts.length !== 2) return String(t);
  return `${parts[1].trim()}:${parts[0].trim()}`;
}

const MVP_LABEL: Record<keyof MvpBlock, string> = {
  medic: "MVP Medic",
  killer: "MVP Killer",
  damage: "MVP War-Score",
  antiDeath: "Anti-MVP Death",
};

const MVP_CLASS: Record<keyof MvpBlock, string> = {
  medic: "medic",
  killer: "killer",
  damage: "war",
  antiDeath: "anti",
};

const MVP_ICON: Record<keyof MvpBlock, string> = {
  medic: "/kv-static/assets/mvp/medic.svg",
  killer: "/kv-static/assets/mvp/killer.svg",
  damage: "/kv-static/assets/mvp/damage.svg",
  antiDeath: "/kv-static/assets/mvp/anti-death.svg",
};

function enrich(rows: unknown[]): PlayerRow[] {
  return (rows || []).map((raw) => {
    const p = (raw || {}) as Record<string, unknown>;
    const kills = Number(p.kills) || 0;
    const deaths = Number(p.deaths) || 0;
    return {
      nick: String(p.nick || "—"),
      res: Number(p.res) || 0,
      nok: Number(p.nok) || 0,
      kills,
      deaths,
      dmg: Number(p.dmg) || 0,
      kd: deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100,
      team: p.team != null ? String(p.team) : undefined,
    };
  });
}

function sumRounds(r1: PlayerRow[], r2: PlayerRow[]): PlayerRow[] {
  const map = new Map<string, PlayerRow>();
  const add = (row: PlayerRow) => {
    if (!row.nick || row.nick === "—") return;
    const cur = map.get(row.nick) || {
      nick: row.nick,
      res: 0,
      nok: 0,
      kills: 0,
      deaths: 0,
      dmg: 0,
      kd: 0,
    };
    cur.res += row.res;
    cur.nok += row.nok;
    cur.kills += row.kills;
    cur.deaths += row.deaths;
    cur.dmg += row.dmg;
    cur.kd =
      cur.deaths === 0
        ? cur.kills
        : Math.round((cur.kills / cur.deaths) * 100) / 100;
    map.set(row.nick, cur);
  };
  r1.forEach(add);
  r2.forEach(add);
  return Array.from(map.values());
}

function maxOf(rows: PlayerRow[], key: keyof PlayerRow) {
  return rows.reduce((m, p) => Math.max(m, Number(p[key]) || 0), 0);
}

function emptyMvp(): MvpBlock {
  return { medic: [], killer: [], damage: [], antiDeath: [] };
}

function pickMvps(rows: PlayerRow[]): MvpBlock {
  if (!rows.length) return emptyMvp();
  const pool = rows.filter(
    (p) => p.res + p.nok + p.kills + p.deaths > 0
  );
  if (!pool.length) return emptyMvp();
  const nickCmp = (a: PlayerRow, b: PlayerRow) =>
    a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" });

  const pick = (
    key: "res" | "kills" | "dmg" | "deaths",
    tieBreak: (a: PlayerRow, b: PlayerRow) => number
  ) => {
    const top = maxOf(pool, key);
    if (top <= 0) return null;
    const tied = pool.filter((p) => p[key] === top).sort(tieBreak);
    return tied[0]?.nick || null;
  };

  return {
    medic: [
      pick("res", (a, b) => b.dmg - a.dmg || nickCmp(a, b)),
    ].filter(Boolean) as string[],
    killer: [
      pick("kills", (a, b) => b.nok - a.nok || nickCmp(a, b)),
    ].filter(Boolean) as string[],
    damage: [
      pick("dmg", (a, b) => b.kills - a.kills || nickCmp(a, b)),
    ].filter(Boolean) as string[],
    antiDeath: [
      pick(
        "deaths",
        (a, b) => a.kd - b.kd || a.dmg - b.dmg || nickCmp(a, b)
      ),
    ].filter(Boolean) as string[],
  };
}

function kvUrl(path: string) {
  const clean = path.replace(/^\//, "");
  return `/kv-static/${clean}`;
}

type Props = {
  open: MatchStatsOpen | null;
  onClose: () => void;
};

export function ProfileMatchStatsModal({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LoadedPlayers | null>(null);
  const [pwrDeltas, setPwrDeltas] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<TabKey>("total");
  const [sortKey, setSortKey] = useState<SortKey>("kills");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      setLoading(false);
      setPwrDeltas({});
      return;
    }
    setTab("total");
    setSortKey("kills");
    setSortDir("desc");
    setLoading(true);
    setError(null);
    setData(null);
    setPwrDeltas({});

    let cancelled = false;
    const kind = open.kind === "train" ? "train" : "cw";
    Promise.all([
      fetch(kvUrl(open.playersUrl), { cache: "no-store" }).then(async (res) => {
        if (!res.ok) throw new Error("Нет файла статистики");
        return res.json();
      }),
      fetch(
        `/api/match-pwr-delta?kind=${kind}&matchId=${encodeURIComponent(open.matchId)}`,
        { cache: "no-store" }
      )
        .then(async (res) => (res.ok ? res.json() : { deltas: {} }))
        .catch(() => ({ deltas: {} })),
    ])
      .then(([json, deltaPayload]) => {
        if (cancelled) return;
        const rawDeltas = (deltaPayload?.deltas || {}) as Record<string, number>;
        const normalized: Record<string, number> = {};
        for (const [k, v] of Object.entries(rawDeltas)) {
          normalized[k.trim().toLowerCase()] = Number(v) || 0;
        }
        setPwrDeltas(normalized);

        if (open.kind === "train") {
          const teamA = enrich(json.teamA || []);
          const teamB = enrich(json.teamB || []);
          const all = enrich(
            json.players?.length ? json.players : teamA.concat(teamB)
          );
          setData({
            total: all,
            bbTotal: [],
            r1: [],
            r2: [],
            oppTotal: [],
            oppR1: [],
            oppR2: [],
            teamA,
            teamB,
            details: json.details || null,
            mvpByRound: {
              r1: (json.mvp && json.mvp.train) || pickMvps(all),
              r2: emptyMvp(),
              oppR1: emptyMvp(),
              oppR2: emptyMvp(),
            },
            training: true,
            hasOpp: false,
          });
        } else {
          const r1 = enrich(json.r1 || []);
          const r2 = enrich(json.r2 || []);
          const oppR1 = enrich(json.oppR1 || []);
          const oppR2 = enrich(json.oppR2 || []);
          const bbTotal = enrich(
            json.total || json.players || sumRounds(r1, r2)
          );
          const oppTotal = enrich(json.oppTotal || sumRounds(oppR1, oppR2));
          const hasOpp = oppR1.length > 0 || oppR2.length > 0;
          // Итого = все игроки (BB + соперник)
          const total = hasOpp ? sumRounds(bbTotal, oppTotal) : bbTotal;
          setData({
            total,
            bbTotal,
            r1,
            r2,
            oppTotal,
            oppR1,
            oppR2,
            teamA: [],
            teamB: [],
            details: json.details || null,
            mvpByRound: {
              r1: (json.mvp && json.mvp.r1) || pickMvps(r1),
              r2: (json.mvp && json.mvp.r2) || pickMvps(r2),
              oppR1: (json.mvp && json.mvp.oppR1) || pickMvps(oppR1),
              oppR2: (json.mvp && json.mvp.oppR2) || pickMvps(oppR2),
            },
            training: false,
            hasOpp,
          });
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(
          "Не удалось загрузить статистику. Обнови страницу и открой катку ещё раз."
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.classList.add("profile-match-modal-open");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("profile-match-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  /** Если вкладка пустая (нет R2 и т.п.) — уводим на Итого, не на R1. */
  useEffect(() => {
    if (!data || data.training) return;
    const len: Record<TabKey, number> = {
      total: data.total.length,
      bbTotal: data.bbTotal.length,
      r1: data.r1.length,
      r2: data.r2.length,
      oppTotal: data.oppTotal.length,
      oppR1: data.oppR1.length,
      oppR2: data.oppR2.length,
      teamA: data.teamA.length,
      teamB: data.teamB.length,
    };
    if ((len[tab] || 0) > 0) return;
    // Prefer totals — never silently map empty tab onto R1 (looks like «Итого = раунд 1»).
    if (data.total.length) setTab("total");
    else if (data.bbTotal.length) setTab("bbTotal");
    else if (data.r1.length) setTab("r1");
    else if (data.r2.length) setTab("r2");
    else setTab("total");
  }, [data, tab]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (data.training) {
      if (tab === "teamA" || tab === "r1") return data.teamA;
      if (tab === "teamB" || tab === "r2") return data.teamB;
      return data.total;
    }
    if (tab === "bbTotal") return data.bbTotal;
    if (tab === "r1") return data.r1;
    if (tab === "r2") return data.r2;
    if (tab === "oppTotal") return data.oppTotal;
    if (tab === "oppR1") return data.oppR1;
    if (tab === "oppR2") return data.oppR2;
    return data.total;
  }, [data, tab]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const deltaOf = (nick: string) =>
      pwrDeltas[nick.trim().toLowerCase()];
    return rows.slice().sort((a, b) => {
      if (sortKey === "nick") {
        return dir * a.nick.localeCompare(b.nick, "ru");
      }
      if (sortKey === "pwrDelta") {
        const av = deltaOf(a.nick);
        const bv = deltaOf(b.nick);
        const an = av == null ? Number.NEGATIVE_INFINITY : av;
        const bn = bv == null ? Number.NEGATIVE_INFINITY : bv;
        if (an !== bn) return dir * (an - bn);
        return a.nick.localeCompare(b.nick, "ru");
      }
      const av = Number(a[sortKey]) || 0;
      const bv = Number(b[sortKey]) || 0;
      if (av !== bv) return dir * (av - bv);
      return a.nick.localeCompare(b.nick, "ru");
    });
  }, [rows, sortKey, sortDir, pwrDeltas]);

  const showPwrDelta = tab === "total" && open?.kind === "train";
  const hideWarScore = open?.kind === "train" || !!data?.training;

  const records = useMemo(() => {
    return {
      res: maxOf(sorted, "res"),
      nok: maxOf(sorted, "nok"),
      kills: maxOf(sorted, "kills"),
      deaths: maxOf(sorted, "deaths"),
      dmg: maxOf(sorted, "dmg"),
      kd: sorted.reduce((m, p) => Math.max(m, p.kd), 0),
    };
  }, [sorted]);

  const foot = useMemo(
    () =>
      sorted.reduce(
        (a, p) => ({
          res: a.res + p.res,
          nok: a.nok + p.nok,
          kills: a.kills + p.kills,
          deaths: a.deaths + p.deaths,
          dmg: a.dmg + p.dmg,
        }),
        { res: 0, nok: 0, kills: 0, deaths: 0, dmg: 0 }
      ),
    [sorted]
  );

  const medalCounts = useCallback(
    (nick: string) => {
      const counts = { medic: 0, killer: 0, damage: 0, antiDeath: 0 };
      if (!data) return counts;
      const keys = data.training
        ? (["r1"] as const)
        : tab === "total" && data.hasOpp
          ? (["r1", "r2", "oppR1", "oppR2"] as const)
          : tab === "total" || tab === "bbTotal"
            ? (["r1", "r2"] as const)
            : tab === "oppTotal"
              ? (["oppR1", "oppR2"] as const)
              : tab === "r1" || tab === "teamA"
                ? (["r1"] as const)
                : tab === "r2" || tab === "teamB"
                  ? (["r2"] as const)
                  : tab === "oppR1"
                    ? (["oppR1"] as const)
                    : tab === "oppR2"
                      ? (["oppR2"] as const)
                      : (["r1", "r2"] as const);
      for (const rk of keys) {
        const block = data.mvpByRound[rk];
        if (!block) continue;
        (Object.keys(counts) as (keyof typeof counts)[]).forEach((kind) => {
          if ((block[kind] || []).includes(nick)) counts[kind] += 1;
        });
      }
      return counts;
    },
    [data, tab]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "nick" ? "asc" : "desc");
    }
  };

  const sortMark = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? "▲" : "▼";
  };

  if (!open || !mounted) return null;

  const hasTabs = data
    ? data.training
      ? data.teamA.length > 0 || data.teamB.length > 0
      : data.r1.length > 0 || data.r2.length > 0 || data.hasOpp
    : false;

  const oppTag =
    open.kind === "cw"
      ? String(open.opp || "").trim() ||
        (open.title.includes(" vs ")
          ? open.title.split(" vs ").pop()?.trim() || "OPP"
          : "OPP")
      : "OPP";
  const showSidePrefix = Boolean(data?.hasOpp);

  const tabs: { key: TabKey; label: string; group?: "bb" | "opp" }[] =
    data?.training
      ? [
          { key: "total", label: "Все" },
          {
            key: "teamA",
            label: `${
              open.kind === "train" ? abbreviateFaction(open.factionA) : "A"
            } · ${open.kind === "train" ? open.ticketsA ?? "—" : "—"}`,
          },
          {
            key: "teamB",
            label: `${
              open.kind === "train" ? abbreviateFaction(open.factionB) : "B"
            } · ${open.kind === "train" ? open.ticketsB ?? "—" : "—"}`,
          },
        ]
      : open.kind === "cw"
        ? [
            {
              key: "total" as const,
              label: showSidePrefix ? "Итого · все" : "Итого",
              group: "bb" as const,
            },
            ...(data?.hasOpp
              ? [
                  {
                    key: "bbTotal" as const,
                    label: "BB · Итого",
                    group: "bb" as const,
                  },
                ]
              : []),
            ...((data?.r1.length || 0) > 0
              ? [
                  {
                    key: "r1" as const,
                    label: showSidePrefix
                      ? `BB · ${open.r1Label}`
                      : open.r1Label,
                    group: "bb" as const,
                  },
                ]
              : []),
            ...((data?.r2.length || 0) > 0
              ? [
                  {
                    key: "r2" as const,
                    label: showSidePrefix
                      ? `BB · ${open.r2Label}`
                      : open.r2Label,
                    group: "bb" as const,
                  },
                ]
              : []),
            ...(data?.hasOpp
              ? [
                  {
                    key: "oppTotal" as const,
                    label: `${oppTag} · Итого`,
                    group: "opp" as const,
                  },
                  ...((data?.oppR1.length || 0) > 0
                    ? [
                        {
                          key: "oppR1" as const,
                          label: `${oppTag} · Раунд 1 · ${flipTickets(open.r1Tickets)}`,
                          group: "opp" as const,
                        },
                      ]
                    : []),
                  ...((data?.oppR2.length || 0) > 0
                    ? [
                        {
                          key: "oppR2" as const,
                          label: `${oppTag} · Раунд 2 · ${flipTickets(open.r2Tickets)}`,
                          group: "opp" as const,
                        },
                      ]
                    : []),
                ]
              : []),
          ]
        : [];

  const highlight = (open.highlightNick || "").trim().toLowerCase();

  const modal = (
    <div className="profile-match-modal" role="presentation">
      <button
        type="button"
        className="profile-match-modal-backdrop"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        className="profile-match-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-match-modal-title"
      >
        <header className="profile-match-modal-head">
          <div>
            <h2 id="profile-match-modal-title">{open.title}</h2>
            <p className="profile-match-modal-sub muted">{open.sub}</p>
          </div>
          <button
            type="button"
            className="profile-match-modal-close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {hasTabs ? (
          <div className="profile-match-modal-tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                className={`profile-match-tab${
                  t.group === "opp" ? " profile-match-tab-opp" : ""
                }${tab === t.key ? " is-active" : ""}`}
                onClick={(e) => {
                  setTab(t.key);
                  // иначе :focus остаётся на прошлой кнопке и выглядит как «две активные»
                  (e.currentTarget as HTMLButtonElement).blur();
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="profile-match-modal-body">
          {loading ? (
            <p className="muted">Загрузка…</p>
          ) : error ? (
            <p className="muted">{error}</p>
          ) : !sorted.length ? (
            <p className="muted">Нет строк для этой вкладки.</p>
          ) : (
            <>
              <div className="profile-match-summary">
                {open.kind === "train" ? (
                  <>
                    <div>
                      <span className="muted">Дата</span>
                      <strong>{open.title.split(" · ")[0]}</strong>
                    </div>
                    <div>
                      <span className="muted">{abbreviateFaction(open.factionA)}</span>
                      <strong>{open.ticketsA ?? "—"}</strong>
                    </div>
                    <div>
                      <span className="muted">{abbreviateFaction(open.factionB)}</span>
                      <strong>{open.ticketsB ?? "—"}</strong>
                    </div>
                    <div>
                      <span className="muted">Победитель</span>
                      <strong>
                        {open.winner ? abbreviateFaction(open.winner) : "—"}
                      </strong>
                    </div>
                    <div>
                      <span className="muted">Время</span>
                      <strong>{open.duration || "—"}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="muted">Счёт встречи</span>
                      <strong>{open.meeting || "—"}</strong>
                    </div>
                    <div>
                      <span className="muted">
                        {tab.startsWith("opp")
                          ? `Тикеты (${oppTag}:BB)`
                          : "Тикеты"}
                      </span>
                      <strong>
                        {tab === "r1"
                          ? open.r1Tickets || "—"
                          : tab === "r2"
                            ? open.r2Tickets || "—"
                            : tab === "oppR1"
                              ? flipTickets(open.r1Tickets)
                              : tab === "oppR2"
                                ? flipTickets(open.r2Tickets)
                                : tab === "oppTotal"
                                  ? `${flipTickets(open.r1Tickets)} · ${flipTickets(open.r2Tickets)}`
                                  : `${open.r1Tickets || "—"} · ${open.r2Tickets || "—"}`}
                      </strong>
                    </div>
                  </>
                )}
              </div>

              <div className="profile-match-players-scroll">
                <table className="profile-match-players-table">
                  <thead>
                    <tr>
                      <th className="ctr">№</th>
                      <th
                        className={`sortable${sortKey === "nick" ? " is-sorted" : ""}`}
                        onClick={() => toggleSort("nick")}
                      >
                        Ник
                        <span className="sort-ind">{sortMark("nick")}</span>
                      </th>
                      {(
                        (
                          [
                            ["res", "Ресы"],
                            ["nok", "Ноки"],
                            ["kills", "Килы"],
                            ["deaths", "Смерти"],
                            ["kd", "KD"],
                            ["dmg", "Боевой счёт"],
                          ] as [SortKey, string][]
                        ).filter(([key]) => !(hideWarScore && key === "dmg"))
                      ).map(([key, label]) => (
                        <th
                          key={key}
                          className={`ctr sortable${sortKey === key ? " is-sorted" : ""}`}
                          onClick={() => toggleSort(key)}
                        >
                          {label}
                          <span className="sort-ind">{sortMark(key)}</span>
                        </th>
                      ))}
                      {showPwrDelta ? (
                        <th
                          className={`ctr sortable${sortKey === "pwrDelta" ? " is-sorted" : ""}`}
                          onClick={() => toggleSort("pwrDelta")}
                          title="Изменение RP после этой катки"
                        >
                          Δ RP
                          <span className="sort-ind">{sortMark("pwrDelta")}</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((p, i) => {
                      const medals = medalCounts(p.nick);
                      const isMe =
                        highlight &&
                        p.nick.trim().toLowerCase() === highlight;
                      const delta = pwrDeltas[p.nick.trim().toLowerCase()];
                      const deltaCls =
                        delta == null
                          ? "pwr-delta zero"
                          : delta > 0
                            ? "pwr-delta plus"
                            : delta < 0
                              ? "pwr-delta minus"
                              : "pwr-delta zero";
                      const deltaRounded =
                        delta == null ? null : Math.round(Number(delta) || 0);
                      const deltaText =
                        deltaRounded == null
                          ? "—"
                          : deltaRounded > 0
                            ? `+${deltaRounded}`
                            : String(deltaRounded);
                      return (
                        <tr
                          key={`${p.nick}-${i}`}
                          className={isMe ? "is-me" : undefined}
                        >
                          <td className="ctr">{i + 1}</td>
                          <td>
                            <div className="profile-match-nick-cell">
                              <Link
                                href={`/players/${encodeURIComponent(p.nick)}`}
                              >
                                {p.nick}
                              </Link>
                              <span className="mvp-row">
                                {(
                                  Object.keys(medals) as (keyof MvpBlock)[]
                                ).map((kind) => {
                                  if (hideWarScore && kind === "damage") return null;
                                  const n = medals[kind];
                                  if (!n) return null;
                                  const label =
                                    n > 1
                                      ? `×${n} ${MVP_LABEL[kind]}`
                                      : MVP_LABEL[kind];
                                  return (
                                    <span
                                      key={kind}
                                      className={`mvp-badge ${MVP_CLASS[kind]}`}
                                      title={label}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={MVP_ICON[kind]}
                                        alt=""
                                        width={14}
                                        height={14}
                                      />
                                      <span>{label}</span>
                                    </span>
                                  );
                                })}
                              </span>
                            </div>
                          </td>
                          <td
                            className={`ctr${records.res > 0 && p.res === records.res ? " record" : ""}`}
                          >
                            {p.res}
                          </td>
                          <td
                            className={`ctr${records.nok > 0 && p.nok === records.nok ? " record" : ""}`}
                          >
                            {p.nok}
                          </td>
                          <td
                            className={`ctr${records.kills > 0 && p.kills === records.kills ? " record" : ""}`}
                          >
                            {p.kills}
                          </td>
                          <td
                            className={`ctr${records.deaths > 0 && p.deaths === records.deaths ? " record anti" : ""}`}
                          >
                            {p.deaths}
                          </td>
                          <td
                            className={`ctr${records.kd > 0 && p.kd === records.kd ? " record" : ""}`}
                          >
                            {p.kd}
                          </td>
                          {!hideWarScore ? (
                            <td
                              className={`ctr${records.dmg > 0 && p.dmg === records.dmg ? " record" : ""}`}
                            >
                              {p.dmg}
                            </td>
                          ) : null}
                          {showPwrDelta ? (
                            <td className={`ctr ${deltaCls}`}>{deltaText}</td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <td>Всего</td>
                      <td className="ctr">{foot.res}</td>
                      <td className="ctr">{foot.nok}</td>
                      <td className="ctr">{foot.kills}</td>
                      <td className="ctr">{foot.deaths}</td>
                      <td className="ctr">
                        {foot.deaths
                          ? Math.round((foot.kills / foot.deaths) * 100) / 100
                          : foot.kills}
                      </td>
                      {!hideWarScore ? (
                        <td className="ctr">{foot.dmg}</td>
                      ) : null}
                      {showPwrDelta ? <td className="ctr">—</td> : null}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
