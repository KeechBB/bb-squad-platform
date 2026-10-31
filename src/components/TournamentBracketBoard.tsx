"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  BRACKET_BOX,
  BRACKET_SPLIT_Y,
  BRACKET_VIEW,
  FRUIT_STRIKE_PLAN,
  nextOnServer,
  type PlannedMatch,
} from "@/lib/fruitStrikeSchedule";
import { sideCardLabel, sideFullLabel, type FruitSideSlot } from "@/lib/fruitStrikeBracket";
import { mapDbTeamRole, TOURNAMENT_TEAM_ROLE_LABEL } from "@/lib/tournaments";
import {
  fruitMatchView,
  type FruitLiveState,
} from "@/lib/fruitStrikeLiveView";

const { w: MW, h: MH } = BRACKET_BOX;
const GOLD = "#e2c56a";
const RED = "#e56b84";
const MUTED = "rgba(180, 186, 198, 0.28)";

type RosterMember = {
  id: string;
  nick: string;
  role: string;
};

type RosterTeam = {
  id: string;
  name: string;
  tag: string;
  members: RosterMember[];
};

function normTag(value: string) {
  return value.trim().toLowerCase();
}

function findRosterTeam(teams: RosterTeam[], slot: FruitSideSlot): RosterTeam | null {
  if (slot.kind !== "team") return null;
  const tag = normTag(slot.team.tag);
  const name = normTag(slot.team.name);
  return (
    teams.find((team) => normTag(team.tag) === tag) ||
    teams.find((team) => normTag(team.name) === name) ||
    null
  );
}

type EdgeKind = "wire" | "advance" | "drop";

type Edge = {
  key: string;
  d: string;
  kind: EdgeKind;
  /** Матчи, при наведении на которые эта линия подсвечивается. */
  from: string[];
  /** Окошко, куда ведёт линия. */
  to: string;
};

function cy(y: number) {
  return y + MH / 2;
}

function right(x: number) {
  return x + MW;
}

function join(fromX: number, sourceYs: number[], toX: number, toY: number) {
  const m = (right(fromX) + toX) / 2;
  const tops = sourceYs.map(cy);
  const dest = cy(toY);
  const wires = tops.map((y) => `M ${right(fromX)} ${y} H ${m}`);
  wires.push(`M ${m} ${Math.min(...tops)} V ${Math.max(...tops)}`);
  return { wires, arrow: `M ${m} ${dest} H ${toX - 3}`, midX: m };
}

function straight(fromX: number, fromY: number, toX: number) {
  return `M ${right(fromX)} ${cy(fromY)} H ${toX - 3}`;
}

function dropSide(fromX: number, fromY: number, railX: number, toY: number) {
  return `M ${fromX} ${cy(fromY)} H ${railX} V ${toY} H ${fromX - 3}`;
}

function dropTop(fromX: number, fromY: number, railX: number, toX: number, toY: number) {
  const cx = toX + MW / 2;
  return `M ${right(fromX)} ${fromY + MH} H ${railX} V ${toY - 16} H ${cx} V ${toY - 3}`;
}

function strokeOf(lane: PlannedMatch["lane"]) {
  return lane === "lower" ? RED : GOLD;
}

