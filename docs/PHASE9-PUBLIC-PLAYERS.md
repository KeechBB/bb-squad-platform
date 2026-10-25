# Фаза 9 — игроки паблика в CanonMatchPlayer

**Дата:** 2026-10-26

Из siphon-среза `matches/…/<matchKey>/layer.log` заполняем `CanonMatchPlayer` для `CanonMatch` kind=`PUBLIC` без ростера.

```bash
python3 scripts/canon_fill_public_players.py --limit 80
```

Авто: после новых срезов siphon (`BB_FILL_PUBLIC_PLAYERS=1`).

Стороны A/B если teams из лога есть; иначе side=`U`.
