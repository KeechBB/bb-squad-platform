"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { signIn } from "next-auth/react";
import { TournamentHubFrame } from "@/components/TournamentHubFrame";
import {
  BET_QUESTIONS,
  EMPTY_BET_SLIP,
  betAnswer,
  betFilledCount,
  betPlacesClash,
  blowoutKey,
  type BetField,
  type BetKind,
  type BetPlayer,
  type BetReveal,
  type BetSlip,
  type BetTeam,
  type BetsPayload,
} from "@/lib/tournamentBetSlip";

const SLOT_LABEL: Record<BetPlayer["slot"], string> = {
  STARTER: "основной",
  SUB: "замена",
};

function TruthMark({
  field,
  kind,
  reveal,
  mine,
  teams,
}: {
  field: BetField;
  kind: BetKind;
  reveal: BetReveal | undefined;
  mine: BetSlip | null;
  teams: BetTeam[];
}) {
  if (!reveal?.open) return null;
  const text = reveal.lines[field];
  if (!text) {
    return (
      <p className="tn-bet-truth is-open">
        <span>Итог появится со статистикой турнира</span>
      </p>
    );
  }
  const official = reveal.answers[field];
  const mineAns = mine ? betAnswer(mine, field) : null;
  let tone: "hit" | "miss" | "open" = "open";
  if (mineAns !== null && official !== undefined && official !== null && official !== "") {
    if (kind === "score") {
      const a = blowoutKey(String(mineAns));
      const b = blowoutKey(String(official));
      tone = a && b && a === b ? "hit" : "miss";
    } else {
      tone = mineAns === official ? "hit" : "miss";
    }
  }
  const team =
    kind === "team" && typeof official === "string"
      ? teams.find((t) => t.id === official)
      : null;
  return (
    <p className={`tn-bet-truth is-${tone}`}>
      {team?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logoUrl} alt="" width={22} height={22} />
      ) : null}
      <span>
        {tone === "hit" ? "Верно" : "Итог"}: {text}
      </span>
    </p>
  );
}

function FruitMark({
  kind,
}: {
  kind: "berry" | "lemon" | "grape" | "orange" | "cherry";
}) {
  if (kind === "berry") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 12c2 7 8 10 16 10-6 2-10 6-12 12 2-1 4-1 6 0-4 8-8 16-10 24-2-8-6-16-10-24 2 1 4 1 6 0-2-6-6-10-12-12 8 0 14-3 16-10z" fill="#3f8f4a" />
        <path d="M32 22c8 6 16 10 16 22 0 10-7 16-16 16s-16-6-16-16c0-12 8-16 16-22z" fill="#e23b4a" />
        <circle cx="26" cy="36" r="1.3" fill="#f8e1b0" />
        <circle cx="34" cy="40" r="1.3" fill="#f8e1b0" />
        <circle cx="28" cy="46" r="1.2" fill="#f8e1b0" />
        <circle cx="38" cy="48" r="1.2" fill="#f8e1b0" />
      </svg>
    );
  }
  if (kind === "lemon") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <ellipse cx="32" cy="34" rx="18" ry="16" fill="#f0c84a" />
        <ellipse cx="32" cy="34" rx="12" ry="10" fill="#fff4c2" />
        <path d="M32 24v20M22 34h20M25 28l14 12M39 28L25 40" stroke="#e2b12a" strokeWidth="1.2" />
      </svg>
    );
  }
  if (kind === "grape") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 10c6 4 8 8 8 8" stroke="#6aaa4a" strokeWidth="2" fill="none" />
        <circle cx="32" cy="28" r="6" fill="#7a4ea3" />
        <circle cx="24" cy="34" r="6" fill="#8d5cb8" />
        <circle cx="40" cy="34" r="6" fill="#8d5cb8" />
        <circle cx="28" cy="42" r="6" fill="#6d3f96" />
        <circle cx="36" cy="42" r="6" fill="#6d3f96" />
        <circle cx="32" cy="50" r="6" fill="#5c3484" />
      </svg>
    );
  }
  if (kind === "orange") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="34" r="16" fill="#f08a2a" />
        <circle cx="32" cy="34" r="10" fill="#ffd19a" />
        <path d="M32 24v20M22 34h20" stroke="#ef8a22" strokeWidth="1.2" />
        <path d="M30 16c2 4 2 4 4 0" stroke="#3f8f4a" strokeWidth="2" fill="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M34 18c8-8 16-6 16-6s-2 10-8 14" stroke="#3f8f4a" strokeWidth="2" fill="none" />
      <circle cx="28" cy="36" r="10" fill="#c81e3a" />
      <circle cx="40" cy="40" r="9" fill="#e23b4a" />
    </svg>
  );
}

