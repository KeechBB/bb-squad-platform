# Battle Pass Season 2 — готов, ждём старта

**Статус:** UI и контент Season 2 **заморожены** в скрытом превью. Живой `/battle-pass` пока = Season 1 (PB1).

## Ссылки

- Превью (только Keech): https://bb-squad.ru/battle-pass/halloween-preview
- Код UI: `src/components/Season2BattlePass.tsx` + `.bp-s2-*` в `globals.css`
- Награды / уровни / арт: `src/lib/battlePassSeason2.ts`, ассеты `/public/bp-halloween/`
- Мок-рейтинг превью: `src/lib/battlePassSeason2Preview.ts`
- Календарь / пауза: `src/lib/battlePassSchedule.ts`

## Календарь (МСК)

| Этап | Даты |
|------|------|
| Season 1 «Фруктовый Сад» | до **31.10.2026** |
| Заглушка на `/battle-pass` | **01.11–03.11.2026** (3 дня) |
| Season 2 Halloween live | с **04.11.2026** по **30.11.2026** |

Текст заглушки: «Скоро новый Battle Pass» + благодарность за сезон. Компонент: `BattlePassIntermission`.

## Когда выкатывать Season 2 в прод

1. Дождаться конца PB1 и паузы (или сдвинуть даты в `battlePassSchedule.ts`).
2. На `/battle-pass` вместо заглушки отдать `layout="season2"` + реальные данные (не мок).
3. Включить скорер / ledger для S2 season id.
4. Превью `/battle-pass/halloween-preview` можно оставить Keech-only или убрать.

До этой даты **не трогать** живой PB1 и не публиковать S2 всем.
