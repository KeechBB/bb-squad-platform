#!/usr/bin/env python3
"""Read-only Battle Pass health check. No writes."""
import json
from pathlib import Path

bp_path = Path("/var/www/bb-squad-platform/data/public/battle-pass.json")
ledger_candidates = [
    Path("/var/www/bb-squad-platform/data/public/rp-ledger.json"),
    Path("/var/www/bb-squad-platform/data/kv-cache/data/public/rp-ledger.json"),
    Path("/var/www/bb-squad-platform/data/kv-cache/data/rp-ledger.json"),
]
ledger_path = next((p for p in ledger_candidates if p.is_file()), None)

bp = json.loads(bp_path.read_text(encoding="utf-8"))
print("=== BP STATE ===")
print("enabled:", bp.get("enabled"))
print("seasonId:", bp.get("seasonId"))
print("updatedAt:", bp.get("updatedAt"))
print("cutoverAfterMatchId:", bp.get("cutoverAfterMatchId"))
scored = list(bp.get("scoredMatchIds") or [])
print("scoredMatchIds count:", len(scored))
print("last scored (12):")
for mid in scored[-12:]:
    print(" ", mid)
print("players:", len(bp.get("players") or {}))
print("leaderboard:")
for r in bp.get("leaderboard") or []:
    print(
        f"  {r.get('nick')} L{r.get('currentLevel')} "
        f"{r.get('current')}/{r.get('target')} finished={r.get('finished')}"
    )

players = [
    p
    for p in (bp.get("players") or {}).values()
    if isinstance(p, dict) and p.get("updatedAt")
]
players.sort(key=lambda p: str(p.get("updatedAt") or ""), reverse=True)
print("\n=== most recently updated players (20) ===")
for p in players[:20]:
    print(
        f"  {p.get('updatedAt')}  {p.get('nick')} "
        f"L{p.get('currentLevel')} {p.get('current')}/{p.get('target')}"
    )

if not ledger_path:
    print("\nLEDGER NOT FOUND")
else:
    print("\n=== LEDGER ===", ledger_path)
    led = json.loads(ledger_path.read_text(encoding="utf-8"))
    matches = [m for m in (led.get("matches") or []) if isinstance(m, dict)]
    print("ledger matches:", len(matches))
    matches_sorted = sorted(matches, key=lambda m: str(m.get("id") or ""))
    print("last ledger matches (10):")
    for m in matches_sorted[-10:]:
        mid = str(m.get("id") or "")
        print(
            f"  {mid} map={m.get('map')} date={m.get('date')} "
            f"scored_in_bp={mid in scored}"
        )
    cut = str(bp.get("cutoverAfterMatchId") or "")
    after = [m for m in matches_sorted if str(m.get("id") or "") > cut]
    unscored = [m for m in after if str(m.get("id") or "") not in scored]
    print(f"\nmatches after cutover ({cut}): {len(after)}")
    print(f"after cutover NOT scored: {len(unscored)}")
    for m in unscored[-15:]:
        print(f"  UNSCORED {m.get('id')} map={m.get('map')} date={m.get('date')}")

# how BP is invoked
print("\n=== BP wiring hints ===")
for p in [
    Path("/var/www/bb-squad-platform/scripts/deploy.sh"),
    Path("/var/www/bb-squad-platform/ecosystem.config.cjs"),
    Path("/var/www/bb-squad-platform/ecosystem.config.js"),
]:
    if p.is_file():
        text = p.read_text(encoding="utf-8", errors="ignore")
        if "battle_pass" in text or "battle-pass" in text:
            print(f"  mentions BP: {p}")