const FSSC_PREDICTIONS_PRIZE = {
  icon: "/awards/fssc-predictions-medal-v1.png",
  title: "Медаль «Прогноз»",
  tip: "За лучшие прогнозы турнира FSSC #1",
} as const;

function PredictionsPrizeMedal() {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  function showTip(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top });
  }

  return (
    <>
      <button
        type="button"
        className={`tn-bet-prize${tip ? " is-active" : ""}`}
        aria-label={FSSC_PREDICTIONS_PRIZE.tip}
        onMouseEnter={(e) => showTip(e.currentTarget)}
        onMouseLeave={() => setTip(null)}
        onFocus={(e) => showTip(e.currentTarget)}
        onBlur={() => setTip(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={FSSC_PREDICTIONS_PRIZE.icon}
          alt=""
          width={120}
          height={120}
        />
        <span className="tn-bet-prize-title">{FSSC_PREDICTIONS_PRIZE.title}</span>
        <span className="tn-bet-prize-sub">Награда лучшему прогнозёру</span>
      </button>
      {tip && typeof document !== "undefined"
        ? createPortal(
            <div
              className="profile-medal-tip"
              role="tooltip"
              style={{ left: tip.x, top: tip.y }}
            >
              {FSSC_PREDICTIONS_PRIZE.tip}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function ynValue(slip: BetSlip, field: "killsOver2000" | "cutsOver500") {
  return slip[field];
}

function betFieldReady(slip: BetSlip, field: BetField) {
  const value = slip[field];
  return value !== "" && value !== null;
}

export function TournamentBetsClient() {
  const [data, setData] = useState<BetsPayload | null>(null);
  const [slip, setSlip] = useState<BetSlip>(EMPTY_BET_SLIP);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await fetch("/api/tournaments/bets", { cache: "no-store" });
    if (!res.ok) {
      setErr("Не удалось открыть прогнозы");
      return;
    }
    const json = (await res.json()) as BetsPayload;
    setData(json);
    if (json.mine) setSlip(json.mine);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const teams = data?.teams ?? [];
  const closesAt = data?.closesAt ? Date.parse(data.closesAt) : Number.POSITIVE_INFINITY;
  const locked = Boolean(data?.locked) || now >= closesAt;
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const players = useMemo(() => teams.flatMap((t) => t.players.map((p) => ({ ...p, team: t.name }))), [teams]);
  const openTeam = openId ? teamById.get(openId) ?? null : null;
  const clash = betPlacesClash(slip);
  const filled = betFilledCount(slip);

  function answerLocked(field: BetField) {
    return Boolean(data?.mine && betAnswer(data.mine, field) !== null);
  }

  function setField<K extends BetField>(field: K, value: BetSlip[K]) {
    if (answerLocked(field)) return;
    setSlip((prev) => ({ ...prev, [field]: value }));
    setOk(null);
    setErr(null);
  }

  async function save() {
    if (!data?.authed || locked || clash) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/tournaments/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slip),
      });
      const json = (await res.json().catch(() => ({}))) as BetsPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "Не сохранилось");
      setData(json);
      if (json.mine) setSlip(json.mine);
      setOk("Прогноз сохранён");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setBusy(false);
    }
  }

  const mineRow = data?.board.find((row) => row.mine);

  return (
    <TournamentHubFrame active="bets">
      <form
        className="tn-bets"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <aside className="tn-bets-side">
          <section className="tn-panel tn-bet-points">
            <FruitMark kind="berry" />
            <h2 className="tn-panel-title">100 BB Points</h2>
            <p>
              Каждый верный прогноз даёт 100 BB Points. На данный момент их
              тратить некуда, в будущем будет торговая площадка, где можно будет
              взять скины, фон, шрифт и прочие приколы.
            </p>
            <p className="tn-bet-note">{data?.tournamentName || "Fruit Strike"}</p>
            <p className="tn-bet-note">
              {data?.reveal.open
                ? data.reveal.champion
                  ? `Чемпион: ${data.reveal.champion}. Сверь свой прогноз с итогом в карточках.`
                  : "Чемпион известен. Сверь свой прогноз с итогом в карточках."
                : locked
                  ? "Прогнозы закрыты. Срок был до 18:59 МСК."
                  : data?.lockNote || "Загружаю…"}
              {!locked && !data?.reveal.open ? " Сданный ответ уже не меняется." : ""}
            </p>
            {mineRow ? (
              <p className="tn-bet-mine">
                Твой прогноз: {mineRow.correct} верных · {mineRow.points} BB Points
              </p>
            ) : null}
            {data?.authed && !locked ? (
              <>
                <p className="tn-bet-note">Заполнено {filled} из {BET_QUESTIONS.length}</p>
                {clash ? (
                  <p className="tn-bet-err">На пьедестал нужны три разные команды.</p>
                ) : null}
                <button className="tn-bet-save" type="submit" disabled={busy || clash || filled === 0}>
                  {busy ? "Сохраняю…" : "Сохранить прогноз"}
                </button>
              </>
            ) : null}
            {data && !data.authed && !data.needsProfile ? (
              <button
                className="tn-bet-save"
                type="button"
                onClick={() => void signIn("steam", { callbackUrl: "/tournaments/bets" })}
              >
                Войти через Steam
              </button>
            ) : null}
            {data?.needsProfile ? (
              <Link className="tn-bet-save tn-bet-save-link" href="/register">
                Сначала заполни профиль
              </Link>
            ) : null}
            {err ? <p className="tn-bet-err">{err}</p> : null}
            {ok ? <p className="tn-bet-ok">{ok}</p> : null}
          </section>

          <section className="tn-panel tn-bet-top" aria-label="Топ прогнозов за турнир">
            <FruitMark kind="lemon" />
            <h2 className="tn-panel-title">Топ прогнозов за турнир</h2>
            <p className="tn-bet-note">
              {data?.reveal.open && data.graded > 0
                ? `Посчитано ${data.graded} из ${BET_QUESTIONS.length}`
                : data?.reveal.open
                  ? "Итог сетки есть. Цифры по киллам появятся, когда статистика турнира будет готова."
                  : "Верные посчитаются после итогов"}
            </p>
            <div className="tn-bet-top-scroll">
              {!data ? (
                <p className="tn-placeholder">Собираю таблицу…</p>
              ) : data.board.length === 0 ? (
                <p className="tn-placeholder">Пока никто не оставил прогноз.</p>
              ) : (
                <table className="tn-bet-board">
                  <thead>
                    <tr>
                      <th>Ник</th>
                      <th title="Сколько прогнозов сдано, максимум 11">Прогнозы</th>
                      <th title="Количество верных прогнозов">Верных</th>
                      <th title="Количество BB Points">BB Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.board.map((row, index) => (
                      <tr key={`${row.nick}-${index}`} className={row.mine ? "is-mine" : undefined}>
                        <td>
                          {row.href ? (
                            <Link href={row.href}>{row.nick}</Link>
                          ) : (
                            row.nick
                          )}
                        </td>
                        <td>
                          {row.filled}/{BET_QUESTIONS.length}
                        </td>
                        <td>{row.correct}</td>
                        <td>{row.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </aside>

        {BET_QUESTIONS.map((q) => (
          <section
            key={q.field}
            className="tn-panel tn-bet-q"
            data-col={q.col}
            data-row={q.row}
          >
            <h3>{q.title}</h3>
            {q.hint ? <p className="tn-bet-hint">{q.hint}</p> : null}
            <div className="tn-bet-fill">
              {q.kind === "team" ? (
                <TeamPick
                  field={q.field}
                  slip={slip}
                  teams={teams}
                  taken={
                    q.field === "place1TeamId" || q.field === "place2TeamId" || q.field === "place3TeamId"
                      ? [slip.place1TeamId, slip.place2TeamId, slip.place3TeamId].filter(
                          (id) => id && id !== slip[q.field]
                        )
                      : []
                  }
                  disabled={!data?.authed || locked || answerLocked(q.field)}
                  onChange={(id) => setField(q.field, id)}
                  onOpen={setOpenId}
                />
              ) : null}
              {q.kind === "player" ? (
                <PlayerPick
                  value={String(slip[q.field] || "")}
                  players={players}
                  disabled={!data?.authed || locked || answerLocked(q.field)}
                  onChange={(id) => setField(q.field, id)}
                />
              ) : null}
              {q.kind === "yn" ? (
                <div className="tn-bet-yn">
                  {[true, false].map((answer) => {
                    const field = q.field as "killsOver2000" | "cutsOver500";
                    const on = ynValue(slip, field) === answer;
                    return (
                      <button
                        key={String(answer)}
                        type="button"
                        className={on ? "is-on" : undefined}
                        disabled={!data?.authed || locked || answerLocked(q.field)}
                        onClick={() => setField(field, on ? null : answer)}
                      >
                        {answer ? "Да" : "Нет"}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {q.kind === "map" ? (
                <select
                  className="tn-bet-select"
                  value={slip.topKillsMap}
                  disabled={!data?.authed || locked || answerLocked(q.field)}
                  onChange={(e) => setField("topKillsMap", e.target.value)}
                >
                  <option value="">Выбери карту</option>
                  {(data?.maps || []).map((map) => (
                    <option key={map.id} value={map.id}>
                      {map.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {q.kind === "score" ? (
                <input
                  className="tn-bet-select"
                  value={slip.blowoutScore}
                  disabled={!data?.authed || locked || answerLocked(q.field)}
                  placeholder="100-0"
                  maxLength={7}
                  onChange={(e) => setField("blowoutScore", e.target.value)}
                />
              ) : null}
              {data?.authed && (!locked || answerLocked(q.field)) ? (
                <button
                  type="button"
                  className="tn-bet-make"
                  disabled={
                    busy ||
                    answerLocked(q.field) ||
                    !betFieldReady(slip, q.field) ||
                    (q.kind === "team" &&
                      (q.field === "place1TeamId" ||
                        q.field === "place2TeamId" ||
                        q.field === "place3TeamId") &&
                      clash)
                  }
                  onClick={() => void save()}
                >
                  {answerLocked(q.field) ? "Сдано" : busy ? "Сохраняю…" : "Сделать прогноз"}
                </button>
              ) : null}
              <TruthMark
                field={q.field}
                kind={q.kind}
                reveal={data?.reveal}
                mine={data?.mine ?? null}
                teams={teams}
              />
            </div>
          </section>
        ))}

        <section
          className="tn-panel tn-bet-bowl"
          data-col={5}
          data-row={3}
          aria-label="Награда за лучшие прогнозы"
        >
          <PredictionsPrizeMedal />
        </section>

        {teams.map((team, index) => (
          <button
            key={team.tag}
            type="button"
            className="tn-panel tn-bet-squad"
            data-col={2 + (index % 4)}
            data-row={4 + Math.floor(index / 4)}
            onClick={() => team.id && setOpenId(team.id)}
            disabled={!team.id}
          >
            <span className="tn-bet-seed">{team.seed}</span>
            {team.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logoUrl} alt="" width={64} height={64} />
            ) : (
              <FruitMark kind={index % 2 === 0 ? "berry" : "orange"} />
            )}
            <span className="tn-bet-squad-name">{team.name}</span>
            <span className="tn-bet-squad-tag">[{team.tag}]</span>
          </button>
        ))}
      </form>

      {openTeam && typeof document !== "undefined"
        ? createPortal(
            <div className="tn-modal-backdrop" onClick={() => setOpenId(null)} role="presentation">
              <div
                className="tn-modal tn-bet-modal"
                role="dialog"
                aria-modal="true"
                aria-label={openTeam.name}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="tn-bet-modal-head">
                  {openTeam.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={openTeam.logoUrl} alt="" width={56} height={56} />
                  ) : null}
                  <div>
                    <h2 className="tn-modal-title">{openTeam.name}</h2>
                    <p className="tn-bet-note">[{openTeam.tag}] · заявка на турнир</p>
                  </div>
                  <button type="button" className="tn-bet-close" onClick={() => setOpenId(null)}>
                    Закрыть
                  </button>
                </div>
                {openTeam.players.length === 0 ? (
                  <p className="tn-placeholder">В заявке пока никого нет.</p>
                ) : (
                  <ul className="tn-bet-roster">
                    {openTeam.players.map((p) => (
                      <li key={p.userId}>
                        {p.href ? (
                          <Link href={p.href}>{p.nick}</Link>
                        ) : (
                          <span>{p.nick}</span>
                        )}
                        <span>{SLOT_LABEL[p.slot]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </TournamentHubFrame>
  );
}

function TeamPick({
  field,
  slip,
  teams,
  taken,
  disabled,
  onChange,
  onOpen,
}: {
  field: BetField;
  slip: BetSlip;
  teams: BetTeam[];
  taken: string[];
  disabled: boolean;
  onChange: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const value = String(slip[field] || "");
  const chosen = teams.find((t) => t.id === value);
  return (
    <div className={`tn-bet-combo${menu ? " is-open" : ""}`}>
      <button
        type="button"
        className="tn-bet-select tn-bet-combo-btn"
        disabled={disabled}
        onClick={() => setMenu((open) => !open)}
      >
        {chosen?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={chosen.logoUrl} alt="" width={36} height={36} />
        ) : null}
        <span>{chosen ? chosen.name : "Выбери команду"}</span>
      </button>
      {menu && !disabled ? (
        <ul className="tn-bet-menu">
          {teams.map((team) => (
            <li key={team.id || team.tag}>
              <button
                type="button"
                className={team.id === value ? "is-on" : undefined}
                disabled={!team.id || taken.includes(team.id)}
                onClick={() => {
                  onChange(team.id);
                  setMenu(false);
                }}
              >
                {team.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={team.logoUrl} alt="" width={32} height={32} />
                ) : (
                  <span className="tn-bet-logo-slot" aria-hidden />
                )}
                <span>{team.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {chosen ? (
        <button type="button" className="tn-bet-open" onClick={() => onOpen(chosen.id)}>
          {chosen.name}
        </button>
      ) : null}
    </div>
  );
}

function PlayerPick({
  value,
  players,
  disabled,
  onChange,
}: {
  value: string;
  players: Array<BetPlayer & { team: string }>;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const chosen = players.find((p) => p.userId === value);
  return (
    <>
      <select
        className="tn-bet-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Выбери игрока</option>
        {players.map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.nick} · {p.team}
          </option>
        ))}
      </select>
      {chosen?.href ? (
        <Link className="tn-bet-open" href={chosen.href}>
          {chosen.nick}
        </Link>
      ) : null}
    </>
  );
}