function buildEdges(byId: Map<string, PlannedMatch>): Edge[] {
  const q1 = byId.get("q1")!;
  const q2 = byId.get("q2")!;
  const q3 = byId.get("q3")!;
  const q4 = byId.get("q4")!;
  const s1 = byId.get("s1")!;
  const s2 = byId.get("s2")!;
  const wf = byId.get("wf")!;
  const l1 = byId.get("l1")!;
  const l2 = byId.get("l2")!;
  const r1 = byId.get("r1")!;
  const r2 = byId.get("r2")!;
  const ls = byId.get("ls")!;
  const lf = byId.get("lf")!;
  const gf = byId.get("gf")!;

  const qfToSf = [
    join(q1.x, [q1.y, q2.y], s1.x, s1.y),
    join(q3.x, [q3.y, q4.y], s2.x, s2.y),
  ];
  const sfToWf = join(s1.x, [s1.y, s2.y], wf.x, wf.y);
  const lbToSemi = join(r1.x, [r1.y, r2.y], ls.x, ls.y);

  const edges: Edge[] = [];

  // QF → SF (shared bracket arms)
  qfToSf[0]!.wires.forEach((d, i) => {
    const from = i === 0 ? ["q1"] : i === 1 ? ["q2"] : ["q1", "q2"];
    edges.push({ key: `q12-w${i}`, d, kind: "wire", from, to: "s1" });
  });
  edges.push({
    key: "q12-a",
    d: qfToSf[0]!.arrow,
    kind: "advance",
    from: ["q1", "q2"],
    to: "s1",
  });
  qfToSf[1]!.wires.forEach((d, i) => {
    const from = i === 0 ? ["q3"] : i === 1 ? ["q4"] : ["q3", "q4"];
    edges.push({ key: `q34-w${i}`, d, kind: "wire", from, to: "s2" });
  });
  edges.push({
    key: "q34-a",
    d: qfToSf[1]!.arrow,
    kind: "advance",
    from: ["q3", "q4"],
    to: "s2",
  });

  // SF → WF
  sfToWf.wires.forEach((d, i) => {
    const from = i === 0 ? ["s1"] : i === 1 ? ["s2"] : ["s1", "s2"];
    edges.push({ key: `sf-w${i}`, d, kind: "wire", from, to: "wf" });
  });
  edges.push({
    key: "sf-a",
    d: sfToWf.arrow,
    kind: "advance",
    from: ["s1", "s2"],
    to: "wf",
  });

  // WF → GF (winner)
  edges.push({
    key: "wf-gf",
    d: `M ${right(wf.x)} ${cy(wf.y)} H 748 V ${gf.y + 16} H ${gf.x - 3}`,
    kind: "advance",
    from: ["wf"],
    to: "gf",
  });

  // LB R1 → R2
  edges.push({
    key: "l1-r1",
    d: straight(l1.x, l1.y, r1.x),
    kind: "advance",
    from: ["l1"],
    to: "r1",
  });
  edges.push({
    key: "l2-r2",
    d: straight(l2.x, l2.y, r2.x),
    kind: "advance",
    from: ["l2"],
    to: "r2",
  });

  // LB R2 → semi
  lbToSemi.wires.forEach((d, i) => {
    const from = i === 0 ? ["r1"] : i === 1 ? ["r2"] : ["r1", "r2"];
    edges.push({ key: `lb-w${i}`, d, kind: "wire", from, to: "ls" });
  });
  edges.push({
    key: "lb-a",
    d: lbToSemi.arrow,
    kind: "advance",
    from: ["r1", "r2"],
    to: "ls",
  });

  // LB semi → LB final
  edges.push({
    key: "ls-lf",
    d: straight(ls.x, ls.y, lf.x),
    kind: "advance",
    from: ["ls"],
    to: "lf",
  });

  // LB final → GF
  edges.push({
    key: "lf-gf",
    d: `M ${right(lf.x)} ${cy(lf.y)} H 776 V ${gf.y + 38} H ${gf.x - 3}`,
    kind: "advance",
    from: ["lf"],
    to: "gf",
  });

  // Drops (losers)
  edges.push({
    key: "drop-q1",
    d: dropSide(q1.x, q1.y, 10, l1.y + 16),
    kind: "drop",
    from: ["q1"],
    to: "l1",
  });
  edges.push({
    key: "drop-q2",
    d: dropSide(q2.x, q2.y, 18, l1.y + 38),
    kind: "drop",
    from: ["q2"],
    to: "l1",
  });
  edges.push({
    key: "drop-q3",
    d: dropSide(q3.x, q3.y, 26, l2.y + 16),
    kind: "drop",
    from: ["q3"],
    to: "l2",
  });
  edges.push({
    key: "drop-q4",
    d: dropSide(q4.x, q4.y, 34, l2.y + 38),
    kind: "drop",
    from: ["q4"],
    to: "l2",
  });
  edges.push({
    key: "drop-s1",
    d: dropTop(s1.x, s1.y, 360, r2.x, r2.y),
    kind: "drop",
    from: ["s1"],
    to: "r2",
  });
  edges.push({
    key: "drop-s2",
    d: dropTop(s2.x, s2.y, 376, r1.x, r1.y),
    kind: "drop",
    from: ["s2"],
    to: "r1",
  });
  edges.push({
    key: "drop-wf",
    d: `M ${right(wf.x)} ${wf.y + MH} H 548 V ${lf.y - 16} H ${lf.x + MW / 2} V ${lf.y - 3}`,
    kind: "drop",
    from: ["wf"],
    to: "lf",
  });

  return edges;
}

