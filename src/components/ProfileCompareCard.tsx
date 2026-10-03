"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CompareMatchBundle,
  CompareSide,
  RpMatchListItem,
} from "@/lib/playerCompare";
import type { RpMatchEvent, RpPlayerMatch } from "@/lib/trainRp";
import { HitmapSilhouette } from "@/components/HitmapSilhouette";

type Props = {
  myNick: string;
};

type ComparePayload = {
  from: string | null;
  to: string | null;
  matchId?: string | null;
  match?: CompareMatchBundle | null;
  me: CompareSide;
  other: CompareSide;
};

function todayMskYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatRuDay(ymdStr: string): string {
  const p = parseYmd(ymdStr);
  if (!p) return ymdStr;
  return `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}`;
}

function fmtNum(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
}

/** Среднее за игру с округлением до десятых (0.6, 1.2 …). */
function avgPerGame(
  total: number | null | undefined,
  games: number | null | undefined
): number | null {
  const g = Number(games) || 0;
  if (g <= 0) return null;
  const t = Number(total) || 0;
  return Math.round((10 * t) / g) / 10;
}

function deltaCls(a: number | null, b: number | null, higherBetter = true) {
  if (a == null || b == null) return "";
  if (a === b) return "is-tie";
  const win = higherBetter ? a > b : a < b;
  return win ? "is-win" : "is-lose";
}

/** Лучше ли значение `mine` чем `theirs` (для подсветки). */
function isBetter(
  mine: number | null | undefined,
  theirs: number | null | undefined,
  higherBetter = true
): boolean {
  if (mine == null || theirs == null) return false;
  if (mine === theirs) return false;
  return higherBetter ? mine > theirs : mine < theirs;
}

