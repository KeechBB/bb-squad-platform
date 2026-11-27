"use client";

import { useMemo } from "react";
import { BdAmount } from "@/components/BdMark";
import {
  FACTION_SEASONS,
  SEASON_AUCTION_HOURS,
  SEASON_AUCTION_TIERS,
  formatYmdRu,
  getCurrentSeason,
  getNextSeason,
  seasonKeyRu,
} from "@/lib/factionSeasons";

export function FactionSeasonsPanel() {
  const current = useMemo(() => getCurrentSeason(), []);
  const next = useMemo(() => getNextSeason(), []);

  return (
    <div className="faction-seasons">
      <div className="faction-seasons-head">
        <h3 className="xfer-title">Сезоны</h3>
        <p className="muted xfer-sub">
          Календарь по временам года. Межсезонный аукцион — в последний день
          сезона (с конца зимы 2026/27).
        </p>
      </div>

      <div className="faction-seasons-now">
        {current ? (
          <>
            <p className="faction-seasons-now-label muted">Сейчас</p>
            <h4 className="faction-seasons-now-title">{current.label}</h4>
            <p className="muted">
              {formatYmdRu(current.startsOn)} — {formatYmdRu(current.endsOn)} ·{" "}
              {seasonKeyRu(current.key)}
            </p>
            <p
              className={`faction-seasons-badge${
                current.endAuctionEnabled ? " is-on" : " is-skip"
              }`}
            >
              {current.endAuctionEnabled
                ? `Межсезонный аукцион: в последний день (${formatYmdRu(current.endsOn)}), ${SEASON_AUCTION_HOURS} ч`
                : "Межсезонный аукцион в этом сезоне пропускаем"}
            </p>
          </>
        ) : (
          <p className="muted">Вне календаря сезонов.</p>
        )}
        {next ? (
          <p className="muted faction-seasons-next">
            Дальше: <strong>{next.label}</strong> с {formatYmdRu(next.startsOn)}
            {next.endAuctionEnabled
              ? ` · аукцион в конце (${formatYmdRu(next.endsOn)})`
              : ""}
          </p>
        ) : null}
      </div>

      <h4 className="faction-hr-sub">Ценовые тиры (межсезонный аукцион)</h4>
      <div className="faction-seasons-tiers">
        {SEASON_AUCTION_TIERS.map((t) => (
          <div key={t.tier} className="faction-seasons-tier">
            <strong>{t.label}</strong>
            <span>
              {t.maxBd == null ? (
                <>
                  от <BdAmount n={t.minBd} />
                </>
              ) : (
                <>
                  <BdAmount n={t.minBd} /> – <BdAmount n={t.maxBd} />
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      <h4 className="faction-hr-sub">Правила межсезона</h4>
      <ul className="faction-seasons-rules">
        <li>
          В последний день сезона командир или зам выставляют 5 игроков разных
          тиров. Если нет — система выставляет сама.
        </li>
        <li>
          Торги {SEASON_AUCTION_HOURS} часа: кто дал больше — забирает игрока.
        </li>
        <li>
          За день фракция берёт не больше одного игрока каждого тира; в сумме до
          5 покупок. Свою фракцию тоже можно купить.
        </li>
        <li>
          Season 1 Осень 2026 — без этих торгов. Первый рабочий цикл — конец
          зимы 2026/27.
        </li>
      </ul>

      <h4 className="faction-hr-sub">Календарь</h4>
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
                  </td>
                  <td className="muted">
                    {formatYmdRu(s.startsOn)} — {formatYmdRu(s.endsOn)}
                  </td>
                  <td>
                    {s.endAuctionEnabled ? (
                      <span className="xfer-pill is-buy">да</span>
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
    </div>
  );
}