export function TournamentBracketBoard({
  initialLive = null,
}: {
  initialLive?: FruitLiveState | null;
}) {
  const matches = FRUIT_STRIKE_PLAN;
  const byId = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const edges = useMemo(() => buildEdges(byId), [byId]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [timeSlot, setTimeSlot] = useState<HTMLElement | null>(null);
  const [live, setLive] = useState<FruitLiveState | null>(initialLive);
  const [rosterTeams, setRosterTeams] = useState<RosterTeam[]>([]);
  const [rosterId, setRosterId] = useState<string | null>(null);
  const open = openId ? byId.get(openId) ?? null : null;
  const activeId = hoverId || openId;

  useEffect(() => {
    setTimeSlot(document.getElementById("tn-br-time-slot"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tournaments/teams", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { ok?: boolean; teams?: RosterTeam[] }) => {
        if (!cancelled && data.ok && data.teams) setRosterTeams(data.teams);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRosterId(null);
  }, [openId]);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch(`/api/tournaments/live?t=${Date.now()}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as FruitLiveState;
        if (!cancelled) setLive(data);
      } catch {
        /* ignore */
      }
    };
    void pull();
    const t = window.setInterval(() => void pull(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!hoverId) return;
    const row = document.querySelector(`[data-br-match="${hoverId}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [hoverId]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const waves = new Map<string, PlannedMatch[]>();
  for (const match of matches) {
    const list = waves.get(match.clock) ?? [];
    list.push(match);
    waves.set(match.clock, list);
  }

  const following = open ? nextOnServer(matches, open) : null;
  const lit = activeId
    ? new Set(edges.filter((e) => e.from.includes(activeId)).map((e) => e.key))
    : null;
  const litMatchIds = activeId ? new Set<string>([activeId]) : null;

  return (
    <>
      <div className="tn-br-legend" aria-hidden="true">
        <span className="is-gold">Верхняя сетка</span>
        <span className="is-red">Сетка лузеров</span>
      </div>
      <div
        className={`tn-br-scroll${activeId ? " is-pathing" : ""}`}
        onMouseLeave={() => setHoverId(null)}
      >
        <svg
          className="tn-br-svg"
          viewBox={`0 0 ${BRACKET_VIEW.w} ${BRACKET_VIEW.h}`}
          role="img"
        >
          <title>
            Сетка двойного выбывания. Наведи на матч — подсветятся стрелки дальше и в сетку лузеров.
          </title>
          <defs>
            <marker id="br-muted" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0 0 L7 3.5 L0 7 Z" fill={MUTED} />
            </marker>
            <marker id="br-gold" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0 L8 4 L0 8 Z" fill={GOLD} />
            </marker>
            <marker id="br-red" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0 L8 4 L0 8 Z" fill={RED} />
            </marker>
          </defs>

          {/* Разделитель верхней / нижней сетки */}
          <line
            x1={24}
            y1={BRACKET_SPLIT_Y}
            x2={BRACKET_VIEW.w - 24}
            y2={BRACKET_SPLIT_Y}
            className="tn-br-split-line"
          />
          <text x={48} y={BRACKET_SPLIT_Y - 10} className="tn-br-zone-label is-gold">
            Верхняя сетка
          </text>
          <text x={48} y={BRACKET_SPLIT_Y + 22} className="tn-br-zone-label is-red">
            Сетка лузеров
          </text>

          <text
            x={byId.get("gf")!.x + MW / 2}
            y={byId.get("gf")!.y - 12}
            textAnchor="middle"
            className="tn-br-svg-label is-gold"
          >
            Гранд-финал
          </text>

          {edges.map((edge) => {
            const on = lit?.has(edge.key) ?? false;
            const tone =
              edge.kind === "drop" ? "drop" : edge.kind === "advance" || edge.kind === "wire" ? "advance" : "advance";
            const cls = [
              "tn-br-edge",
              edge.kind === "wire" ? "is-wire" : "is-arrow",
              tone === "drop" ? "is-drop" : "is-advance",
              on ? "is-on" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return <path key={edge.key} d={edge.d} className={cls} />;
          })}

          {matches.map((match) => {
            const isActive = activeId === match.id;
            const isLit = litMatchIds?.has(match.id) ?? false;
            return (
              <g
                key={match.id}
                className={`tn-br-hit${isActive ? " is-active" : ""}${isLit ? " is-lit" : ""}`}
                role="button"
                tabIndex={0}
                onMouseEnter={() => setHoverId(match.id)}
                onFocus={() => setHoverId(match.id)}
                onBlur={() => setHoverId((cur) => (cur === match.id ? null : cur))}
                onClick={() => setOpenId(match.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOpenId(match.id);
                  }
                }}
              >
                <rect
                  x={match.x}
                  y={match.y}
                  width={MW}
                  height={MH}
                  rx={8}
                  fill="#14101a"
                  stroke={strokeOf(match.lane)}
                  strokeWidth={match.lane === "final" ? 1.8 : 1.2}
                />
                {isLit ? (
                  <rect
                    x={match.x}
                    y={match.y}
                    width={MW}
                    height={MH}
                    rx={8}
                    className="tn-br-card-wash"
                    pointerEvents="none"
                  />
                ) : null}
                <rect
                  x={match.x}
                  y={match.y + 6}
                  width={3}
                  height={MH - 12}
                  rx={1.5}
                  fill={strokeOf(match.lane)}
                />
                {(() => {
                  const view = fruitMatchView(match.id, live);
                  const left = sideCardLabel(view.brief.left);
                  const right = sideCardLabel(view.brief.right);
                  return (
                    <>
                      <text
                        x={match.x + MW / 2}
                        y={match.y + 18}
                        textAnchor="middle"
                        className={
                          match.lane === "lower"
                            ? "tn-br-card-round is-red"
                            : "tn-br-card-round is-gold"
                        }
                      >
                        {match.short} · {match.clock}
                        {view.scoreLabel ? ` · ${view.scoreLabel}` : ""}
                      </text>
                      <text
                        x={match.x + MW / 2}
                        y={match.y + 36}
                        textAnchor="middle"
                        className="tn-br-card-teams"
                      >
                        {left} · {right}
                      </text>
                      <text
                        x={match.x + MW / 2}
                        y={match.y + 52}
                        textAnchor="middle"
                        className="tn-br-card-map"
                      >
                        {view.brief.mapShort}
                      </text>
                    </>
                  );
                })()}
              </g>
            );
          })}
        </svg>
      </div>

      {timeSlot
        ? createPortal(
            <div className="tn-br-time">
              <h3>По времени</h3>
              {[...waves.entries()].map(([clock, row]) => (
                <div key={clock} className="tn-br-time-row">
                  <b>{clock}</b>
                  <ul>
                    {row.map((match) => {
                      const view = fruitMatchView(match.id, live);
                      return (
                        <li
                          key={match.id}
                          className={activeId === match.id ? "is-lit" : undefined}
                        >
                          <button
                            type="button"
                            data-br-match={match.id}
                            className={activeId === match.id ? "is-lit" : undefined}
                            onMouseEnter={() => setHoverId(match.id)}
                            onMouseLeave={() => setHoverId(null)}
                            onClick={() => setOpenId(match.id)}
                          >
                            <span>
                              {match.short} · {sideCardLabel(view.brief.left)}–
                              {sideCardLabel(view.brief.right)}
                              {view.scoreLabel ? ` ${view.scoreLabel}` : ""}
                            </span>
                            <span>{view.brief.mapShort}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>,
            timeSlot,
          )
        : null}

      {open ? (
        <div className="tn-modal-backdrop" onClick={() => setOpenId(null)} role="presentation">
          <div
            className="tn-modal tn-br-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tn-br-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="tn-br-modal-head">
              <h3 id="tn-br-dialog-title" className="tn-modal-title">
                {open.round}
              </h3>
              <button type="button" className="tn-br-modal-x" onClick={() => setOpenId(null)}>
                Закрыть
              </button>
            </div>
            {(() => {
              const view = fruitMatchView(open.id, live);
              const brief = view.brief;
              const lm = view.liveMatch;
              const r1 = lm?.r1;
              const r2 = lm?.r2;
              return (
                <>
                <div className="tn-br-split">
                  <section>
                    <h4>Инфо о матче</h4>
                    <div className="tn-br-versus" aria-label="Стороны">
                      <BracketSide
                        slot={brief.left}
                        faction={brief.factionLeft}
                        align="left"
                        teams={rosterTeams}
                        openId={rosterId}
                        onPick={setRosterId}
                      />
                      <span className="tn-br-vs">VS</span>
                      <BracketSide
                        slot={brief.right}
                        faction={brief.factionRight}
                        align="right"
                        teams={rosterTeams}
                        openId={rosterId}
                        onPick={setRosterId}
                      />
                    </div>
                    <dl>
                      <div>
                        <dt>Карта</dt>
                        <dd>
                          <code className="tn-br-layer">{brief.map}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Формат</dt>
                        <dd>{brief.formatNote}</dd>
                      </div>
                      <div>
                        <dt>Время</dt>
                        <dd>
                          {open.when} – {open.until.slice(-5)}
                        </dd>
                      </div>
                      <div>
                        <dt>Сервер</dt>
                        <dd>
                          {r1?.server || r2?.server || open.server}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <section>
                    <h4>Итог матча</h4>
                    <div className="tn-br-rounds" aria-label="Раунды">
                      <div className="tn-br-round-slot">
                        <span>R1</span>
                        <b>
                          {r1 && r1.ticketsA != null && r1.ticketsB != null
                            ? `${r1.ticketsA} : ${r1.ticketsB}`
                            : "— : —"}
                        </b>
                      </div>
                      <div className="tn-br-round-slot">
                        <span>R2</span>
                        <b>
                          {r2 && r2.ticketsA != null && r2.ticketsB != null
                            ? `${r2.ticketsA} : ${r2.ticketsB}`
                            : "— : —"}
                        </b>
                      </div>
                      <div className="tn-br-round-slot is-sum">
                        <span>Σ тикеты</span>
                        <b>
                          {view.scoreLabel ||
                            (lm?.sumA != null && lm?.sumB != null
                              ? `${lm.sumA} : ${lm.sumB}`
                              : "— : —")}
                        </b>
                      </div>
                    </div>
                    <p className="tn-br-sum-hint">
                      {lm?.status === "done" && lm.winner
                        ? `Победа: ${lm.winner.name} [${lm.winner.tag}] · только катки с естественным концом (без endmatch).`
                        : "Победа во встрече — у кого больше сумма тикетов за R1+R2. Учитываются только катки, закончившиеся сами (не endmatch)."}
                    </p>
                    <p>
                      {open.server} занят до {open.freeAt.slice(-5)}. Как только появится итог,
                      сервер освободится
                      {following
                        ? ` и встанет на «${following.round}» в ${following.clock}`
                        : ". Это последняя игра на этом сервере"}
                      .
                    </p>
                  </section>
                </div>
                <BracketRoster teams={rosterTeams} rosterId={rosterId} />
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </>
  );
}

function BracketSide({
  slot,
  faction,
  align,
  teams,
  openId,
  onPick,
}: {
  slot: FruitSideSlot;
  faction: string;
  align: "left" | "right";
  teams: RosterTeam[];
  openId: string | null;
  onPick: (id: string | null) => void;
}) {
  const team = findRosterTeam(teams, slot);
  const label = sideFullLabel(slot);
  return (
    <div className={`tn-br-side is-${align}`}>
      <span className="tn-br-faction">{faction}</span>
      {team ? (
        <button
          type="button"
          className={openId === team.id ? "tn-br-team-btn is-on" : "tn-br-team-btn"}
          onClick={() => onPick(openId === team.id ? null : team.id)}
        >
          {label}
        </button>
      ) : (
        <strong>{label}</strong>
      )}
    </div>
  );
}

function BracketRoster({ teams, rosterId }: { teams: RosterTeam[]; rosterId: string | null }) {
  const team = teams.find((item) => item.id === rosterId);
  if (!team) return null;
  const order = ["captain", "deputy", "starter", "sub", "reserve"];
  const members = [...team.members].sort(
    (a, b) => order.indexOf(mapDbTeamRole(a.role)) - order.indexOf(mapDbTeamRole(b.role))
  );
  return (
    <div className="tn-br-roster">
      <p>
        {team.name} [{team.tag}] · {members.length}
      </p>
      {members.length ? (
        <ul>
          {members.map((member) => (
            <li key={member.id}>
              <Link href={`/players/${encodeURIComponent(member.nick)}`}>{member.nick}</Link>
              <span>{TOURNAMENT_TEAM_ROLE_LABEL[mapDbTeamRole(member.role)]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>В команде пока никого нет.</p>
      )}
    </div>
  );
}
