import type { ReactNode } from "react";
import Link from "next/link";
import {
  FRUIT_STRIKE_GRAND,
  FRUIT_STRIKE_LOSERS,
  FRUIT_STRIKE_PLACES,
  FRUIT_STRIKE_WINNERS,
  type BracketCard,
} from "@/lib/fruitStrikeBracket";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";

function Card({
  card,
  tone,
}: {
  card: BracketCard;
  tone: "upper" | "lower" | "final";
}) {
  return (
    <div className={`tn-br-card is-${tone}`}>
      <div className="tn-br-card-top">
        <span>{card.winner}</span>
        <span className="tn-br-score">{card.score}</span>
      </div>
      <div className="tn-br-card-lose">{card.loser}</div>
    </div>
  );
}

function Seed({ name }: { name: string }) {
  return <div className="tn-br-seed">{name}</div>;
}

function Slot({
  span = 1,
  tone = "upper",
  children,
}: {
  span?: 1 | 2 | 4;
  tone?: "upper" | "lower";
  children: ReactNode;
}) {
  return (
    <div className={`tn-br-slot is-span${span} is-${tone}`}>{children}</div>
  );
}

export function TournamentBracketPage() {
  const t = ACTIVE_TOURNAMENT;
  const q = FRUIT_STRIKE_WINNERS.quarters;
  const s = FRUIT_STRIKE_WINNERS.semis;
  const l1 = FRUIT_STRIKE_LOSERS.round1;
  const l2 = FRUIT_STRIKE_LOSERS.round2;

  return (
    <main className="tn-page tn-bracket-page">
      <header className="tn-head">
        <div className="tn-head-text">
          <p className="tn-eyebrow">BlackBerry · турнирный хаб</p>
          <h1>Сетка турнира</h1>
        </div>
        <Link href="/tournaments" className="tn-br-back">
          К турниру
        </Link>
      </header>

      <div className="tn-br-layout">
        <aside className="tn-panel tn-br-info" aria-label="Инфо">
          <h2 className="tn-panel-title">Инфо</h2>
          <p className="tn-br-name">{t.name}</p>
          <dl className="tn-br-facts">
            <div>
              <dt>Дата</dt>
              <dd>31.10.2026</dd>
            </div>
            <div>
              <dt>Формат</dt>
              <dd>Двойное выбывание · 8 команд</dd>
            </div>
            <div>
              <dt>Слоты</dt>
              <dd>Team 1 — Team 8. Названия команд ещё не вписаны.</dd>
            </div>
            <div>
              <dt>Правило</dt>
              <dd>Первый проигрыш опускает вниз. Второй — вылет.</dd>
            </div>
          </dl>
          <ol className="tn-br-places">
            {FRUIT_STRIKE_PLACES.map((row) => (
              <li key={row.place}>
                <span>{row.place}</span>
                {row.team}
              </li>
            ))}
          </ol>
        </aside>

        <section className="tn-panel tn-br-board" aria-label="Сетка">
          <h2 className="tn-panel-title">Сетка</h2>
          <div className="tn-br-scroll">
            <div className="tn-br-tree">
              <div className="tn-br-main">
                <p className="tn-br-lane is-upper">Верхняя</p>
                <div className="tn-br-cols">
                  <div className="tn-br-col">
                    {q.map((card) => (
                      <Slot key={`${card.winner}-${card.loser}`}>
                        <Seed name={card.winner} />
                        <Seed name={card.loser} />
                      </Slot>
                    ))}
                  </div>
                  <div className="tn-br-col">
                    {q.map((card) => (
                      <Slot key={`q-${card.winner}`}>
                        <Card card={card} tone="upper" />
                      </Slot>
                    ))}
                  </div>
                  <div className="tn-br-col">
                    {s.map((card) => (
                      <Slot key={`s-${card.winner}-${card.loser}`} span={2}>
                        <Card card={card} tone="upper" />
                      </Slot>
                    ))}
                  </div>
                  <div className="tn-br-col">
                    <Slot span={4}>
                      <Card card={FRUIT_STRIKE_WINNERS.final} tone="upper" />
                    </Slot>
                  </div>
                </div>

                <p className="tn-br-lane is-lower">Нижняя</p>
                <div className="tn-br-cols">
                  <div className="tn-br-col">
                    {l1.map((card) => (
                      <Slot key={`l1s-${card.winner}`} tone="lower">
                        <Seed name={card.winner} />
                        <Seed name={card.loser} />
                      </Slot>
                    ))}
                  </div>
                  <div className="tn-br-col">
                    {l1.map((card) => (
                      <Slot key={`l1-${card.winner}`} tone="lower">
                        <Card card={card} tone="lower" />
                      </Slot>
                    ))}
                  </div>
                  <div className="tn-br-col">
                    {l2.map((card) => (
                      <Slot key={`l2-${card.winner}`} tone="lower">
                        <div className="tn-br-drop">
                          <span className="tn-br-drop-in">{card.drop}</span>
                          <Card card={card} tone="lower" />
                        </div>
                      </Slot>
                    ))}
                  </div>
                  <div className="tn-br-col">
                    <Slot span={2} tone="lower">
                      <Card card={FRUIT_STRIKE_LOSERS.semi} tone="lower" />
                    </Slot>
                  </div>
                  <div className="tn-br-col">
                    <Slot span={2} tone="lower">
                      <div className="tn-br-drop">
                        <span className="tn-br-drop-in">
                          {FRUIT_STRIKE_LOSERS.final.drop}
                        </span>
                        <Card card={FRUIT_STRIKE_LOSERS.final} tone="lower" />
                      </div>
                    </Slot>
                  </div>
                </div>
              </div>
              <div className="tn-br-grand">
                <Card card={FRUIT_STRIKE_GRAND} tone="final" />
                <p>Гранд-финал</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
