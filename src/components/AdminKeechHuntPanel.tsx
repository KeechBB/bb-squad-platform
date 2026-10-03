"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HitSilhouetteMini } from "@/components/HitSilhouetteMini";
import type { KeechHuntEvent, KeechHuntMatch } from "@/lib/keechHunt";

type HistRow = {
  id: string;
  server: string;
  layerShort: string;
  startAt: string;
  endAt: string | null;
  net: number;
  kills: number;
  deaths: number;
  revives: number;
};

type Feed = {
  updatedAt: string;
  match: KeechHuntMatch | null;
  columns: {
    kills: KeechHuntEvent[];
    deaths: KeechHuntEvent[];
    revives: KeechHuntEvent[];
    net: number;
  } | null;
  history: HistRow[];
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
        {e.kind === "death" ? `← ${e.nick}` : e.kind === "self" ? "сам" : e.nick}
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
                !!onHit && (e.kind === "kill" || e.kind === "death")
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

  const liveLog = useMemo(() => {
    const ev = data?.match?.events || [];
    return [...ev].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }, [data]);

  if (err === "forbidden") {
    return <p className="muted">Нет доступа</p>;
  }

  const cols = data?.columns;
  const m = data?.match;

  return (
    <div className="keech-hunt-panel">
      <div className="keech-hunt-toolbar">
        <div>
          <strong>
            {m
              ? `${m.server} · ${m.layerShort}`
              : "Нет активной катки в live.json"}
          </strong>
          <span className="muted">
            {" "}
            · обновл. {fmtWhen(data?.updatedAt)} · опрос 5с
          </span>
        </div>
        <div className="keech-hunt-net">
          NET{" "}
          <b className={(m?.net || 0) >= 0 ? "plus" : "minus"}>
            {fmtDelta(m?.net || 0)}
          </b>
          <span className="muted">
            {" "}
            · K {m?.kills ?? 0} / D {m?.deaths ?? 0} / R {m?.revives ?? 0}
          </span>
        </div>
      </div>

      <div className="keech-hunt-split">
        <aside className="keech-hunt-left card">
          <h3>Live-лог</h3>
          <p className="muted keech-hunt-hint">
            По времени: кил / смерть / рес и ±RP
          </p>
          {liveLog.length === 0 ? (
            <p className="muted">Пока пусто — жди события на PB1 или рестарт коллектора</p>
          ) : (
            <ul className="keech-hunt-list live">
              {liveLog.map((e) => (
                <EventRow
                  key={e.id}
                  e={e}
                  clickable={e.kind === "kill" || e.kind === "death"}
                  onHit={() => setHitEv(e)}
                />
              ))}
            </ul>
          )}
        </aside>

        <div className="keech-hunt-right">
          <div className="keech-hunt-cols card">
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
                        {fmtWhen(h.startAt)} · {h.server} · {h.layerShort}
                      </span>
                      <span>
                        K{h.kills}/D{h.deaths}/R{h.revives}{" "}
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
                  {hitEv.kind === "kill" ? "Попадания в" : "Убит"} {hitEv.nick}
                </h3>
                <p className="muted">
                  {hitEv.time} · {fmtDelta(hitEv.delta)} RP
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
                hitEv.kind === "death"
                  ? "Хиты по тебе на PB1 пока не пишутся в этот трекер (только твои выстрелы)"
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
                  {detail.match.layerShort} · {fmtWhen(detail.match.startAt)}
                </h3>
                <p className="muted">
                  NET {fmtDelta(detail.match.net)} · K {detail.match.kills} / D{" "}
                  {detail.match.deaths} / R {detail.match.revives}
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
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
