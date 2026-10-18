/**
 * Public rating — «Как работает RP» guide for newcomers.
 * Numbers match rp_log_parse.py canon (formula ≥05.10, soft-cap + vehicle ≥17.10).
 */
import type { ReactNode } from "react";

function Hl({ children }: { children: ReactNode }) {
  return <mark className="rp-guide-hl">{children}</mark>;
}

function Ex({ children }: { children: ReactNode }) {
  return <div className="rp-guide-ex">{children}</div>;
}

export function PublicRpGuide() {
  return (
    <article className="rp-guide" aria-label="Как считается RP">
      <header className="rp-guide-hero">
        <p className="rp-guide-kicker">Шпаргалка для новичков</p>
        <h2 className="rp-guide-title">Как работает RP на паблике</h2>
        <p className="rp-guide-lead">
          <Hl>RP</Hl> — Respect Points, рейтинговые очки за игру на сервере{" "}
          <Hl>PB1</Hl> (паблик BlackBerry). Они копятся автоматически из логов
          после каждой катки. SEED не считается. Стартовый RP у нового игрока —{" "}
          <Hl>1000</Hl>. Ниже <Hl>1 RP</Hl> опуститься нельзя.
        </p>
      </header>

      <section className="rp-guide-sec">
        <h3>1. Откуда берутся очки</h3>
        <ul className="rp-guide-list">
          <li>
            Матч закончился на PB1 → сайт читает лог → каждому участнику
            начисляется ±RP.
          </li>
          <li>
            Та же формула, что на <Hl>тренировках</Hl> (TR1/TR2): киллы, ноки,
            смерти, ресы, техника.
          </li>
          <li>
            Смотреть разбор: во вкладке «Рейтинг» кликни ник → карты → детальный
            разбор. В «Истории матчей» кликни строку катки.
          </li>
        </ul>
      </section>

      <section className="rp-guide-sec">
        <h3>2. База N — «сколько стоит» столкновение</h3>
        <p>
          Для каждой пары игроков считается число <Hl>N ≈ от 1 до 50</Hl>. Оно
          зависит от вашего текущего RP и RP соперника (и от максимума RP на
          сервере в этот момент).
        </p>
        <ul className="rp-guide-list">
          <li>
            У обоих примерно одинаковый RP → <Hl>N ≈ 25.5</Hl>
          </li>
          <li>
            Убил сильнее себя (у жертвы RP выше) → <Hl>N больше</Hl>
          </li>
          <li>
            Убил слабее себя → <Hl>N меньше</Hl>
          </li>
        </ul>
        <Ex>
          <strong>Пример.</strong> Ты и враг оба около 1000 RP → N ≈ 25.5.
          Гивап-килл даст тебе примерно <Hl>+25.5</Hl>, враг потеряет примерно{" "}
          <Hl>−28</Hl> (смерть ×1.1, см. ниже).
        </Ex>
      </section>

      <section className="rp-guide-sec">
        <h3>3. Боёвка: что даёт и что забирает</h3>
        <p className="rp-guide-note">
          Считаем только <Hl>give-up</Hl> (финальная смерть → респаун) и{" "}
          <Hl>ноки</Hl> из лога. «Боевой счёт» с табло в RP не входит.
        </p>
        <div className="rp-guide-table-wrap">
          <table className="rp-guide-table">
            <thead>
              <tr>
                <th>Событие</th>
                <th>Тебе</th>
                <th>Ему</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Враг give-up (ты убил)
                </td>
                <td>
                  <Hl>+N × 1.0</Hl>
                </td>
                <td>
                  <Hl>−N × 1.1</Hl>
                </td>
              </tr>
              <tr>
                <td>Нокнул врага</td>
                <td>
                  <Hl>+N × 0.1</Hl>
                </td>
                <td>
                  <Hl>−N × 0.1</Hl>
                </td>
              </tr>
              <tr>
                <td>Поднял союзника</td>
                <td>
                  <Hl>+N × 0.7</Hl>
                </td>
                <td>—</td>
              </tr>
              <tr>
                <td>
                  Поднял того, кого <em>сам</em> нокнул
                </td>
                <td>
                  <Hl>+N × 0.2</Hl>
                </td>
                <td>—</td>
              </tr>
              <tr>
                <td>Тимкилл-нок (своего)</td>
                <td>
                  <Hl>−N × 0.5</Hl>
                </td>
                <td>—</td>
              </tr>
              <tr>
                <td>Тимкилл give-up</td>
                <td>
                  <Hl>−N × 0.6</Hl>
                </td>
                <td>
                  <Hl>−N × 1.1</Hl>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Ex>
          <strong>Пример медика.</strong> N ≈ 25. Ты поднял союзника →{" "}
          <Hl>+17.5</Hl> (25 × 0.7). Если это был твой же нок — только{" "}
          <Hl>+5</Hl> (25 × 0.2).
        </Ex>
        <Ex>
          <strong>Пример тимкилла.</strong> Случайно добил своего (N ≈ 25):
          убийца <Hl>−15</Hl>, жертва всё равно <Hl>−27.5</Hl> за смерть. TK
          очков не даёт — только штраф.
        </Ex>
      </section>

      <section className="rp-guide-sec">
        <h3>4. Техника (с 17.10.2026)</h3>
        <p>
          Курс: <Hl>1 тикет техники = 12.5 RP</Hl> (с ночи 17.10 — вдвое меньше,
          чем раньше). Класс смотрим по типу машины в логе, не по тикетам слоя.
        </p>
        <div className="rp-guide-table-wrap">
          <table className="rp-guide-table">
            <thead>
              <tr>
                <th>Класс</th>
                <th>Тикеты</th>
                <th>|ΔRP|</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Танк (MBT)</td>
                <td>15</td>
                <td>
                  <Hl>187.5</Hl>
                </td>
              </tr>
              <tr>
                <td>БТР / БМП / AAVP</td>
                <td>10</td>
                <td>
                  <Hl>125</Hl>
                </td>
              </tr>
              <tr>
                <td>Хабы WPMC (передвижной)</td>
                <td>20</td>
                <td>
                  <Hl>250</Hl>
                </td>
              </tr>
              <tr>
                <td>
                  Logi / «сопли» + лёгкая <em>с оружием</em> (TOW, ZU, CAS…)
                </td>
                <td>5</td>
                <td>
                  <Hl>62.5</Hl>
                </td>
              </tr>
              <tr>
                <td>
                  Транспорт без стрелка (Util, Transport, голый грузовик/вертолёт)
                </td>
                <td>2</td>
                <td>
                  <Hl>25</Hl>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="rp-guide-list">
          <li>
            <Hl>Уничтожил вражескую</Hl> — +тикеты×12.5 только{" "}
            <Hl>финишеру</Hl> (кто добил: HAT / LAT / Tandem / наводчик F2).
            Ассистов нет.
          </li>
          <li>
            <Hl>Потерял свою</Hl> — наводчик F2 −100% базы, мехвод (F1) −70%.
            Пассажиры / десант — <Hl>0</Hl>, не теряют.
          </li>
          <li>
            На logi / транспорте / лёгкой технике штраф только водителю (−70% от
            базы).
          </li>
          <li>
            <Hl>Транспорт ≠ logi:</Hl> голый Util/Transport даёт{" "}
            <Hl>25</Hl>, сопли (Logi) — <Hl>62.5</Hl>.
          </li>
          <li>
            Вылезли тушить горящую машину — штраф всё равно остаётся на
            последнем экипаже (F2 + мехвод).
          </li>
          <li>
            Мехвод получает <Hl>+70%</Hl> от ноков/киллов наводчика F2 с той же
            машины (пока оба в экипаже).
          </li>
        </ul>
        <Ex>
          <strong>Пример танка.</strong> Вражеский MBT взорвал HAT → финишер{" "}
          <Hl>+187.5</Hl>. Свой танк взорвали: наводчик <Hl>−187.5</Hl>, мехвод{" "}
          <Hl>−131.25</Hl>, десант без изменений.
        </Ex>
        <Ex>
          <strong>Пример транспорта.</strong> Уничтожил голый Util / Transport →{" "}
          <Hl>+25</Hl>. Уничтожил Logi → <Hl>+62.5</Hl>. Мехвод за потерю своего
          Util: <Hl>−17.5</Hl> (70% от 25).
        </Ex>
      </section>

      <section className="rp-guide-sec">
        <h3>5. Soft-cap с Immortal+ (с 17.10.2026)</h3>
        <p>
          На высоких рангах <Hl>получение</Hl> RP режется.{" "}
          <Hl>Потери всегда ×1</Hl> — умирать «дешевле» не станет.
        </p>
        <div className="rp-guide-table-wrap">
          <table className="rp-guide-table">
            <thead>
              <tr>
                <th>Твой ранг до плюса</th>
                <th>Кэф на +RP</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ниже Immortal</td>
                <td>
                  <Hl>×1.0</Hl>
                </td>
              </tr>
              <tr>
                <td>Immortal I–III</td>
                <td>
                  <Hl>×0.9</Hl>
                </td>
              </tr>
              <tr>
                <td>Master I–III</td>
                <td>
                  <Hl>×0.8</Hl>
                </td>
              </tr>
              <tr>
                <td>Radiant I–II</td>
                <td>
                  <Hl>×0.7</Hl>
                </td>
              </tr>
              <tr>
                <td>Radiant III</td>
                <td>
                  <Hl>×0.6</Hl>
                </td>
              </tr>
              <tr>
                <td>Eclipse I–III</td>
                <td>
                  <Hl>×0.55</Hl>
                </td>
              </tr>
              <tr>
                <td>Predator</td>
                <td>
                  <Hl>×0.5</Hl>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Ex>
          <strong>Пример.</strong> Immortal, килл на +25.5 → реально{" "}
          <Hl>+23</Hl> (×0.9). Смерть на −28 останется <Hl>−28</Hl>.
        </Ex>
      </section>

      <section className="rp-guide-sec">
        <h3>6. Ранги</h3>
        <p>
          Лестница сверху страницы: Iron → … → Radiant →{" "}
          <Hl>Eclipse</Hl> (по <Hl>150 RP</Hl> на ступень I/II/III). Eclipse I
          начинается с <Hl>4501</Hl>, Eclipse III до <Hl>4950</Hl>, выше —{" "}
          <Hl>PREDATOR</Hl>. Ранг на таблице = твой текущий RP после всех каток.
        </p>
      </section>

      <section className="rp-guide-sec">
        <h3>7. Коротко «запомни»</h3>
        <ul className="rp-guide-list rp-guide-list-key">
          <li>
            <Hl>Килл сильнее / рес союзника</Hl> — основной плюс.
          </li>
          <li>
            <Hl>Смерть дороже килла</Hl> (×1.1) — не кормить зря.
          </li>
          <li>
            <Hl>TK всегда минус</Hl>, очков за своих нет.
          </li>
          <li>
            <Hl>Техника = крупные ±</Hl>, но только экипаж / финишер.
          </li>
          <li>
            Наверху soft-cap режет плюс, минус — полный.
          </li>
        </ul>
      </section>

      <footer className="rp-guide-foot">
        Формула боя с <Hl>05.10.2026</Hl> · техника и soft-cap с{" "}
        <Hl>17.10.2026</Hl> · курс техники <Hl>12.5</Hl> RP/тикет · transport{" "}
        <Hl>25</Hl> / logi <Hl>62.5</Hl>. Пересчёт с Black Coast 17.10.
      </footer>
    </article>
  );
}