function StatCell({
  label,
  value,
  better,
}: {
  label: string;
  value: string;
  better?: boolean;
}) {
  return (
    <div className={better ? "is-better" : undefined}>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function fmtDelta(n: number) {
  const v = Math.round(Number(n) || 0);
  return v > 0 ? `+${v}` : String(v);
}

function romanFromPwr(pwr: number) {
  const band = Math.min(9, Math.max(0, Math.floor(Math.max(0, pwr) / 100)));
  const roman = ["I", "II", "III"] as const;
  return roman[band % 3];
}

function pwrBarPct(pwr: number) {
  return Math.max(8, Math.min(100, (Math.max(0, pwr) / 1000) * 100));
}

function RpEventList({
  title,
  kind,
  events,
}: {
  title: string;
  kind: "gain" | "loss";
  events: RpMatchEvent[];
}) {
  const sum =
    kind === "gain"
      ? events.reduce((s, e) => s + e.delta, 0)
      : -events.reduce((s, e) => s + Math.abs(e.delta), 0);
  return (
    <section className="compare-rp-ev-col">
      <h5 className={`rp-breakdown-col-title ${kind === "gain" ? "gain" : "loss"}`}>
        {title} ({events.length})
      </h5>
      <ul className="rp-breakdown-list compare-rp-ev-list">
        {events.length === 0 ? (
          <li className="muted">Нет</li>
        ) : (
          events.map((e, i) => (
            <li key={`${kind}-${i}`}>
              <span className="rp-ev-time">{e.time}</span>
              <span
                className="rp-ev-nick"
                title={kind === "gain" ? e.victim : e.killer}
              >
                {kind === "gain" ? e.victim : e.killer}
              </span>
              <span
                className="rp-ev-bar-wrap"
                title={`weight ${kind === "gain" ? e.victimPwr : e.killerPwr}`}
              >
                <span
                  className={`rp-ev-bar ${kind === "gain" ? "gain" : "loss"}`}
                  style={{
                    width: `${pwrBarPct(
                      kind === "gain" ? e.victimPwr : e.killerPwr
                    )}%`,
                  }}
                />
                <span className="rp-ev-roman">
                  {romanFromPwr(kind === "gain" ? e.victimPwr : e.killerPwr)}
                </span>
              </span>
              <span
                className={`rp-ev-delta ${kind === "gain" ? "plus" : "minus"}`}
              >
                {kind === "gain"
                  ? fmtDelta(e.delta)
                  : fmtDelta(-Math.abs(e.delta))}
              </span>
            </li>
          ))
        )}
      </ul>
      <p className={`rp-breakdown-sum ${kind === "gain" ? "plus" : "minus"}`}>
        Sum {fmtDelta(sum)}
      </p>
    </section>
  );
}

function MatchRpSide({
  nick,
  match,
  combat,
  hitmap,
  otherNet,
  otherCombat,
  otherHitmap,
}: {
  nick: string;
  match: RpPlayerMatch | null;
  combat: CompareMatchBundle["meCombat"];
  hitmap: CompareMatchBundle["meHitmap"];
  otherNet: number | null;
  otherCombat: CompareMatchBundle["meCombat"];
  otherHitmap: CompareMatchBundle["meHitmap"];
}) {
  const net = match ? Math.round(match.net) : null;
  const hm = hitmap || {
    bones: {},
    total: 0,
    lastBone: null,
    zones: { head: 0, torso: 0, limb: 0 },
  };
  const oHm = otherHitmap || {
    bones: {},
    total: 0,
    lastBone: null,
    zones: { head: 0, torso: 0, limb: 0 },
  };
  const z = hm.zones || { head: 0, torso: 0, limb: 0 };
  const oz = oHm.zones || { head: 0, torso: 0, limb: 0 };

  return (
    <section className="compare-match-side">
      <header className="compare-match-side-head">
        <h4>{nick}</h4>
        <div
          className={`compare-match-net${
            isBetter(net, otherNet) ? " is-better" : ""
          }`}
        >
          <span className="muted">RP за катку</span>
          <strong>{net == null ? "—" : fmtDelta(net)}</strong>
        </div>
      </header>

      {combat ? (
        <div className="compare-stats-grid compare-match-combat">
          <StatCell
            label="Килы"
            value={fmtNum(combat.kills)}
            better={isBetter(combat.kills, otherCombat?.kills)}
          />
          <StatCell
            label="Смерти"
            value={fmtNum(combat.deaths)}
            better={isBetter(combat.deaths, otherCombat?.deaths, false)}
          />
          <StatCell
            label="KD"
            value={fmtNum(combat.kd, 2)}
            better={isBetter(combat.kd, otherCombat?.kd)}
          />
          <StatCell
            label="Поднятия"
            value={fmtNum(combat.res)}
            better={isBetter(combat.res, otherCombat?.res)}
          />
          <StatCell
            label="Ноки"
            value={fmtNum(combat.nok)}
            better={isBetter(combat.nok, otherCombat?.nok)}
          />
          <StatCell
            label="Боевой"
            value={combat.dmg.toLocaleString("ru-RU")}
            better={isBetter(combat.dmg, otherCombat?.dmg)}
          />
        </div>
      ) : (
        <p className="muted compare-hitmap-empty">Нет статы по этой катке</p>
      )}

      {match ? (
        <div className="compare-rp-ev-grid">
          <RpEventList title="+ получил" kind="gain" events={match.kills} />
          <RpEventList title="− отдал" kind="loss" events={match.deaths} />
          {(match.revives?.length || 0) > 0 ? (
            <RpEventList
              title="+ поднял"
              kind="gain"
              events={match.revives || []}
            />
          ) : null}
        </div>
      ) : (
        <p className="muted compare-hitmap-empty">
          Нет RP-событий (не было give-up киллов)
        </p>
      )}

      <div className="compare-match-hitmap">
        <p
          className={`muted compare-hitmap-total${
            isBetter(hm.total, oHm.total) ? " is-better" : ""
          }`}
        >
          Попадания за катку: <strong>{hm.total}</strong>
        </p>
        {hm.total > 0 ? (
          <>
            <div className="compare-hitmap-body">
              <HitmapSilhouette
                bones={hm.bones}
                total={hm.total}
                lastBone={hm.lastBone}
                compact
                className="compare-hitmap-svg"
              />
            </div>
            <ul className="compare-hitmap-zones">
              <li className={isBetter(z.head, oz.head) ? "is-better" : undefined}>
                <span>Голова</span>
                <b>{z.head}%</b>
              </li>
              <li
                className={isBetter(z.torso, oz.torso) ? "is-better" : undefined}
              >
                <span>Торс</span>
                <b>{z.torso}%</b>
              </li>
              <li
                className={
                  isBetter(z.limb, oz.limb, false) ? "is-better" : undefined
                }
              >
                <span>Конечности</span>
                <b>{z.limb}%</b>
              </li>
            </ul>
          </>
        ) : (
          <p className="muted compare-hitmap-empty">
            Нет попаданий за окно этой катки
          </p>
        )}
      </div>
    </section>
  );
}

function MatchCompareBlock({
  match,
  leftNick,
  rightNick,
}: {
  match: CompareMatchBundle;
  leftNick: string;
  rightNick: string;
}) {
  const dateShort =
    match.date.length >= 10
      ? match.date.slice(5).replace("-", ".")
      : match.date;
  return (
    <div className="compare-match-block">
      <div className="compare-match-title">
        <h3>
          Катка · {dateShort} · {match.map}
        </h3>
        <p className="muted">
          Стата матча · попадания · RP: за кого получил / кому отдал
        </p>
      </div>
      <div className="compare-match-pair">
        <MatchRpSide
          nick={leftNick}
          match={match.me}
          combat={match.meCombat}
          hitmap={match.meHitmap}
          otherNet={match.other ? Math.round(match.other.net) : null}
          otherCombat={match.otherCombat}
          otherHitmap={match.otherHitmap}
        />
        <div className="compare-vs-mid compare-match-mid">
          <span>VS</span>
          <div className="compare-diff">
            <div
              className={deltaCls(
                match.me ? Math.round(match.me.net) : null,
                match.other ? Math.round(match.other.net) : null
              )}
            >
              RP{" "}
              {match.me && match.other
                ? fmtDelta(
                    Math.round(match.me.net) - Math.round(match.other.net)
                  )
                : "—"}
            </div>
            <div
              className={deltaCls(
                match.meCombat?.kd ?? null,
                match.otherCombat?.kd ?? null
              )}
            >
              KD
            </div>
            <div
              className={deltaCls(
                match.meCombat?.dmg ?? null,
                match.otherCombat?.dmg ?? null
              )}
            >
              Боевой
            </div>
            <div
              className={deltaCls(
                match.meHitmap?.zones.head ?? null,
                match.otherHitmap?.zones.head ?? null
              )}
            >
              Голова
            </div>
          </div>
        </div>
        <MatchRpSide
          nick={rightNick}
          match={match.other}
          combat={match.otherCombat}
          hitmap={match.otherHitmap}
          otherNet={match.me ? Math.round(match.me.net) : null}
          otherCombat={match.meCombat}
          otherHitmap={match.meHitmap}
        />
      </div>
    </div>
  );
}

function NickPicker({
  label,
  value,
  draft,
  onDraft,
  onPick,
  suggestions,
}: {
  label: string;
  value: string;
  draft: string;
  onDraft: (v: string) => void;
  onPick: (nick: string) => void;
  suggestions: string[];
}) {
  const show =
    draft.trim().length > 0 &&
    draft.trim().toLowerCase() !== value.trim().toLowerCase();

  const commitExact = () => {
    const q = draft.trim().toLowerCase();
    if (!q) return;
    const hit =
      suggestions.find((n) => n.toLowerCase() === q) ||
      suggestions.find((n) => n.toLowerCase().startsWith(q));
    if (hit) {
      onPick(hit);
      onDraft(hit);
    }
  };

  return (
    <label className="compare-search">
      <span className="muted">{label}</span>
      <input
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitExact();
          }
        }}
        placeholder="Ник…"
        autoComplete="off"
      />
      {show && suggestions.length > 0 ? (
        <ul className="compare-suggest">
          {suggestions.map((n) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => {
                  onPick(n);
                  onDraft(n);
                }}
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}

function SideBlock({
  side,
  other,
}: {
  side: CompareSide;
  other: CompareSide;
}) {
  const train = side.train;
  const cw = side.cw;
  const oTrain = other.train;
  const oCw = other.cw;
  const rpBetter = isBetter(side.rp, other.rp);
  const placeBetter = isBetter(side.place, other.place, false);

  const trainAvgKills =
    train?.avgKills != null && train.matches > 0
      ? train.avgKills
      : avgPerGame(train?.kills, train?.matches);
  const otherTrainAvgKills =
    oTrain?.avgKills != null && oTrain.matches > 0
      ? oTrain.avgKills
      : avgPerGame(oTrain?.kills, oTrain?.matches);
  const trainAvgRes = avgPerGame(train?.res, train?.matches);
  const otherTrainAvgRes = avgPerGame(oTrain?.res, oTrain?.matches);
  const trainAvgScore =
    train?.avgDmg != null && train.matches > 0
      ? train.avgDmg
      : avgPerGame(train?.dmg, train?.matches);
  const otherTrainAvgScore =
    oTrain?.avgDmg != null && oTrain.matches > 0
      ? oTrain.avgDmg
      : avgPerGame(oTrain?.dmg, oTrain?.matches);

  const cwAvgKills =
    cw?.avgKills != null && cw.matches > 0
      ? cw.avgKills
      : avgPerGame(cw?.kills, cw?.matches);
  const otherCwAvgKills =
    oCw?.avgKills != null && oCw.matches > 0
      ? oCw.avgKills
      : avgPerGame(oCw?.kills, oCw?.matches);
  const cwAvgRes = avgPerGame(cw?.res, cw?.matches);
  const otherCwAvgRes = avgPerGame(oCw?.res, oCw?.matches);
  const cwAvgScore =
    cw?.avgDmg != null && cw.matches > 0
      ? cw.avgDmg
      : avgPerGame(cw?.dmg, cw?.matches);
  const otherCwAvgScore =
    oCw?.avgDmg != null && oCw.matches > 0
      ? oCw.avgDmg
      : avgPerGame(oCw?.dmg, oCw?.matches);

  return (
    <div className="compare-side">
      <header className="compare-side-head">
        <h3>{side.nick}</h3>
        <div className={`compare-rp-row${rpBetter ? " is-better" : ""}`}>
          <span className={`home-pwr-badge rank-${side.rankKey}`}>
            {side.rankLabel}
          </span>
          <strong>{side.rp != null ? Math.round(side.rp) : "—"}</strong>
          <span className="muted">RP</span>
          {side.place != null ? (
            <span
              className={`muted compare-place${placeBetter ? " is-better" : ""}`}
            >
              #{side.place}
            </span>
          ) : null}
        </div>
      </header>

      <div className="compare-stats-grid">
        <StatCell
          label="ТМ каток"
          value={fmtNum(train?.matches)}
          better={isBetter(train?.matches, oTrain?.matches)}
        />
        <StatCell
          label="ТМ W%"
          value={
            train?.winrate != null ? `${fmtNum(train.winrate, 1)}%` : "—"
          }
          better={isBetter(train?.winrate, oTrain?.winrate)}
        />
        <StatCell
          label="ТМ KD"
          value={train ? fmtNum(train.kd, 2) : "—"}
          better={isBetter(train?.kd, oTrain?.kd)}
        />
        <StatCell
          label="ТМ килы"
          value={fmtNum(train?.kills)}
          better={isBetter(train?.kills, oTrain?.kills)}
        />
        <StatCell
          label="ТМ ср. килы"
          value={trainAvgKills != null ? fmtNum(trainAvgKills, 1) : "—"}
          better={isBetter(trainAvgKills, otherTrainAvgKills)}
        />
        <StatCell
          label="ТМ ср. поднятия"
          value={trainAvgRes != null ? fmtNum(trainAvgRes, 1) : "—"}
          better={isBetter(trainAvgRes, otherTrainAvgRes)}
        />
        <StatCell
          label="ТМ ср. боевой"
          value={
            trainAvgScore != null
              ? Number.isInteger(trainAvgScore)
                ? String(trainAvgScore)
                : fmtNum(trainAvgScore, 1)
              : "—"
          }
          better={isBetter(trainAvgScore, otherTrainAvgScore)}
        />
        <StatCell
          label="КВ встреч"
          value={fmtNum(cw?.matches)}
          better={isBetter(cw?.matches, oCw?.matches)}
        />
        <StatCell
          label="КВ W%"
          value={cw?.winrate != null ? `${fmtNum(cw.winrate, 1)}%` : "—"}
          better={isBetter(cw?.winrate, oCw?.winrate)}
        />
        <StatCell
          label="КВ KD"
          value={cw ? fmtNum(cw.kd, 2) : "—"}
          better={isBetter(cw?.kd, oCw?.kd)}
        />
        <StatCell
          label="КВ килы"
          value={fmtNum(cw?.kills)}
          better={isBetter(cw?.kills, oCw?.kills)}
        />
        <StatCell
          label="КВ ср. килы"
          value={cwAvgKills != null ? fmtNum(cwAvgKills, 1) : "—"}
          better={isBetter(cwAvgKills, otherCwAvgKills)}
        />
        <StatCell
          label="КВ ср. поднятия"
          value={cwAvgRes != null ? fmtNum(cwAvgRes, 1) : "—"}
          better={isBetter(cwAvgRes, otherCwAvgRes)}
        />
        <StatCell
          label="КВ ср. боевой"
          value={
            cwAvgScore != null
              ? Number.isInteger(cwAvgScore)
                ? String(cwAvgScore)
                : fmtNum(cwAvgScore, 1)
              : "—"
          }
          better={isBetter(cwAvgScore, otherCwAvgScore)}
        />
      </div>

      {side.kits.length > 0 ? (
        <div className="compare-kits">
          <span className="muted">Топ роли</span>
          <ul>
            {side.kits.slice(0, 4).map((k) => (
              <li key={k.kit}>
                <span>{k.kit}</span>
                <b>{Math.round(k.pct * 10) / 10}%</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function HitmapSide({
  side,
  other,
}: {
  side: CompareSide;
  other: CompareSide;
}) {
  const hm = side.hitmap || {
    bones: {},
    total: 0,
    lastBone: null,
    zones: { head: 0, torso: 0, limb: 0 },
  };
  const oHm = other.hitmap || {
    bones: {},
    total: 0,
    lastBone: null,
    zones: { head: 0, torso: 0, limb: 0 },
  };
  const total = hm.total || 0;
  const z = hm.zones || { head: 0, torso: 0, limb: 0 };
  const oz = oHm.zones || { head: 0, torso: 0, limb: 0 };
  return (
    <section className="compare-hitmap-side">
      <h4>Попадания · {side.nick}</h4>
      <p
        className={`muted compare-hitmap-total${
          isBetter(total, oHm.total || 0) ? " is-better" : ""
        }`}
      >
        Всего: <strong>{total}</strong>
      </p>
      {total > 0 ? (
        <>
          <div className="compare-hitmap-body">
            <HitmapSilhouette
              bones={hm.bones}
              total={total}
              lastBone={hm.lastBone}
              compact
              className="compare-hitmap-svg"
            />
          </div>
          <ul className="compare-hitmap-zones">
            <li className={isBetter(z.head, oz.head) ? "is-better" : undefined}>
              <span>Голова</span>
              <b>{z.head}%</b>
            </li>
            <li
              className={isBetter(z.torso, oz.torso) ? "is-better" : undefined}
            >
              <span>Торс</span>
              <b>{z.torso}%</b>
            </li>
            <li
              className={
                isBetter(z.limb, oz.limb, false) ? "is-better" : undefined
              }
              title="Меньше конечностей обычно лучше"
            >
              <span>Конечности</span>
              <b>{z.limb}%</b>
            </li>
          </ul>
        </>
      ) : (
        <p className="muted compare-hitmap-empty">Нет данных попаданий</p>
      )}
    </section>
  );
}

type CompareProps = Props & {
  /** inline — только кнопка у аватара; card — отдельная колонка (legacy) */
  variant?: "inline" | "card";
};

export function ProfileCompareCard({
  myNick,
  variant = "inline",
}: CompareProps) {
  const [open, setOpen] = useState(false);
  const [nicks, setNicks] = useState<string[]>([]);
  const [trainMatches, setTrainMatches] = useState<RpMatchListItem[]>([]);
  const [matchId, setMatchId] = useState("");
  const [left, setLeft] = useState(myNick);
  const [right, setRight] = useState("");
  const [leftDraft, setLeftDraft] = useState(myNick);
  const [rightDraft, setRightDraft] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [pick, setPick] = useState<"from" | "to">("from");
  const [calOpen, setCalOpen] = useState(false);
  const today = todayMskYmd();
  const todayParts = parseYmd(today)!;
  const [viewY, setViewY] = useState(todayParts.y);
  const [viewM, setViewM] = useState(todayParts.m);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ComparePayload | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeft(myNick);
    setLeftDraft(myNick);
    setRight("");
    setRightDraft("");
    setMatchId("");
    setData(null);
    setError(null);
    setCalOpen(false);
    Promise.all([
      fetch("/api/player-compare?list=1", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { nicks: [] }
      ),
      fetch("/api/player-compare?list=matches", { cache: "no-store" }).then(
        (r) => (r.ok ? r.json() : { matches: [] })
      ),
    ])
      .then(([n, m]) => {
        setNicks(Array.isArray(n.nicks) ? n.nicks : []);
        setTrainMatches(Array.isArray(m.matches) ? m.matches : []);
      })
      .catch(() => {
        setNicks([]);
        setTrainMatches([]);
      });
  }, [open, myNick]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const filterSuggest = useCallback(
    (draft: string, lockedOther: string) => {
      const q = draft.trim().toLowerCase();
      const otherLow = lockedOther.trim().toLowerCase();
      return nicks
        .filter((n) => {
          const low = n.toLowerCase();
          if (otherLow && low === otherLow) return false;
          if (!q) return true;
          return low.includes(q);
        })
        .slice(0, 10);
    },
    [nicks]
  );

  const leftSuggestions = useMemo(
    () => filterSuggest(leftDraft, right),
    [filterSuggest, leftDraft, right]
  );
  const rightSuggestions = useMemo(
    () => filterSuggest(rightDraft, left),
    [filterSuggest, rightDraft, left]
  );

  const resolveNick = useCallback(
    (draft: string, locked: string) => {
      const q = draft.trim().toLowerCase();
      if (!q) return null;
      const otherLow = locked.trim().toLowerCase();
      const pool = nicks.filter((n) => n.toLowerCase() !== otherLow);
      const exact = pool.find((n) => n.toLowerCase() === q);
      if (exact) return exact;
      const starts = pool.filter((n) => n.toLowerCase().startsWith(q));
      if (starts.length === 1) return starts[0];
      const includes = pool.filter((n) => n.toLowerCase().includes(q));
      if (includes.length === 1) return includes[0];
      return null;
    },
    [nicks]
  );

  const runCompare = useCallback(
    async (meNick: string, otherNick: string) => {
      if (!meNick.trim() || !otherNick.trim()) {
        setError("Выбери обоих игроков");
        return;
      }
      if (meNick.trim().toLowerCase() === otherNick.trim().toLowerCase()) {
        setError("Выбери двух разных игроков");
        setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          me: meNick.trim(),
          other: otherNick.trim(),
        });
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        if (matchId) qs.set("matchId", matchId);
        const res = await fetch(`/api/player-compare?${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "Не удалось сравнить");
        }
        const payload = (await res.json()) as ComparePayload;
        setData(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [from, to, matchId]
  );

  const confirmCompare = useCallback(() => {
    const a = left.trim() || resolveNick(leftDraft, rightDraft) || "";
    const b = right.trim() || resolveNick(rightDraft, leftDraft) || "";
    if (!a || !b) {
      setError("Введи ники и нажми «Сравнить» (ник должен быть из списка)");
      return;
    }
    setLeft(a);
    setLeftDraft(a);
    setRight(b);
    setRightDraft(b);
    void runCompare(a, b);
  }, [left, right, leftDraft, rightDraft, resolveNick, runCompare]);

  useEffect(() => {
    if (!open || !left || !right || !data) return;
    void runCompare(left, right);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только период/катка
  }, [from, to, matchId]);

  const daysInMonth = useMemo(() => {
    const last = new Date(viewY, viewM, 0).getDate();
    const firstDow = (new Date(viewY, viewM - 1, 1).getDay() + 6) % 7;
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= last; d++) cells.push(d);
    return cells;
  }, [viewY, viewM]);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric",
    }).format(new Date(viewY, viewM - 1, 1));
  }, [viewY, viewM]);

  const periodLabel =
    from || to
      ? `${from ? formatRuDay(from) : "…"} — ${to ? formatRuDay(to) : "…"}`
      : "Все даты";

  const openBtn = (
    <button
      type="button"
      className={
        variant === "inline"
          ? "profile-compare-open-btn profile-compare-open-btn-inline"
          : "profile-compare-open-btn"
      }
      onClick={() => setOpen(true)}
    >
      Сравнить игроков
    </button>
  );

  return (
    <>
      {variant === "card" ? (
        <section className="card profile-compare-card">
          <div className="profile-kv-head">
            <h2>Сравнение</h2>
          </div>
          <p className="muted profile-compare-lead">
            Любой с любым: RP, ТМ/КВ, попадания; можно разобрать конкретную
            тренировку.
          </p>
          {openBtn}
        </section>
      ) : (
        <div className="profile-compare-inline">{openBtn}</div>
      )}

      {open ? (
        <div
          className="compare-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="compare-panel">
            <header className="compare-panel-head">
              <div className="compare-panel-title">
                <h2>Сравнение игроков</h2>
                <p className="muted">
                  {matchId
                    ? trainMatches.find((m) => m.id === matchId)?.label ||
                      "Катка"
                    : periodLabel}
                </p>
              </div>
              <button
                type="button"
                className="compare-close"
                aria-label="Закрыть"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>

            <div className="compare-body">
              <div className="compare-controls">
                <NickPicker
                  label="Игрок A"
                  value={left}
                  draft={leftDraft}
                  onDraft={(v) => {
                    setLeftDraft(v);
                    setLeft("");
                    setData(null);
                  }}
                  onPick={(n) => setLeft(n)}
                  suggestions={leftSuggestions}
                />

                <div className="compare-cal-wrap">
                  <span className="muted">Период</span>
                  <button
                    type="button"
                    className={`compare-cal-toggle${calOpen ? " is-open" : ""}`}
                    onClick={() => setCalOpen((v) => !v)}
                  >
                    {periodLabel}
                  </button>
                  {(from || to) && (
                    <button
                      type="button"
                      className="compare-cal-clear"
                      onClick={() => {
                        setFrom(null);
                        setTo(null);
                        setPick("from");
                      }}
                    >
                      Сбросить даты
                    </button>
                  )}
                  {calOpen ? (
                    <div className="compare-cal">
                      <div className="compare-cal-nav">
                        <button
                          type="button"
                          onClick={() => {
                            if (viewM === 1) {
                              setViewY((y) => y - 1);
                              setViewM(12);
                            } else setViewM((m) => m - 1);
                          }}
                        >
                          ‹
                        </button>
                        <strong>{monthLabel}</strong>
                        <button
                          type="button"
                          onClick={() => {
                            if (viewM === 12) {
                              setViewY((y) => y + 1);
                              setViewM(1);
                            } else setViewM((m) => m + 1);
                          }}
                        >
                          ›
                        </button>
                      </div>
                      <div className="compare-cal-pick">
                        <button
                          type="button"
                          className={pick === "from" ? "is-active" : ""}
                          onClick={() => setPick("from")}
                        >
                          С {from ? formatRuDay(from) : "…"}
                        </button>
                        <button
                          type="button"
                          className={pick === "to" ? "is-active" : ""}
                          onClick={() => setPick("to")}
                        >
                          По {to ? formatRuDay(to) : "…"}
                        </button>
                      </div>
                      <div className="compare-cal-grid">
                        {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d) => (
                          <span key={d} className="muted">
                            {d}
                          </span>
                        ))}
                        {daysInMonth.map((d, i) => {
                          if (d == null) return <span key={`e-${i}`} />;
                          const day = ymd(viewY, viewM, d);
                          const selected =
                            day === from ||
                            day === to ||
                            (from && to && day >= from && day <= to);
                          return (
                            <button
                              key={day}
                              type="button"
                              className={selected ? "is-selected" : ""}
                              onClick={() => {
                                if (pick === "from") {
                                  setFrom(day);
                                  if (to && day > to) setTo(null);
                                  setPick("to");
                                } else {
                                  if (from && day < from) {
                                    setFrom(day);
                                    setTo(from);
                                  } else setTo(day);
                                  setPick("from");
                                }
                              }}
                            >
                              {d}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <NickPicker
                  label="Игрок B"
                  value={right}
                  draft={rightDraft}
                  onDraft={(v) => {
                    setRightDraft(v);
                    setRight("");
                    setData(null);
                  }}
                  onPick={(n) => setRight(n)}
                  suggestions={rightSuggestions}
                />
              </div>

              <label className="compare-match-pick">
                <span className="muted">Тренировочная катка</span>
                <select
                  value={matchId}
                  onChange={(e) => setMatchId(e.target.value)}
                >
                  <option value="">Все время · общий разбор</option>
                  {trainMatches.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="compare-confirm-row">
                <button
                  type="button"
                  className="compare-confirm-btn"
                  disabled={loading}
                  onClick={confirmCompare}
                >
                  {loading ? "Считаем…" : "Сравнить"}
                </button>
                <p className="muted compare-hint">
                  Выбери ники слева и справа, затем нажми «Сравнить».
                </p>
              </div>

              {error ? <p className="error">{error}</p> : null}

              {data ? (
                <>
                  {data.match ? (
                    <MatchCompareBlock
                      match={data.match}
                      leftNick={data.me.nick}
                      rightNick={data.other.nick}
                    />
                  ) : (
                    <>
                      <div className="compare-vs">
                        <SideBlock side={data.me} other={data.other} />
                        <div className="compare-vs-mid">
                          <span>VS</span>
                          <div className="compare-diff">
                            <div className={deltaCls(data.me.rp, data.other.rp)}>
                              RP{" "}
                              {data.me.rp != null && data.other.rp != null
                                ? Math.round(data.me.rp - data.other.rp) > 0
                                  ? `+${Math.round(data.me.rp - data.other.rp)}`
                                  : String(
                                      Math.round(data.me.rp - data.other.rp)
                                    )
                                : "—"}
                            </div>
                            <div
                              className={deltaCls(
                                data.me.train?.kd ?? null,
                                data.other.train?.kd ?? null
                              )}
                            >
                              ТМ KD
                            </div>
                            <div
                              className={deltaCls(
                                data.me.cw?.kd ?? null,
                                data.other.cw?.kd ?? null
                              )}
                            >
                              КВ KD
                            </div>
                          </div>
                        </div>
                        <SideBlock side={data.other} other={data.me} />
                      </div>

                      <div className="compare-hist-pair compare-hitmap-pair">
                        <HitmapSide side={data.me} other={data.other} />
                        <div className="compare-hist-gutter compare-hitmap-mid">
                          <span className="muted">куда бьют</span>
                          <div className="compare-diff">
                            <div
                              className={deltaCls(
                                data.me.hitmap?.zones.head ?? null,
                                data.other.hitmap?.zones.head ?? null
                              )}
                            >
                              Голова
                              {data.me.hitmap && data.other.hitmap
                                ? (() => {
                                    const d =
                                      Math.round(
                                        (data.me.hitmap.zones.head -
                                          data.other.hitmap.zones.head) *
                                          10
                                      ) / 10;
                                    return ` ${d > 0 ? `+${d}` : String(d)}`;
                                  })()
                                : ""}
                            </div>
                            <div
                              className={deltaCls(
                                data.me.hitmap?.zones.torso ?? null,
                                data.other.hitmap?.zones.torso ?? null
                              )}
                            >
                              Торс
                            </div>
                            <div
                              className={deltaCls(
                                data.me.hitmap?.zones.limb ?? null,
                                data.other.hitmap?.zones.limb ?? null,
                                false
                              )}
                              title="Меньше конечностей обычно лучше"
                            >
                              Конечн.
                            </div>
                          </div>
                        </div>
                        <HitmapSide side={data.other} other={data.me} />
                      </div>
                    </>
                  )}
                </>
              ) : (
                !loading &&
                !error && (
                  <p className="muted compare-hint">
                    После выбора ников нажми «Сравнить».
                  </p>
                )
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
