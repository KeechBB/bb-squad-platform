import Link from "next/link";
import { TournamentBracketBoard } from "@/components/TournamentBracketBoard";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";

export function TournamentBracketPage() {
  const t = ACTIVE_TOURNAMENT;

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
              <dd>Двойное выбывание · 8×8 FCL</dd>
            </div>
            <div>
              <dt>Матч</dt>
              <dd>R1+R2 · победа по Σ тикетов</dd>
            </div>
            <div>
              <dt>Стороны</dt>
              <dd>слева USA · справа RGF</dd>
            </div>
          </dl>
          <div id="tn-br-time-slot" />
        </aside>

        <section className="tn-panel tn-br-board" aria-label="Сетка">
          <h2 className="tn-panel-title">Сетка</h2>
          <TournamentBracketBoard />
        </section>
      </div>
    </main>
  );
}
