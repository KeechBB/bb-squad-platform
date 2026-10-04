"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HitSilhouetteMini } from "@/components/HitSilhouetteMini";
import {
  eventsForMatch,
  serverLabel,
  splitEvents,
  type KeechHuntEvent,
  type KeechHuntMatch,
} from "@/lib/keechHuntTypes";

type HistRow = {
  id: string;
  server: string;
  layerShort: string;
  startAt: string;
  endAt: string | null;
  net: number;
  noks: number;
  gotNoks: number;
  kills: number;
  deaths: number;
  revives: number;
};

type LiveMatchChip = {
  id: string;
  server: string;
  layerShort: string;
  startAt: string;
  noks: number;
  gotNoks: number;
  kills: number;
  deaths: number;
  revives: number;
  net: number;
  active?: boolean;
};

type Feed = {
  updatedAt: string;
  match: KeechHuntMatch | null;
  matches: LiveMatchChip[];
  columns: {
    noks: KeechHuntEvent[];
    gotNoks: KeechHuntEvent[];
    kills: KeechHuntEvent[];
    deaths: KeechHuntEvent[];
    revives: KeechHuntEvent[];
    net: number;
  } | null;
  history: HistRow[];
};

const KIND_LABEL: Record<KeechHuntEvent["kind"], string> = {
  nok: "Нок",
  gotnok: "Нокнули",
  kill: "Килл",
  death: "Смерть",
  revive: "Рес",
  self: "Сам",
};

function fmtDelta(n: number) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return v > 0 ? `+${v}` : String(v);
}

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function eventBody(e: KeechHuntEvent): string {
  const d = fmtDelta(e.delta);
  if (e.kind === "nok") return `Нокнул ${e.nick}`;
  if (e.kind === "gotnok") return `Нокнул тебя ${e.nick}`;
  if (e.kind === "kill") return `Убил ${e.nick} · ${d} RP`;
  if (e.kind === "death") return `Убит ${e.nick} · ${d} RP`;
  if (e.kind === "revive") return `Поднял ${e.nick} · ${d} RP`;
  return `Сам · ${d} RP`;
}

function EventRow({
  e,
  clickable,
  onHit,
}: {
  e: KeechHuntEvent;
  clickable?: boolean;
  onHit?: () => void;
}) {
  const plus = e.delta >= 0;
  return (
    <li className={`keech-hunt-row kind-${e.kind}`}>
      <span className="keech-hunt-time">{e.time}</span>
      <span className="keech-hunt-nick" title={e.nick}>
        {e.kind === "death" || e.kind === "gotnok"
          ? `← ${e.nick}`
          : e.kind === "self"
            ? "сам"
            : e.nick}
      </span>
      <span className={`keech-hunt-delta ${plus ? "plus" : "minus"}`}>
        {fmtDelta(e.delta)}
      </span>
      {clickable ? (
        <button
          type="button"
          className="keech-hunt-hit-btn"
          onClick={onHit}
          title="Попадания"
        >
          ◉
        </button>
      ) : (
        <span className="keech-hunt-hit-spacer" />
      )}
    </li>
  );
}

