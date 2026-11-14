# Нашивки → торговая площадка (канон)

**Статус:** фаза 1.3 — `/marketplace` открыт всем: каталоги нашивок / фонов / шрифтов (центробанк). Пополнение за ₽ пока WIP. P2P-лоты ещё нет.

## Валюта: BB Coins

Бывшие **BB Points** (прогнозы турнира) переименованы в **BB Coins**.

| Источник | Как |
|----------|-----|
| Верный прогноз турнира | `correct × 100`, зачисление 1 раз на турнир (`BbCoinTx.kind=tournament_grant`) |
| Покупка за ₽ | курс **2 BB Coins = 1 ₽**; пакеты в `BB_COIN_PACKAGES`, заказ `BbCoinOrder` → после оплаты `purchase` |
| Вывод в рубли | **нет** (закрытый контур) |

Баланс: `User.bbCoins`. Журнал: `BbCoinTx`.

## Смысл площадки (дальше)

Любая нашивка, которую игрок **получил**, — **предмет инвентаря**. Позже:

1. выставить лотом за BB Coins;
2. продать / купить у игроков;
3. экипировать только из своего инвентаря;
4. скупка/продажа от «центробанка» по ценам админа.

## Сейчас vs потом

| Сейчас | Потом |
|--------|--------|
| `User.bbCoins` + покупка пакетов (заказ) | эквайринг ЮKassa + чеки |
| `NickPatchStock` (qty копий) + sync в `unlockedNickPatches` | P2P-лоты, торговля между игроками |
| `/marketplace` — баланс и пакеты | лоты нашивок, магазин кастома, уровни BP |

## Правила

1. Стабильные id в `PROFILE_PATCH_OPTIONS`.
2. Получение награды = зачисление в инвентарь.
3. Экипировка ≠ владение.
4. Сделки атомарны (списание продавцу / зачисление покупателю).
5. Рейтинг RP паблика за деньги не продаём.
6. **Центробанк:** продать = **80%** от цены «купить» (`PATCH_SELL_OF_BUY`). Прайс — `src/lib/bbCoinPatchPrices.ts`.

| id | Купить BBC | Продать BBC |
|----|------------|-------------|
| `bp-l15-keech` | 2000 | 1600 |
| `creator-orange-phantom` | 2500 | 2000 |
| `creator-fruit-strike-ak-v2` | 800 | 640 |
| `hw2-knife-hook` | 300 | 240 |
| `hw2-ak-pumpkin` | 600 | 480 |
| `creator-event-scar-lemon` | 500 | 400 |
| `creator-event-saiga-apple` | 500 | 400 |
| `public-100-vehicles-t62` | 500 | 400 |

## Фоны профиля (фаза 1.2)

Только **зарабатываемые** id (не free `02` / `06`). Инвентарь: `ProfileBgStock` + sync `unlockedProfileBgs`. После продажи фон пропадает из кастомизации.

| id | Фон | Купить BBC | Продать BBC (80%) |
|----|-----|------------|-------------------|
| `bp-l5-gold` | Турнирное золото II | 600 | 480 |
| `hw2-night-harvest` | Ночной урожай | 900 | 720 |
| `creator-fruit-strike-place3-v3` | Тактический урожай | 1200 | 960 |
| `creator-royal-core` | BlackBerry Royal Core | 2800 | 2240 |

Дневные акции фонов — отдельный сид `bb-market-bg-deal-v1:YYYY-MM-DD` (`bbCoinBgDailyDeals.ts`), те же −20% / +20% / sell +20%.

Код: `marketBgIds.ts`, `bbCoinBgPrices.ts`, `bbCoinBgMarket.ts`, `api/bb-coins/bgs`.

## Шрифты ника (фаза 1.3)

Инвентарь: `NickStyleStock` + sync `unlockedNickStyles`. После продажи стиль пропадает из кастомизации.

| id | Шрифт | Купить BBC | Продать BBC (80%) |
|----|-------|------------|-------------------|
| `bp-l10-aurum-clean` | Aurum Clean (золото) | 2000 | 1600 |
| `hw2-violet-gothic` | Алая жатва (красный) | 1500 | 1200 |

Пока в каталоге **2** шрифта: ежедневно активны только **2 из 3** видов акций (`bbCoinFontDailyDeals.ts`, сид `bb-market-font-deal-v1:YYYY-MM-DD`); третий вид отпадает. Каждый шрифт получает ровно одну акцию (или без — если логика расширится).

Код: `marketFontIds.ts`, `bbCoinFontPrices.ts`, `bbCoinFontMarket.ts`, `api/bb-coins/fonts`.

## Код

- `src/lib/bbCoins.ts`, `src/lib/bbCoinsTournament.ts`
- `src/app/marketplace/page.tsx`, `api/bb-coins/*`
- хаб: `marketplace` → `/marketplace`
