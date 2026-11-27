"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BdAmount } from "@/components/BdMark";
import { DraggableModal } from "@/components/DraggableModal";

type FactionRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  color: string;
  balance: number;
  members: number;
};

type PlayerRow = {
  userId: string;
  nick: string;
  balance: number;
  seat: string;
  factionId: string;
  factionName: string;
  factionSlug: string;
  factionLogoUrl: string | null;
  factionColor: string;
};

type DayItem = {
  kind: string;
  kindLabel: string;
  note: string | null;
  amount: number;
  playerNick?: string | null;
};

type FactionDay = {
  ymd: string;
  dateLabel: string;
  total: number;
  fromPlayers: number;
  fromBets: number;
  otherPlus: number;
  plusItems?: DayItem[];
  minusTotal: number;
  minusItems: DayItem[];
};

type PersonalDay = {
  ymd: string;
  dateLabel: string;
  total: number;
  items: DayItem[];
};

type Tab = "factions" | "players";

function seatRu(seat: string): string {
  if (seat === "LEADER") return "глава";
  if (seat === "DEPUTY") return "зам";
  return "боец";
}

function FactionLogo({
  url,
  name,
  color,
  size = 40,
}: {
  url: string | null;
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      className="faction-balances-logo"
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 0 2px ${color}55`,
      }}
      title={name}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={size} height={size} />
      ) : (
        <span style={{ color }}>{name.slice(0, 1)}</span>
      )}
    </span>
  );
}

export function FactionBalancesPanel({ slug }: { slug: string }) {
  const [tab, setTab] = useState<Tab>("factions");
  const [factions, setFactions] = useState<FactionRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [totals, setTotals] = useState({ factionTreasury: 0, playerPersonal: 0 });
  const [minYmd, setMinYmd] = useState("2026-11-24");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [nickFilter, setNickFilter] = useState("");
  const [factionFilter, setFactionFilter] = useState<string>("all");

  const [factionOpen, setFactionOpen] = useState<FactionRow | null>(null);
  const [factionDays, setFactionDays] = useState<FactionDay[]>([]);
  const [factionDayLoading, setFactionDayLoading] = useState(false);
  const [factionDayOpen, setFactionDayOpen] = useState<FactionDay | null>(null);

  const [playerOpen, setPlayerOpen] = useState<PlayerRow | null>(null);
  const [playerDays, setPlayerDays] = useState<PersonalDay[]>([]);
  const [playerDayLoading, setPlayerDayLoading] = useState(false);
  const [playerDayOpen, setPlayerDayOpen] = useState<PersonalDay | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/balances`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        error?: string;
        factions?: FactionRow[];
        players?: PlayerRow[];
        totals?: { factionTreasury: number; playerPersonal: number };
        minYmd?: string;
      };
      if (!res.ok) {
        setErr(json.error || "Не удалось загрузить балансы");
        setFactions([]);
        setPlayers([]);
        return;
      }
      setFactions(json.factions || []);
      setPlayers(json.players || []);
      setTotals(
        json.totals || { factionTreasury: 0, playerPersonal: 0 },
      );
      if (json.minYmd) setMinYmd(json.minYmd);
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredPlayers = useMemo(() => {
    const q = nickFilter.trim().toLowerCase();
    return players.filter((p) => {
      if (factionFilter !== "all" && p.factionId !== factionFilter) return false;
      if (!q) return true;
      return (
        p.nick.toLowerCase().includes(q) ||
        p.factionName.toLowerCase().includes(q)
      );
    });
  }, [players, nickFilter, factionFilter]);

  async function openFaction(f: FactionRow) {
    setFactionOpen(f);
    setFactionDayOpen(null);
    setFactionDays([]);
    setFactionDayLoading(true);
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/balances?factionId=${encodeURIComponent(f.id)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as { days?: FactionDay[]; error?: string };
      if (!res.ok) {
        setErr(json.error || "Не удалось загрузить дни казны");
        return;
      }
      setFactionDays(json.days || []);
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setFactionDayLoading(false);
    }
  }

  async function openPlayer(p: PlayerRow) {
    setPlayerOpen(p);
    setPlayerDayOpen(null);
    setPlayerDays([]);
    setPlayerDayLoading(true);
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/balances?userId=${encodeURIComponent(p.userId)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        days?: PersonalDay[];
        error?: string;
      };
      if (!res.ok) {
        setErr(json.error || "Не удалось загрузить дни игрока");
        return;
      }
      setPlayerDays(json.days || []);
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setPlayerDayLoading(false);
    }
  }

  const minLabel = (() => {
    const [y, m, d] = minYmd.split("-");
    return y && m && d ? `${d}.${m}.${y}` : minYmd;
  })();

  return (
    <div className="faction-balances">
      <div className="faction-balances-head">
        <h3 className="xfer-title">✦ Балансы</h3>
        <p className="muted xfer-sub">
          Казны фракций и личные B$ игроков. Кликни карточку или строку — доход
          по дням с {minLabel}, затем день — за что пришло и ушло.
        </p>
      </div>

      <div className="faction-balances-summary">
        <div className="faction-balances-summary-card">
          <span className="muted">Все казны</span>
          <strong>
            <BdAmount n={totals.factionTreasury} />
          </strong>
        </div>
        <div className="faction-balances-summary-sep" aria-hidden />
        <div className="faction-balances-summary-card">
          <span className="muted">Все личные B$</span>
          <strong>
            <BdAmount n={totals.playerPersonal} />
          </strong>
        </div>
      </div>

      <div className="faction-balances-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "factions"}
          className={`admin-tab${tab === "factions" ? " active" : ""}`}
          onClick={() => setTab("factions")}
        >
          Фракции ({factions.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "players"}
          className={`admin-tab${tab === "players" ? " active" : ""}`}
          onClick={() => setTab("players")}
        >
          Игроки ({players.length})
        </button>
      </div>

      {err ? <p className="xfer-err">{err}</p> : null}
      {loading ? <p className="muted">Загрузка…</p> : null}

      {tab === "factions" && !loading ? (
        <div className="faction-balances-faction-grid">
          {factions.map((f) => (
            <button
              key={f.id}
              type="button"
              className="faction-balances-faction-card"
              style={{ ["--fb-accent" as string]: f.color }}
              onClick={() => void openFaction(f)}
            >
              <FactionLogo url={f.logoUrl} name={f.name} color={f.color} size={52} />
              <div className="faction-balances-faction-meta">
                <strong style={{ color: f.color }}>{f.name}</strong>
                <span className="muted">{f.members} в составе</span>
              </div>
              <div className="faction-balances-faction-bal">
                <span className="muted">Казна</span>
                <strong>
                  <BdAmount n={f.balance} />
                </strong>
              </div>
            </button>
          ))}
          {!factions.length ? (
            <p className="muted">Фракции не найдены.</p>
          ) : null}
        </div>
      ) : null}

      {tab === "players" && !loading ? (
        <div className="faction-balances-players">
          <div className="faction-balances-filters">
            <div className="xfer-nick-filter">
              <label className="xfer-nick-filter-label" htmlFor="bal-nick">
                Поиск
              </label>
              <input
                id="bal-nick"
                className="xfer-nick-filter-input"
                type="search"
                value={nickFilter}
                onChange={(e) => setNickFilter(e.target.value)}
                placeholder="Ник…"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="xfer-nick-filter">
              <label className="xfer-nick-filter-label" htmlFor="bal-faction">
                Фракция
              </label>
              <select
                id="bal-faction"
                className="xfer-nick-filter-input faction-balances-faction-select"
                value={factionFilter}
                onChange={(e) => setFactionFilter(e.target.value)}
              >
                <option value="all">Все фракции</option>
                {factions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div
            className="faction-balances-faction-chips"
            role="group"
            aria-label="Быстрый фильтр фракции"
          >
            <button
              type="button"
              className={`faction-balances-chip${
                factionFilter === "all" ? " is-on" : ""
              }`}
              onClick={() => setFactionFilter("all")}
            >
              Все
            </button>
            {factions.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`faction-balances-chip${
                  factionFilter === f.id ? " is-on" : ""
                }`}
                style={{ ["--fb-accent" as string]: f.color }}
                onClick={() => setFactionFilter(f.id)}
              >
                <FactionLogo
                  url={f.logoUrl}
                  name={f.name}
                  color={f.color}
                  size={18}
                />
                {f.name}
              </button>
            ))}
          </div>
          <div className="xfer-table-wrap">
            <table className="xfer-table faction-balances-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Фракция</th>
                  <th>Роль</th>
                  <th>Личный B$</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map((p) => (
                  <tr
                    key={p.userId}
                    className="faction-balances-player-row"
                    onClick={() => void openPlayer(p)}
                  >
                    <td>
                      <strong className="xfer-nick">{p.nick}</strong>
                    </td>
                    <td>
                      <span className="faction-balances-player-fac">
                        <FactionLogo
                          url={p.factionLogoUrl}
                          name={p.factionName}
                          color={p.factionColor}
                          size={28}
                        />
                        <span style={{ color: p.factionColor }}>
                          {p.factionName}
                        </span>
                      </span>
                    </td>
                    <td className="muted">{seatRu(p.seat)}</td>
                    <td>
                      <BdAmount n={p.balance} />
                    </td>
                  </tr>
                ))}
                {!filteredPlayers.length ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      Никого не найдено.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {factionOpen ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => {
            setFactionOpen(null);
            setFactionDayOpen(null);
          }}
        >
          <header
            className="profile-match-modal-head"
            data-drag-handle
            title="Перетащить окно"
          >
            <div className="faction-balances-modal-title">
              <FactionLogo
                url={factionOpen.logoUrl}
                name={factionOpen.name}
                color={factionOpen.color}
                size={44}
              />
              <div>
                <p className="muted">Казна · доход по дням</p>
                <h2 className="profile-mail-modal-title">{factionOpen.name}</h2>
              </div>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => {
                setFactionOpen(null);
                setFactionDayOpen(null);
              }}
            >
              ×
            </button>
          </header>
          <div className="profile-match-modal-body faction-balances-modal-body">
            <div className="faction-balances-modal-bal">
              Сейчас: <BdAmount n={factionOpen.balance} />
            </div>
            <div className="faction-balances-sep" />
            {factionDayLoading ? (
              <p className="muted">Загрузка дней…</p>
            ) : factionDays.length ? (
              <ul className="faction-balances-days">
                {factionDays.map((d) => (
                  <li key={d.ymd}>
                    <button
                      type="button"
                      className="faction-balances-day-btn"
                      onClick={() => setFactionDayOpen(d)}
                    >
                      <span>
                        <strong>{d.dateLabel}</strong>
                        <span className="muted">
                          {" "}
                          · гринд {d.fromPlayers.toLocaleString("ru-RU")} · ставки{" "}
                          {d.fromBets.toLocaleString("ru-RU")}
                        </span>
                      </span>
                      <span
                        className={
                          d.total >= 0 ? "is-plus" : "is-minus"
                        }
                      >
                        <BdAmount n={d.total} signed />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Нет движений с {minLabel}.
              </p>
            )}
          </div>
        </DraggableModal>
      ) : null}

      {factionDayOpen && factionOpen ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => setFactionDayOpen(null)}
        >
          <header
            className="profile-match-modal-head"
            data-drag-handle
            title="Перетащить окно"
          >
            <div>
              <p className="muted">
                {factionOpen.name} · календарный день · МСК
              </p>
              <h2 className="profile-mail-modal-title">
                {factionDayOpen.dateLabel}
              </h2>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => setFactionDayOpen(null)}
            >
              ×
            </button>
          </header>
          <div className="profile-match-modal-body faction-balances-modal-body">
            <ul className="faction-balances-day-sum">
              <li>
                <span>Итого</span>
                <strong
                  className={
                    factionDayOpen.total >= 0 ? "is-plus" : "is-minus"
                  }
                >
                  <BdAmount n={factionDayOpen.total} signed />
                </strong>
              </li>
              <li>
                <span>От игроков (гринд)</span>
                <span className="is-plus">
                  <BdAmount n={factionDayOpen.fromPlayers} signed />
                </span>
              </li>
              <li>
                <span>От ставок</span>
                <span className="is-plus">
                  <BdAmount n={factionDayOpen.fromBets} signed />
                </span>
              </li>
              {factionDayOpen.otherPlus > 0 ? (
                <li>
                  <span>Другие поступления</span>
                  <span className="is-plus">
                    <BdAmount n={factionDayOpen.otherPlus} signed />
                  </span>
                </li>
              ) : null}
              <li>
                <span>Минусы</span>
                <span className="is-minus">
                  <BdAmount n={factionDayOpen.minusTotal} signed />
                </span>
              </li>
            </ul>

            <div className="faction-balances-sep" />
            <h4 className="faction-hr-sub">Поступления · за что</h4>
            {(factionDayOpen.plusItems?.length || 0) > 0 ? (
              <ul className="xfer-day-minus xfer-day-plus">
                {(factionDayOpen.plusItems || []).map((item, i) => (
                  <li key={`fp-${item.kind}-${i}`}>
                    <div>
                      <strong>
                        {item.kindLabel}
                        {item.playerNick ? (
                          <>
                            {" · "}
                            <span className="xfer-nick">{item.playerNick}</span>
                          </>
                        ) : null}
                      </strong>
                      {item.note ? (
                        <p className="muted xfer-day-minus-note">{item.note}</p>
                      ) : null}
                    </div>
                    <span className="is-plus">
                      <BdAmount n={item.amount} signed />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Кроме гринда и ставок других поступлений не было.
              </p>
            )}

            <div className="faction-balances-sep" />
            <h4 className="faction-hr-sub">Минусы · за что</h4>
            {factionDayOpen.minusItems.length ? (
              <ul className="xfer-day-minus">
                {factionDayOpen.minusItems.map((item, i) => (
                  <li key={`fm-${item.kind}-${i}`}>
                    <div>
                      <strong>
                        {item.kindLabel}
                        {item.playerNick ? (
                          <>
                            {" · "}
                            <span className="xfer-nick">{item.playerNick}</span>
                          </>
                        ) : null}
                      </strong>
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

      {playerOpen ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => {
            setPlayerOpen(null);
            setPlayerDayOpen(null);
          }}
        >
          <header
            className="profile-match-modal-head"
            data-drag-handle
            title="Перетащить окно"
          >
            <div className="faction-balances-modal-title">
              <FactionLogo
                url={playerOpen.factionLogoUrl}
                name={playerOpen.factionName}
                color={playerOpen.factionColor}
                size={44}
              />
              <div>
                <p className="muted">
                  Личный B$ · {playerOpen.factionName} · {seatRu(playerOpen.seat)}
                </p>
                <h2 className="profile-mail-modal-title">{playerOpen.nick}</h2>
              </div>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => {
                setPlayerOpen(null);
                setPlayerDayOpen(null);
              }}
            >
              ×
            </button>
          </header>
          <div className="profile-match-modal-body faction-balances-modal-body">
            <div className="faction-balances-modal-bal">
              Сейчас: <BdAmount n={playerOpen.balance} />
            </div>
            <div className="faction-balances-sep" />
            {playerDayLoading ? (
              <p className="muted">Загрузка дней…</p>
            ) : playerDays.length ? (
              <ul className="faction-balances-days">
                {playerDays.map((d) => (
                  <li key={d.ymd}>
                    <button
                      type="button"
                      className="faction-balances-day-btn"
                      onClick={() => setPlayerDayOpen(d)}
                    >
                      <span>
                        <strong>{d.dateLabel}</strong>
                        <span className="muted">
                          {" "}
                          · {d.items.length} провод.
                        </span>
                      </span>
                      <span className={d.total >= 0 ? "is-plus" : "is-minus"}>
                        <BdAmount n={d.total} signed />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Нет личных движений с {minLabel} (ЗП, контракт, аукцион, взнос).
              </p>
            )}
          </div>
        </DraggableModal>
      ) : null}

      {playerDayOpen && playerOpen ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => setPlayerDayOpen(null)}
        >
          <header
            className="profile-match-modal-head"
            data-drag-handle
            title="Перетащить окно"
          >
            <div>
              <p className="muted">
                {playerOpen.nick} · личный день · МСК
              </p>
              <h2 className="profile-mail-modal-title">
                {playerDayOpen.dateLabel}
              </h2>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => setPlayerDayOpen(null)}
            >
              ×
            </button>
          </header>
          <div className="profile-match-modal-body faction-balances-modal-body">
            <div className="faction-balances-modal-bal">
              Итого за день:{" "}
              <span
                className={
                  playerDayOpen.total >= 0 ? "is-plus" : "is-minus"
                }
              >
                <BdAmount n={playerDayOpen.total} signed />
              </span>
            </div>
            <div className="faction-balances-sep" />
            <h4 className="faction-hr-sub">За что</h4>
            <ul className="xfer-day-minus">
              {playerDayOpen.items.map((item, i) => (
                <li key={`pi-${item.kind}-${i}`}>
                  <div>
                    <strong>{item.kindLabel}</strong>
                    {item.note ? (
                      <p className="muted xfer-day-minus-note">{item.note}</p>
                    ) : null}
                  </div>
                  <span
                    className={item.amount >= 0 ? "is-plus" : "is-minus"}
                  >
                    <BdAmount n={item.amount} signed />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </DraggableModal>
      ) : null}
    </div>
  );
}