function Col({
  title,
  items,
  empty,
  onHit,
}: {
  title: string;
  items: KeechHuntEvent[];
  empty: string;
  onHit?: (e: KeechHuntEvent) => void;
}) {
  return (
    <section className="keech-hunt-col">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="muted keech-hunt-empty">{empty}</p>
      ) : (
        <ul className="keech-hunt-list">
          {items.map((e) => (
            <EventRow
              key={e.id}
              e={e}
              clickable={
                !!onHit &&
                (e.kind === "nok" ||
                  e.kind === "gotnok" ||
                  e.kind === "kill" ||
                  e.kind === "death")
              }
              onHit={onHit ? () => onHit(e) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminKeechHuntPanel() {
  const [data, setData] = useState<Feed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hitEv, setHitEv] = useState<KeechHuntEvent | null>(null);
  const [detail, setDetail] = useState<{
    match: KeechHuntMatch;
    columns: NonNullable<Feed["columns"]>;
  } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickTop = useRef(true);
  const prevTopId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/keech-hunt", { cache: "no-store" });
      if (r.status === 403) {
        setErr("forbidden");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as Feed);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fail");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  /**
   * Один источник: события только текущей карты (data.match).
   * Live-лог и правые колонки режутся из одного списка — без склейки карт/серверов.
   */
  const mapEvents = useMemo(
    () => eventsForMatch(data?.match ?? null),
    [data]
  );
  const liveLog = useMemo(
    () =>
      [...mapEvents].sort((a, b) => String(b.at).localeCompare(String(a.at))),
    [mapEvents]
  );
  const mapCols = useMemo(() => {
    if (!mapEvents.length) return null;
    const split = splitEvents(mapEvents);
    const net =
      Math.round(
        mapEvents.reduce((s, e) => s + (Number(e.delta) || 0), 0) * 10
      ) / 10;
    return { ...split, net };
  }, [mapEvents]);

  useEffect(() => {
    const topId = liveLog[0]?.id || null;
    const newerArrived = topId && topId !== prevTopId.current;
    prevTopId.current = topId;
    if (!stickTop.current && !newerArrived) return;
    if (newerArrived) stickTop.current = true;
    const el = listRef.current;
    if (el) el.scrollTop = 0;
  }, [liveLog]);

  function onChatScroll() {
    const el = listRef.current;
    if (!el) return;
    stickTop.current = el.scrollTop < 48;
  }

  const openMatch = async (id: string) => {
    const r = await fetch(`/api/admin/keech-hunt/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!r.ok) return;
    setDetail((await r.json()) as {
      match: KeechHuntMatch;
      columns: NonNullable<Feed["columns"]>;
    });
  };

  if (err === "forbidden") {
    return <p className="muted">Нет доступа</p>;
  }

  const cols = mapCols;
  const m = data?.match;
  const chips = data?.matches || [];

  const activeChip =
    chips.find((c) => c.active) ||
    (m
      ? {
          id: m.id,
          server: m.server,
          layerShort: m.layerShort,
          startAt: m.startAt,
          noks: m.noks ?? 0,
          gotNoks: m.gotNoks ?? 0,
          kills: m.kills,
          deaths: m.deaths,
          revives: m.revives,
          net: m.net,
          active: true,
        }
      : null);
  const otherChips = chips.filter((c) => !c.active && c.id !== activeChip?.id);
  const statusLine = activeChip
    ? `${serverLabel(activeChip.server)} · ${activeChip.layerShort || "?"}${
        otherChips.length
          ? `  · ещё: ${otherChips
              .map((c) => `${serverLabel(c.server)} ${c.layerShort || "?"}`)
              .join(", ")}`
          : ""
      }`
    : "Нет активной катки (PB1 / TR1)";

  return (
    <div className="keech-hunt-panel">
      <div className="keech-hunt-toolbar">
        <div>
          <strong>{statusLine}</strong>
          <span className="muted">
            {" "}
            · обновл. {fmtWhen(data?.updatedAt)} · опрос 5с · текущая карта
          </span>
        </div>
        <div className="keech-hunt-net">
          NET{" "}
          <b className={(cols?.net ?? m?.net ?? 0) >= 0 ? "plus" : "minus"}>
            {fmtDelta(cols?.net ?? m?.net ?? 0)}
          </b>
          <span className="muted">
            {" "}
            · N {cols?.noks.length ?? m?.noks ?? 0} / GN{" "}
            {cols?.gotNoks.length ?? m?.gotNoks ?? 0} / K{" "}
            {cols?.kills.length ?? m?.kills ?? 0} / D{" "}
            {cols?.deaths.length ?? m?.deaths ?? 0} / R{" "}
            {cols?.revives.length ?? m?.revives ?? 0}
          </span>
        </div>
      </div>

      <div className="keech-hunt-split">
        <aside className="keech-hunt-left card">
          <div className="journal-window keech-hunt-chat-window">
            <div className="journal-window-head">
              <span>Live-лог</span>
              <span className="muted">
                {liveLog.length
                  ? `${liveLog.length} · ${serverLabel(m?.server)} · ${
                      m?.layerShort || "?"
                    } · сверху новые`
                  : "пусто"}
              </span>
            </div>
            <div
              className="journal-chat keech-hunt-chat"
              ref={listRef}
              onScroll={onChatScroll}
              role="log"
              aria-live="polite"
            >
              {liveLog.length === 0 ? (
                <p className="journal-empty muted">
                  Жду ноки / киллы / смерти / ресы на текущей карте. Лог и
                  колонки справа — одни и те же события. Новые сверху.
                </p>
              ) : null}
              {liveLog.map((e) => {
                const plus = e.delta >= 0;
                const canHit =
                  e.kind === "nok" ||
                  e.kind === "gotnok" ||
                  e.kind === "kill" ||
                  e.kind === "death";
                return (
                  <article
                    key={e.id}
                    className={`journal-msg keech-hunt-msg kind-${e.kind}`}
                  >
                    <header className="journal-msg-meta">
                      <time dateTime={e.at}>{e.time}</time>
                      <span className="journal-msg-badge">
                        {KIND_LABEL[e.kind]}
                      </span>
                      <span className="journal-msg-tag">
                        [{serverLabel(e.server)}]
                      </span>
                      <span
                        className={`keech-hunt-msg-delta ${
                          plus ? "plus" : "minus"
                        }`}
                      >
                        {fmtDelta(e.delta)}
                      </span>
                      {canHit ? (
                        <button
                          type="button"
                          className="keech-hunt-hit-btn"
                          onClick={() => setHitEv(e)}
                          title="Попадания"
                        >
                          ◉
                        </button>
                      ) : null}
                    </header>
                    <p className="journal-msg-body">{eventBody(e)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="keech-hunt-right">
          <div className="keech-hunt-cols card">
            <Col
              title={`Ноки (${cols?.noks.length ?? 0})`}
              items={cols?.noks || []}
              empty="—"
              onHit={setHitEv}
            />
            <Col
              title={`Убил (${cols?.kills.length ?? 0})`}
              items={cols?.kills || []}
              empty="—"
              onHit={setHitEv}
            />
            <Col
              title={`Убили (${cols?.deaths.length ?? 0})`}
              items={cols?.deaths || []}
              empty="—"
              onHit={setHitEv}
            />
            <Col
              title={`Ресы (${cols?.revives.length ?? 0})`}
              items={cols?.revives || []}
              empty="—"
            />
            <Col
              title={`Нокнули (${cols?.gotNoks.length ?? 0})`}
              items={cols?.gotNoks || []}
              empty="—"
              onHit={setHitEv}
            />
          </div>

          <section className="card keech-hunt-history">
            <h3>Память матчей</h3>
            {(data?.history || []).length === 0 ? (
              <p className="muted">Пока нет закрытых матчей</p>
            ) : (
              <ul className="keech-hunt-hist-list">
                {(data?.history || []).map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="keech-hunt-hist-row"
                      onClick={() => void openMatch(h.id)}
                    >
                      <span>
                        {fmtWhen(h.startAt)} · {serverLabel(h.server)} ·{" "}
                        {h.layerShort}
                      </span>
                      <span>
                        N{h.noks}/GN{h.gotNoks ?? 0}/K{h.kills}/D{h.deaths}/R
                        {h.revives}{" "}
                        <b className={h.net >= 0 ? "plus" : "minus"}>
                          {fmtDelta(h.net)}
                        </b>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {hitEv ? (
        <div className="rp-breakdown-overlay" role="dialog" aria-modal="true">
          <div className="rp-breakdown-panel keech-hit-dialog">
            <header className="rp-breakdown-head">
              <div>
                <h3>
                  {hitEv.kind === "death"
                    ? "Убит"
                    : hitEv.kind === "gotnok"
                      ? "Нокнули"
                      : hitEv.kind === "nok"
                        ? "Нок"
                        : "Попадания в"}{" "}
                  {hitEv.nick}
                </h3>
                <p className="muted">
                  {hitEv.time} · [{serverLabel(hitEv.server)}] ·{" "}
                  {fmtDelta(hitEv.delta)} RP
                </p>
              </div>
              <button
                type="button"
                className="rp-breakdown-close"
                onClick={() => setHitEv(null)}
              >
                ✕
              </button>
            </header>
              <HitSilhouetteMini
              bones={hitEv.bones || {}}
              title={
                hitEv.kind === "death" || hitEv.kind === "gotnok"
                  ? "Хиты по тебе на PB1 могут быть редкими — на TR1 BBHitZone обычно полнее"
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}

      {detail ? (
        <div className="rp-breakdown-overlay" role="dialog" aria-modal="true">
          <div className="rp-breakdown-panel">
            <header className="rp-breakdown-head">
              <div>
                <h3>
                  {serverLabel(detail.match.server)} · {detail.match.layerShort}{" "}
                  · {fmtWhen(detail.match.startAt)}
                </h3>
                <p className="muted">
                  NET {fmtDelta(detail.match.net)} · N {detail.match.noks ?? 0} /
                  GN {detail.match.gotNoks ?? detail.columns.gotNoks?.length ?? 0}{" "}
                  / K {detail.match.kills} / D {detail.match.deaths} / R{" "}
                  {detail.match.revives}
                </p>
              </div>
              <button
                type="button"
                className="rp-breakdown-close"
                onClick={() => setDetail(null)}
              >
                ✕
              </button>
            </header>
            <div className="keech-hunt-cols detail">
              <Col
                title={`ноки (${detail.columns.noks.length})`}
                items={detail.columns.noks}
                empty="—"
                onHit={setHitEv}
              />
              <Col
                title={`+ киллы (${detail.columns.kills.length})`}
                items={detail.columns.kills}
                empty="—"
                onHit={setHitEv}
              />
              <Col
                title={`− смерти (${detail.columns.deaths.length})`}
                items={detail.columns.deaths}
                empty="—"
                onHit={setHitEv}
              />
              <Col
                title={`+ ресы (${detail.columns.revives.length})`}
                items={detail.columns.revives}
                empty="—"
              />
              <Col
                title={`нокнули (${detail.columns.gotNoks?.length ?? 0})`}
                items={detail.columns.gotNoks || []}
                empty="—"
                onHit={setHitEv}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
