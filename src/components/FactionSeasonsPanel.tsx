"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BdAmount } from "@/components/BdMark";
import { DraggableModal } from "@/components/DraggableModal";
import {
  FACTION_SEASONS,
  SEASON_AUCTION_HOURS,
  SEASON_AUCTION_TIERS,
  type SeasonTierDef,
  draftStorageKey,
  formatTierRangeRu,
  formatYmdRu,
  getCurrentSeason,
  getNextSeason,
  isSeasonTransferDay,
  mskTodayYmd,
  valueFitsTier,
} from "@/lib/factionSeasons";

type ValueRow = {
  userId: string;
  nick: string;
  playerValue: number;
  hasContract: boolean;
};

type DraftMap = Partial<Record<number, { userId: string; nick: string; playerValue: number }>>;

function Hi({ children }: { children: ReactNode }) {
  return <mark className="faction-guide-hi">{children}</mark>;
}

function readDraft(slug: string, seasonId: string): DraftMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(draftStorageKey(slug, seasonId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DraftMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDraft(slug: string, seasonId: string, draft: DraftMap) {
  try {
    window.localStorage.setItem(
      draftStorageKey(slug, seasonId),
      JSON.stringify(draft),
    );
  } catch {
    /* ignore */
  }
}

export function FactionSeasonsPanel({
  slug,
  canManage = false,
}: {
  slug: string;
  canManage?: boolean;
}) {
  const current = useMemo(() => getCurrentSeason(), []);
  const next = useMemo(() => getNextSeason(), []);
  const today = useMemo(() => mskTodayYmd(), []);
  const transferDay = isSeasonTransferDay(current);
  const draftSeasonId = current?.id || next?.id || "S1";

  const [rows, setRows] = useState<ValueRow[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [draft, setDraft] = useState<DraftMap>({});
  const [tierOpen, setTierOpen] = useState<SeasonTierDef | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [staffGateOpen, setStaffGateOpen] = useState(false);
  const [nickFilter, setNickFilter] = useState("");

  function requireStaff(): boolean {
    if (canManage) return true;
    setStaffGateOpen(true);
    return false;
  }

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const res = await fetch(
        `/api/factions/${encodeURIComponent(slug)}/player-values`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        error?: string;
        rows?: ValueRow[];
      };
      if (!res.ok) {
        setLoadErr(json.error || "Не удалось загрузить состав");
        setRows([]);
        return;
      }
      setRows(json.rows || []);
    } catch {
      setLoadErr("Сеть недоступна");
      setRows([]);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDraft(readDraft(slug, draftSeasonId));
  }, [slug, draftSeasonId]);

  /** Сбросить пресет, если игрок вырос из тира или подписал контракт. */
  useEffect(() => {
    if (!rows.length) return;
    setDraft((prev) => {
      let changed = false;
      const nextDraft: DraftMap = { ...prev };
      for (const t of SEASON_AUCTION_TIERS) {
        const pick = nextDraft[t.tier];
        if (!pick) continue;
        const live = rows.find((r) => r.userId === pick.userId);
        if (!live || live.hasContract || !valueFitsTier(live.playerValue, t)) {
          delete nextDraft[t.tier];
          changed = true;
        } else if (live.playerValue !== pick.playerValue || live.nick !== pick.nick) {
          nextDraft[t.tier] = {
            userId: live.userId,
            nick: live.nick,
            playerValue: live.playerValue,
          };
          changed = true;
        }
      }
      if (changed) writeDraft(slug, draftSeasonId, nextDraft);
      return changed ? nextDraft : prev;
    });
  }, [rows, slug, draftSeasonId]);

  const pickedIds = useMemo(
    () => new Set(Object.values(draft).map((p) => p?.userId).filter(Boolean) as string[]),
    [draft],
  );

  const filledCount = SEASON_AUCTION_TIERS.filter((t) => draft[t.tier]).length;
  const confirmEnabled =
    canManage &&
    transferDay &&
    Boolean(current?.endAuctionEnabled) &&
    filledCount === SEASON_AUCTION_TIERS.length;

  const tierPlayers = useMemo(() => {
    if (!tierOpen) return [];
    const q = nickFilter.trim().toLowerCase();
    return rows
      .filter((r) => valueFitsTier(r.playerValue, tierOpen))
      .filter((r) => !q || r.nick.toLowerCase().includes(q))
      .sort((a, b) => b.playerValue - a.playerValue || a.nick.localeCompare(b.nick, "ru"));
  }, [rows, tierOpen, nickFilter]);

  function selectPlayer(tier: SeasonTierDef, row: ValueRow) {
    if (!canManage) {
      setStaffGateOpen(true);
      return;
    }
    if (row.hasContract) return;
    setDraft((prev) => {
      const nextDraft: DraftMap = { ...prev };
      // один игрок — только в одном тире
      for (const t of SEASON_AUCTION_TIERS) {
        if (nextDraft[t.tier]?.userId === row.userId) delete nextDraft[t.tier];
      }
      nextDraft[tier.tier] = {
        userId: row.userId,
        nick: row.nick,
        playerValue: row.playerValue,
      };
      writeDraft(slug, draftSeasonId, nextDraft);
      return nextDraft;
    });
    setTierOpen(null);
    setNickFilter("");
  }

  function clearTier(tier: number) {
    if (!canManage) {
      setStaffGateOpen(true);
      return;
    }
    setDraft((prev) => {
      const nextDraft = { ...prev };
      delete nextDraft[tier];
      writeDraft(slug, draftSeasonId, nextDraft);
      return nextDraft;
    });
  }

  const confirmHint = !canManage
    ? "Выставлять игроков по тирам — только глава или зам фракции."
    : !current?.endAuctionEnabled
      ? "В этом сезоне межсезонный аукцион пропускаем — кнопка будет доступна с конца зимы."
      : !transferDay
        ? `Кнопка откроется только ${formatYmdRu(current.endsOn)} (последний день сезона, МСК).`
        : filledCount < SEASON_AUCTION_TIERS.length
          ? `Выбери игрока в каждый тир (${filledCount}/${SEASON_AUCTION_TIERS.length}).`
          : "Можно подтвердить выставление.";

  return (
    <div className="faction-seasons faction-guide">
      <div className="faction-seasons-head">
        <h3 className="xfer-title">✦ Сезоны фракций</h3>
        <p className="muted xfer-sub">
          Живая инструкция: что делать штабу, когда торги, кого можно выставить.
        </p>
      </div>

      <section className="faction-guide-block">
        <h4>① Где мы сейчас</h4>
        {current ? (
          <p>
            Идёт <Hi>{current.label}</Hi>
            {" · "}
            с {formatYmdRu(current.startsOn)} по {formatYmdRu(current.endsOn)}{" "}
            (календарь МСК).
            {!current.endAuctionEnabled ? (
              <>
                {" "}
                Межсезонный аукцион в этом сезоне — <Hi>пропуск</Hi>. Первый
                рабочий цикл будет в конце зимы 2026/27.
              </>
            ) : transferDay ? (
              <>
                {" "}
                Сегодня <Hi>день трансферов</Hi> — можно подтвердить пятёрку.
              </>
            ) : (
              <>
                {" "}
                День трансферов: <Hi>{formatYmdRu(current.endsOn)}</Hi>.
              </>
            )}
          </p>
        ) : (
          <p className="muted">Сейчас вне расписания сезонов.</p>
        )}
        {next ? (
          <p className="muted">
            Дальше пойдёт {next.label} с {formatYmdRu(next.startsOn)}
            {next.endAuctionEnabled
              ? ` · торги в последний день (${formatYmdRu(next.endsOn)})`
              : ""}
            .
          </p>
        ) : null}
        <p className="muted">Сегодня по МСК: {formatYmdRu(today)}.</p>
      </section>

      <section className="faction-guide-block">
        <h4>② Зачем сезоны</h4>
        <p>
          Сезон — это длинный отрезок жизни фракции (осень / зима / весна /
          лето). Внутри сезона вы гриндите казну, ставите, подписываете
          контракты, берёте рекрутов с обычного аукциона.
        </p>
        <p>
          В <Hi>последний день сезона</Hi> открывается особое окно: каждая
          фракция выставляет на торги <Hi>5 игроков разных ценовых тиров</Hi>.
          Это «перетряска» рынка — можно усилить состав или заработать B$ за
          своих.
        </p>
        <p>
          ★ Если штаб ничего не выставил к этому дню — <Hi>система выставит сама</Hi>{" "}
          по правилам тиров. Лучше выбрать заранее, кого вы готовы отпустить.
        </p>
      </section>

      <section className="faction-guide-block">
        <h4>③ Что вы можете делать уже сейчас</h4>
        <ul className="faction-guide-list">
          <li>
            ✔ <Hi>Глава или зам</Hi> жмёт тир ниже — видит{" "}
            <Hi>только игроков своей фракции</Hi>, чья стоимость в диапазоне.
            Обычный боец при нажатии получает заглушку: только для командира и зама.
          </li>
          <li>
            ✔ Штаб выбирает по одному человеку на тир — <Hi>черновик</Hi> на
            межсезон. Можно менять сколько угодно раз до дня трансферов.
          </li>
          <li>
            ⚠ Если игрок до конца сезона <Hi>дорожает и выходит из тира</Hi>,
            его нельзя оставить в этом слоте — пресет сбросится, нужно выбрать
            другого или другой тир.
          </li>
          <li>
            🔒 Кнопка <Hi>«Подтвердить выставление»</Hi> серая до дня
            трансферов. В день торгов она оживает; по нажатию — модалка по
            центру с проверкой пятёрки. Только штаб.
          </li>
        </ul>
      </section>

      <section className="faction-guide-block">
        <h4>④ Ценовые тиры — нажми, чтобы выбрать игрока</h4>
        <p className="muted">
          В списке только подходящие по стоимости на сейчас. Один игрок — только
          в одном тире. На контракте — защита от межсезона, выбрать нельзя.
          Кнопки тиров — только для главы и зама.
        </p>
        <div className="faction-seasons-tiers">
          {SEASON_AUCTION_TIERS.map((t) => {
            const pick = draft[t.tier];
            const eligible = rows.filter(
              (r) => !r.hasContract && valueFitsTier(r.playerValue, t),
            ).length;
            return (
              <button
                key={t.tier}
                type="button"
                className={`faction-seasons-tier is-click${
                  pick ? " has-pick" : ""
                }`}
                onClick={() => {
                  if (!requireStaff()) return;
                  setNickFilter("");
                  setTierOpen(t);
                }}
              >
                <strong>{t.label}</strong>
                <span className="faction-seasons-tier-range">
                  {formatTierRangeRu(t)}
                </span>
                <span className="faction-seasons-tier-pick">
                  {pick ? (
                    <>
                      <span className="xfer-nick">{pick.nick}</span>
                      <BdAmount n={pick.playerValue} />
                    </>
                  ) : (
                    <span className="muted">не выбран · {eligible} подходят</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="faction-seasons-confirm-row">
          <button
            type="button"
            className="btn primary"
            disabled={canManage ? !confirmEnabled : false}
            title={confirmHint}
            onClick={() => {
              if (!requireStaff()) return;
              if (!confirmEnabled) return;
              setConfirmOpen(true);
            }}
          >
            Подтвердить выставление
          </button>
          <p className="muted faction-seasons-confirm-hint">{confirmHint}</p>
        </div>
        {loadErr ? <p className="xfer-err">{loadErr}</p> : null}
      </section>

      <section className="faction-guide-block">
        <h4>⑤ Как проходят торги в день трансферов</h4>
        <ul className="faction-guide-list">
          <li>
            ⏱ Окно длится <Hi>{SEASON_AUCTION_HOURS} часа</Hi>. Побеждает
            фракция с наибольшей ставкой из казны.
          </li>
          <li>
            ① За день фракция может купить <Hi>не больше одного игрока каждого тира</Hi>
            — то есть до пяти покупок в сумме.
          </li>
          <li>
            ♻ Купить игрока <Hi>своей же фракции</Hi> тоже можно (если его
            выставили и ваша ставка победила).
          </li>
          <li>
            💰 Деньги списываются с казны покупателя по правилам аукциона
            (проигравшим — возврат).
          </li>
        </ul>
      </section>

      <section className="faction-guide-block">
        <h4>⑥ Календарь сезонов</h4>
        <div className="xfer-table-wrap">
          <table className="xfer-table">
            <thead>
              <tr>
                <th>Сезон</th>
                <th>Период</th>
                <th>Межсезон</th>
              </tr>
            </thead>
            <tbody>
              {FACTION_SEASONS.map((s) => {
                const isCur = current?.id === s.id;
                return (
                  <tr key={s.id} className={isCur ? "is-cur-season" : undefined}>
                    <td>
                      <strong>{s.label}</strong>
                      {isCur ? (
                        <span className="faction-guide-now-tag"> сейчас</span>
                      ) : null}
                    </td>
                    <td className="muted">
                      {formatYmdRu(s.startsOn)} — {formatYmdRu(s.endsOn)}
                    </td>
                    <td>
                      {s.endAuctionEnabled ? (
                        <span className="xfer-pill is-buy">торги</span>
                      ) : (
                        <span className="xfer-pill is-sell">пропуск</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="faction-guide-block">
        <h4>⑦ Частые вопросы</h4>
        <p>
          <Hi>Можно ли готовить список заранее?</Hi> Да, но только{" "}
          <Hi>глава или зам</Hi> — тиры кликабельны весь сезон. Подтверждение
          только в день трансферов. Обычный боец при клике видит заглушку.
        </p>
        <p>
          <Hi>Почему игрока пропало из тира?</Hi> Стоимость = 20 000 + весь
          гринд (вырос — сменил тир) или живой контракт (бронь от межсезона).
          Выбери снова.
        </p>
        <p>
          <Hi>Контракт и межсезон?</Hi> Пока контракт активен, игрока{" "}
          <Hi>нельзя выставить</Hi> на сезонное трансферное окно — ни вручную,
          ни автоподбором.
        </p>
        <p>
          <Hi>Где ещё почитать?</Hi> Кнопка <Hi>10 · FAQ</Hi> — квадратики тем
          справа, слева подробности по всем разделам менеджмента.
        </p>
      </section>

      {tierOpen ? (
        <div
          className="profile-match-modal"
          role="presentation"
          onClick={() => setTierOpen(null)}
        >
          <div className="profile-match-modal-backdrop" />
          <div
            className="profile-match-modal-panel faction-seasons-pick-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="profile-match-modal-head">
              <div>
                <h3>
                  {tierOpen.label} · кого выставить
                </h3>
                <p className="muted">
                  Подходят только {formatTierRangeRu(tierOpen)}. Контракт
                  блокирует межсезон. Если человек подорожает / подпишет контракт
                  — слот сбросится.
                </p>
              </div>
              <button
                type="button"
                className="profile-match-modal-close"
                onClick={() => setTierOpen(null)}
              >
                ×
              </button>
            </header>
            <div className="profile-match-modal-body">
              <div className="xfer-nick-filter">
                <label className="xfer-nick-filter-label" htmlFor="season-tier-nick">
                  Ник
                </label>
                <input
                  id="season-tier-nick"
                  className="xfer-nick-filter-input"
                  type="search"
                  value={nickFilter}
                  onChange={(e) => setNickFilter(e.target.value)}
                  placeholder="Поиск…"
                  autoComplete="off"
                  spellCheck={false}
                />
                {draft[tierOpen.tier] ? (
                  <button
                    type="button"
                    className="xfer-nick-filter-clear"
                    onClick={() => clearTier(tierOpen.tier)}
                  >
                    Снять выбор
                  </button>
                ) : null}
              </div>
              <div className="xfer-table-wrap">
                <table className="xfer-table">
                  <thead>
                    <tr>
                      <th>Ник</th>
                      <th>Стоимость</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tierPlayers.map((r) => {
                      const selected = draft[tierOpen.tier]?.userId === r.userId;
                      const usedElsewhere =
                        pickedIds.has(r.userId) && !selected;
                      const blocked = r.hasContract;
                      return (
                        <tr
                          key={r.userId}
                          className={blocked ? "is-contract-locked" : undefined}
                        >
                          <td>
                            <strong className="xfer-nick">{r.nick}</strong>
                            {blocked ? (
                              <span className="xfer-pill is-sell"> контракт</span>
                            ) : null}
                            {usedElsewhere ? (
                              <span className="muted"> · уже в другом тире</span>
                            ) : null}
                          </td>
                          <td>
                            <BdAmount n={r.playerValue} />
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`btn${selected ? " primary" : ""}`}
                              disabled={blocked || usedElsewhere}
                              title={
                                blocked
                                  ? "Контракт защищает от сезонного окна"
                                  : undefined
                              }
                              onClick={() => selectPlayer(tierOpen, r)}
                            >
                              {blocked
                                ? "Защищён"
                                : selected
                                  ? "Выбран"
                                  : "Выбрать"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!tierPlayers.length ? (
                      <tr>
                        <td colSpan={3} className="muted">
                          Нет игроков в этом диапазоне стоимости.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div
          className="profile-match-modal"
          role="presentation"
          onClick={() => setConfirmOpen(false)}
        >
          <div className="profile-match-modal-backdrop" />
          <div
            className="profile-match-modal-panel faction-seasons-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="profile-match-modal-head">
              <div>
                <h3>Подтверждение выставления</h3>
                <p className="muted">
                  {current?.label} · день трансферов · торги{" "}
                  {SEASON_AUCTION_HOURS} ч
                </p>
              </div>
              <button
                type="button"
                className="profile-match-modal-close"
                onClick={() => setConfirmOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="profile-match-modal-body">
              <p>
                Проверь пятёрку. После подтверждения игроки уйдут на межсезонный
                аукцион (логика выставления подключится к концу зимы).
              </p>
              <ul className="faction-seasons-confirm-list">
                {SEASON_AUCTION_TIERS.map((t) => {
                  const pick = draft[t.tier];
                  return (
                    <li key={t.tier}>
                      <strong>{t.label}</strong>
                      {pick ? (
                        <>
                          {" · "}
                          <span className="xfer-nick">{pick.nick}</span>
                          {" · "}
                          <BdAmount n={pick.playerValue} />
                        </>
                      ) : (
                        <span className="muted"> · не выбран</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="faction-seasons-confirm-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmOpen(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setConfirmOpen(false);
                    // Реальное выставление — с конца зимы; модалка уже есть.
                  }}
                >
                  Выставить на аукцион
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {staffGateOpen ? (
        <DraggableModal
          open
          closeOnBackdrop
          onClose={() => setStaffGateOpen(false)}
        >
          <header
            className="profile-match-modal-head"
            data-drag-handle
            title="Перетащить окно"
          >
            <div>
              <h2 className="profile-mail-modal-title">Только для штаба</h2>
              <p className="muted">Межсезонное выставление</p>
            </div>
            <button
              type="button"
              className="profile-match-modal-close"
              onClick={() => setStaffGateOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="profile-match-modal-body">
            <p>
              Выставлять игроков по ценовым тирам могут только{" "}
              <strong>командир фракции</strong> и <strong>зам фракции</strong>.
            </p>
            <p className="muted">
              Обычные бойцы смотрят инструкцию и календарь сезонов, но черновик
              и подтверждение — зона штаба.
            </p>
            <div className="clan-invite-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => setStaffGateOpen(false)}
              >
                Понятно
              </button>
            </div>
          </div>
        </DraggableModal>
      ) : null}
    </div>
  );
}
